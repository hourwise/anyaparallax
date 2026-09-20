/**
 * Admin upload orchestration (Slice 06 repair 01) — server only.
 *
 * This is the one place that knows how an operator's submission becomes stored
 * objects and a photograph row, so the route module stays a thin adapter and the
 * checks can drive the real path through a real Request.
 *
 * TWO properties define this module.
 *
 * MEMORY. Files are read and processed ONE AT A TIME. A `Promise.all` over
 * `file.arrayBuffer()` materialises every body in the isolate simultaneously, so
 * a ten-file batch could hold ten full masters plus ten derivative sets at once;
 * sequencing means the peak is one file. The batch policy is enforced from the
 * DECLARED sizes before a single body is read, so an oversized submission is
 * refused while it is still cheap to refuse.
 *
 * CONSISTENCY. Per file, the order is: prepare everything (nothing persistent),
 * write the three objects, then commit the row. If the database commit fails,
 * the objects this attempt created are removed, so a failure never leaves
 * derivatives without a record. If an earlier stage fails, nothing was written.
 */
import { R2ObjectStorage } from "../data/storage.server";
import type { AppBindings } from "../data/context";
import { repositoryBundleFor } from "../data/queries";
import {
  ImageProcessingError,
  type ImageProcessor,
  type WatermarkPosition,
} from "../images/image-processor";
import { processUpload } from "../images/process";
import {
  assertBatchWithinPolicy,
  UploadError,
  DEFAULT_UPLOAD_DECLARED_TYPE,
} from "../images/upload-validation";

/**
 * One file the operator asked to upload.
 *
 * A LAZY source: `size` is known from the parsed request without reading
 * anything, and `readBytes()` is called by the loop below only when that file's
 * turn comes. The previous revision passed already-materialised byte arrays, so
 * the batch policy ran after every body had been read — it could not prevent the
 * allocation it existed to prevent.
 */
export type UploadFileInput = {
  readonly filename: string;
  readonly declaredType: string;
  readonly size: number;
  /** Called at most once, and never for two files at the same time. */
  readonly readBytes: () => Promise<Uint8Array>;
};

/** The operator's choices, already parsed from the form. */
export type UploadOptions = {
  readonly title: string;
  readonly description: string;
  readonly galleryId: string;
  readonly tags: readonly string[];
  readonly location: string | null;
  readonly captureDate: string | null;
  readonly watermarkEnabled: boolean;
  readonly watermarkPosition: WatermarkPosition;
  readonly published: boolean;
  readonly featured: boolean;
  readonly printAvailable: boolean;
};

/** What happened to one file. */
export type UploadOutcome = {
  readonly filename: string;
  readonly ok: boolean;
  readonly photo?: {
    readonly id: string;
    readonly slug: string;
    readonly title: string;
    readonly width: number;
    readonly height: number;
    readonly webWidth: number;
    readonly webHeight: number;
    readonly watermarked: boolean;
    readonly bytes: { readonly master: number; readonly web: number; readonly thumbnail: number };
  };
  readonly error?: { readonly reason: string; readonly message: string };
};

export type UploadReport = {
  readonly outcomes: readonly UploadOutcome[];
  readonly accepted: number;
  readonly rejected: number;
  /** False when running on the development seed source, which does not persist. */
  readonly persisted: boolean;
};

/** Application-generated id: also the storage-key segment for this upload's objects. */
function newPhotoId(): string {
  return `photo-${crypto.randomUUID()}`;
}

/**
 * Enforce the batch policy from the sizes the request DECLARES.
 *
 * Called before any body is read, which is the entire point: a submission that
 * cannot be accepted must be refused while it is still just a set of numbers.
 * The route applies the same check even earlier, from the parsed Files'
 * metadata; this call is the second, independent enforcement, so the guarantee
 * does not depend on a caller remembering to do it.
 */
function assertBatchPolicy(files: readonly UploadFileInput[]): void {
  assertBatchWithinPolicy(files.map((file) => ({ size: file.size })));
}

/** Suffix appended to the per-file title in a multi-file upload. */
function titleForFile(base: string, index: number, total: number, filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  if (total === 1) {
    return base.length > 0 ? base : stem || "Untitled";
  }
  const prefix = base.length > 0 ? base : "Upload";
  return `${prefix} ${index + 1}`;
}

