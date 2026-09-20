/**
 * Upload processing pipeline (Slice 06 repair 01).
 *
 * The ordering here IS the consistency guarantee. Everything that can fail
 * without side effects happens first; the three object writes and the database
 * commit happen only once a complete, verified set of derivatives exists.
 *
 *   PREPARE (no persistent effect)
 *     1. validate the upload's size, declared type, magic bytes and filename;
 *     2. ask the image processor to decode the source and produce BOTH
 *        derivatives — this is where a corrupt, truncated or unsupported image
 *        is refused, and it is the only place pixels are handled at all;
 *     3. re-check the TRUSTED geometry the processor reported against the
 *        application's dimension limits.
 *
 *   COMMIT (persistent, ordered, compensating)
 *     4. write the exact original bytes to the private MASTERS bucket;
 *     5. write the web derivative to IMAGES;
 *     6. write the thumbnail derivative to IMAGES.
 *
 * The previous revision wrote the master BEFORE decoding, so a decode failure
 * left an orphan master behind an upload that was reported as refused. Here a
 * refusal cannot have written anything, because nothing is written until every
 * step that can refuse has already succeeded.
 *
 * R2 steps are not transactional, so a failure after the first write triggers
 * compensating deletion of EXACTLY the keys this attempt created, and nothing
 * else. A previously accepted master is never a cleanup candidate: the delete
 * list only ever contains keys built from THIS upload's freshly generated id.
 */
import { masterKey, thumbnailKey, webKey } from "../data/storage";
import { type ImageProcessor, type SourceFormat, type WatermarkPosition } from "./image-processor";
import { assertUsableDimensions, extensionForFormat, validateUpload } from "./upload-validation";

/** The bucket surface the pipeline writes through. */
export type UploadStorage = {
  putMaster(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  putPublicImage(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Compensating cleanup for the private bucket (`storage.server.ts` validates the key). */
  deleteMaster(key: string): Promise<void>;
  /** Compensating cleanup for the public bucket. */
  deletePublicImage(key: string): Promise<void>;
};

/** A processed upload: exactly what the caller needs to record and report. */
export type ProcessedUpload = {
  readonly originalStorageKey: string;
  readonly webStorageKey: string;
  readonly thumbnailStorageKey: string;
  /** Dimensions of the ORIGINAL, as reported by the image service. */
  readonly width: number;
  readonly height: number;
  readonly webWidth: number;
  readonly webHeight: number;
  readonly thumbnailWidth: number;
  readonly thumbnailHeight: number;
  /** Content type of the recorded master, taken from the decoded source. */
  readonly sourceFormat: SourceFormat;
  readonly watermarked: boolean;
  readonly bytes: {
    readonly master: number;
    readonly web: number;
    readonly thumbnail: number;
  };
};

export type ProcessUploadInput = {
  readonly photoId: string;
  readonly bytes: Uint8Array;
  readonly declaredType?: unknown;
  readonly filename?: unknown;
  readonly watermarkEnabled: boolean;
  readonly watermarkPosition: WatermarkPosition;
  readonly processor: ImageProcessor;
  readonly storage: UploadStorage;
};

/**
 * Process one accepted upload end to end.
 *
 * Throws `UploadError` or `ImageProcessingError` for anything the operator can
 * act on; in both cases nothing has been stored. Any other throw is a storage
 * failure and is accompanied by compensating cleanup before it propagates.
 */
export async function processUpload(input: ProcessUploadInput): Promise<ProcessedUpload> {
  // --- PREPARE: no persistent effect from here to the first write ----------
  // Only the filename is needed: the DECODED format the processor reports is
  // what decides the master's extension, not the magic bytes this step sniffed.
  const { filename } = validateUpload({
    bytes: input.bytes,
    declaredType: input.declaredType,
    filename: input.filename,
  });

  const derivatives = await input.processor.prepare({
    photoId: input.photoId,
    bytes: input.bytes,
    watermark: { enabled: input.watermarkEnabled, position: input.watermarkPosition },
  });

  // The processor's geometry is the trusted geometry: the upload's own header
  // bytes are never believed. Limits are applied to what the service reported.
  assertUsableDimensions({
    width: derivatives.source.width,
    height: derivatives.source.height,
  });

  // --- COMMIT: ordered writes with compensating cleanup --------------------
  const originalStorageKey = masterKey(
    input.photoId,
    `${filename.replace(/\.[^.]+$/, "")}.${extensionForFormat(derivatives.source.format)}`,
  );
  const webStorageKey = webKey(input.photoId, `web.webp`);
  const thumbnailStorageKey = thumbnailKey(input.photoId, `thumb.webp`);

  // Keys are built from a freshly generated photo id, so a compensating delete
  // can only ever target objects this attempt created. The list holds only the
  // deletes, newest last, so rollback can unwind in reverse.
  const created: (() => Promise<void>)[] = [];

  try {
    await input.storage.putMaster(originalStorageKey, input.bytes, derivatives.source.format);
    created.push(() => input.storage.deleteMaster(originalStorageKey));

    await input.storage.putPublicImage(
      webStorageKey,
      derivatives.web.bytes,
      derivatives.web.contentType,
    );
    created.push(() => input.storage.deletePublicImage(webStorageKey));

    await input.storage.putPublicImage(
      thumbnailStorageKey,
      derivatives.thumbnail.bytes,
      derivatives.thumbnail.contentType,
    );
    created.push(() => input.storage.deletePublicImage(thumbnailStorageKey));
  } catch (error) {
    await rollback(created);
    throw error;
  }

  return {
    originalStorageKey,
    webStorageKey,
    thumbnailStorageKey,
    width: derivatives.source.width,
    height: derivatives.source.height,
    webWidth: derivatives.web.width,
    webHeight: derivatives.web.height,
    thumbnailWidth: derivatives.thumbnail.width,
    thumbnailHeight: derivatives.thumbnail.height,
    sourceFormat: derivatives.source.format,
    watermarked: derivatives.watermarked,
    bytes: {
      master: input.bytes.byteLength,
      web: derivatives.web.bytes.byteLength,
      thumbnail: derivatives.thumbnail.bytes.byteLength,
    },
  };
}

/**
 * Delete exactly what this attempt created, newest first.
 *
 * Failures are swallowed deliberately: the original error is the one the
 * operator must see, and a cleanup failure must not replace it. The keys remain
 * recoverable from the photo id, so a failed cleanup is diagnosable rather than
 * silent data loss.
 */
async function rollback(created: readonly (() => Promise<void>)[]): Promise<void> {
  for (const remove of [...created].reverse()) {
    try {
      await remove();
    } catch {
      // Intentionally ignored: see the note above.
    }
  }
}