/** Structural check for an R2 binding, matching the storage module's own guard. */
function isBucket(value: unknown): value is ConstructorParameters<typeof R2ObjectStorage>[0]["MASTERS"] {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { put?: unknown }).put === "function"
  );
}

/** True when both buckets are bound, so an upload could be stored. */
export function hasUploadStorage(
  env: { MASTERS?: unknown; IMAGES?: unknown } | undefined,
): boolean {
  return isBucket(env?.MASTERS) && isBucket(env?.IMAGES);
}

/** Which parts of the upload platform this environment has, for a health report. */
export type PlatformReadiness = {
  readonly imageProcessor: boolean;
  readonly mastersBucket: boolean;
  readonly imagesBucket: boolean;
  readonly database: boolean;
};

/**
 * Report which platform pieces are present.
 *
 * Exported so a route can describe the environment WITHOUT naming a binding
 * itself: a route module that mentions `MASTERS` or `IMAGES` risks pulling
 * storage code into the client bundle, and the build refuses it outright. One
 * place knows how to interrogate a binding, and it is not a route.
 */
export function platformReadiness(env: unknown): PlatformReadiness {
  const candidate = env as
    | { MASTERS?: unknown; IMAGES?: unknown; DB?: unknown; IMAGE_TRANSFORMS?: unknown }
    | undefined;
  return {
    imageProcessor: Boolean(candidate?.IMAGE_TRANSFORMS),
    mastersBucket: isBucket(candidate?.MASTERS),
    imagesBucket: isBucket(candidate?.IMAGES),
    database: Boolean(candidate?.DB),
  };
}

/** The processor a request will use, or null when this environment cannot process. */
export type ProcessorFactory = (env: AppBindings | undefined) => Promise<ImageProcessor | null>;

/**
 * The production processor factory.
 *
 * Loaded dynamically so the Cloudflare Images adapter — and the watermark asset
 * it needs — stay out of any graph that only renders. Returns null when the
 * binding is absent, so the caller refuses the upload instead of writing a
 * master it could never turn into a derivative.
 */
export const defaultProcessorFactory: ProcessorFactory = async (env) => {
  const binding = (env as { IMAGE_TRANSFORMS?: unknown } | undefined)?.IMAGE_TRANSFORMS;
  if (!binding || typeof binding !== "object") {
    return null;
  }
  const [{ createCloudflareImageProcessor }, { developmentWatermarkOverlay }] = await Promise.all([
    import("../images/image-processor.cloudflare.server"),
    import("../images/watermark-asset"),
  ]);
  return createCloudflareImageProcessor({
    binding: binding as Parameters<typeof createCloudflareImageProcessor>[0]["binding"],
    watermark: developmentWatermarkOverlay(),
  });
};

/**
 * Ingest one or more uploaded files.
 *
 * Returns a per-file report rather than throwing, because a batch where one file
 * is a corrupt JPEG should store the others and say exactly which one failed.
 * A batch-level refusal (too many files, too many bytes) throws instead: it
 * applies to the submission, not to one file.
 */
export async function ingestUploads(input: {
  readonly env: AppBindings | undefined;
  readonly files: readonly UploadFileInput[];
  readonly options: UploadOptions;
  /** Injected so checks can supply a fake processor; defaults to the real one. */
  readonly processorFactory?: ProcessorFactory;
}): Promise<UploadReport> {
  // Batch policy first, from declared sizes, before any body is touched.
  assertBatchPolicy(input.files);

  const masters = input.env?.MASTERS;
  const images = input.env?.IMAGES;
  if (!isBucket(masters) || !isBucket(images)) {
    throw new UploadError(
      "unsupported-image",
      "The storage buckets are not configured, so nothing can be uploaded.",
    );
  }
  const { repository, persisted } = await repositoryBundleFor(input.env);
  const storage = new R2ObjectStorage({ MASTERS: masters, IMAGES: images });

  // Resolve the processor ONCE for the submission: building the watermark asset
  // is per-process work, and every file in a batch should use the same one.
  const processor = await (input.processorFactory ?? defaultProcessorFactory)(input.env);
  if (!processor) {
    throw new UploadError(
      "unsupported-image",
      "The image processor is not configured in this environment, so uploads are unavailable.",
    );
  }

  const outcomes: UploadOutcome[] = [];
  // SEQUENTIAL on purpose. Each iteration awaits its own `readBytes()` and then
  // finishes with it before the next begins, so at most one file body is alive at
  // a time and the peak is one master plus its derivatives rather than the whole
  // batch. The loop is `for ... of` with awaited work inside, NOT `Promise.all`.
  for (const [index, file] of input.files.entries()) {
    const photoId = newPhotoId();
    let processed: Awaited<ReturnType<typeof processUpload>>;
    try {
      const bytes = await file.readBytes();
      processed = await processUpload({
        photoId,
        bytes,
        declaredType: file.declaredType || DEFAULT_UPLOAD_DECLARED_TYPE,
        filename: file.filename,
        watermarkEnabled: input.options.watermarkEnabled,
        watermarkPosition: input.options.watermarkPosition,
        processor,
        storage,
      });
    } catch (error) {
      outcomes.push({ filename: file.filename, ok: false, error: describeFailure(error) });
      continue;
    }

    // The objects exist but no row does yet. If the commit fails, remove exactly
    // this attempt's objects so no derivative outlives a record that never
    // landed. The master is included because nothing references it.
    try {
      const title = titleForFile(input.options.title, index, input.files.length, file.filename);
      const slug = await repository.availablePhotoSlug(title);
      const record = await repository.createPhoto({
        id: photoId,
        title,
        slug,
        description: input.options.description,
        galleryId: input.options.galleryId,
        tags: input.options.tags,
        location: input.options.location,
        captureDate: input.options.captureDate,
        width: processed.width,
        height: processed.height,
        originalStorageKey: processed.originalStorageKey,
        webStorageKey: processed.webStorageKey,
        thumbnailStorageKey: processed.thumbnailStorageKey,
        watermarkEnabled: processed.watermarked,
        watermarkPosition: input.options.watermarkPosition,
        published: input.options.published,
        featured: input.options.featured,
        printAvailable: input.options.printAvailable,
      });

      outcomes.push({
        filename: file.filename,
        ok: true,
        photo: {
          id: record.id,
          slug: record.slug,
          title: record.title,
          width: processed.width,
          height: processed.height,
          webWidth: processed.webWidth,
          webHeight: processed.webHeight,
          watermarked: processed.watermarked,
          bytes: processed.bytes,
        },
      });
    } catch (error) {
      await discardObjects(storage, processed);
      outcomes.push({ filename: file.filename, ok: false, error: describeFailure(error) });
    }
  }

  const accepted = outcomes.filter((outcome) => outcome.ok).length;
  return { outcomes, accepted, rejected: outcomes.length - accepted, persisted };
}

/**
 * Remove the objects of an upload whose database commit failed.
 *
 * Only ever called with keys built moments earlier from this attempt's id, so a
 * previously accepted master can never be a candidate. Failures are swallowed:
 * the commit error is what the operator needs, and cleanup is best-effort by
 * nature.
 */
async function discardObjects(
  storage: R2ObjectStorage,
  processed: { originalStorageKey: string; webStorageKey: string; thumbnailStorageKey: string },
): Promise<void> {
  for (const remove of [
    () => storage.deletePublicImage(processed.thumbnailStorageKey),
    () => storage.deletePublicImage(processed.webStorageKey),
    () => storage.deleteMaster(processed.originalStorageKey),
  ]) {
    try {
      await remove();
    } catch {
      // Best-effort: see the note above.
    }
  }
}

/** A refusal the operator can act on, without leaking internals. */
function describeFailure(error: unknown): { reason: string; message: string } {
  if (error instanceof UploadError) {
    return { reason: error.reason, message: error.message };
  }
  if (error instanceof ImageProcessingError) {
    return { reason: error.reason, message: error.message };
  }
  return {
    reason: "processing-failed",
    // Deliberately generic: an unexpected internal error is not echoed to the
    // operator, so a stack trace or a storage key cannot leak through the form.
    message: "The image could not be processed and nothing was stored for it.",
  };
}
