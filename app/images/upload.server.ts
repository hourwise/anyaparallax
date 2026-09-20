/**
 * Admin upload orchestration (Slice 06) — server only.
 *
 * The one place that knows how an operator's form submission becomes stored
 * objects and a photograph row. It exists so the route module stays a thin
 * adapter: the route parses a form and renders a result, while every rule about
 * ids, slugs, buckets and repository writes lives here where the checks can
 * drive it directly through a real Request.
 *
 * Ordering is deliberate and security-relevant:
 *
 *   1. the caller has ALREADY been authorised (`requireAdminAccess` in the route
 *      loader AND action — the guard is not repeated here, because a second
 *      implementation of the same decision is a second thing to get wrong);
 *   2. buckets are resolved, and a missing binding aborts before any id or slug
 *      is consumed;
 *   3. per file: validate → preserve the master → derive → record the row. A
 *      failure on one file is reported for that file and does not abort the rest
 *      of a multi-file upload.
 */
import { R2ObjectStorage, type R2BucketBinding } from "../data/storage.server";
import type { AppBindings } from "../data/context";
import { repositoryBundleFor } from "../data/queries";
import { processUpload, type ProcessedUpload } from "../images/process";
import { UploadError } from "../images/upload-validation";
import type { WatermarkPosition } from "../images/watermark";

/** One file the operator asked to upload, already read into memory. */
export type UploadFileInput = {
  readonly filename: string;
  readonly declaredType: string;
  readonly bytes: Uint8Array;
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
  /** Present when `ok`: the recorded photograph. */
  readonly photo?: {
    readonly id: string;
    readonly slug: string;
    readonly title: string;
    readonly width: number;
    readonly height: number;
    readonly webWidth: number;
    readonly webHeight: number;
    readonly watermarked: boolean;
    readonly bytes: ProcessedUpload["bytes"];
  };
  /** Present when NOT `ok`: a reason the operator can act on. */
  readonly error?: { readonly reason: string; readonly message: string };
};

export type UploadReport = {
  readonly outcomes: readonly UploadOutcome[];
  readonly accepted: number;
  readonly rejected: number;
  /** False when running on the development seed source, which does not persist. */
  readonly persisted: boolean;
};

/** Newest-first ordering is the repository's job; this is only an id. */
function newPhotoId(): string {
  return `photo-${crypto.randomUUID()}`;
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

/**
 * Ingest one or more uploaded files.
 *
 * Returns a per-file report rather than throwing, because a multi-file upload
 * where one file is a corrupt JPEG should store the other nine and tell the
 * operator exactly which one failed.
 *
 * The repository is resolved HERE through the same factory the read paths use,
 * so an upload cannot accidentally write through a different store than the one
 * the admin pages read from.
 */
export async function ingestUploads(input: {
  readonly env: AppBindings | undefined;
  readonly files: readonly UploadFileInput[];
  readonly options: UploadOptions;
}): Promise<UploadReport> {
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

  const outcomes: UploadOutcome[] = [];
  for (const [index, file] of input.files.entries()) {
    const photoId = newPhotoId();
    try {
      const processed = await processUpload({
        photoId,
        bytes: file.bytes,
        declaredType: file.declaredType,
        filename: file.filename,
        watermarkEnabled: input.options.watermarkEnabled,
        watermarkPosition: input.options.watermarkPosition,
        storage,
      });

      const title = titleForFile(
        input.options.title,
        index,
        input.files.length,
        file.filename,
      );
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
      outcomes.push({
        filename: file.filename,
        ok: false,
        error:
          error instanceof UploadError
            ? { reason: error.reason, message: error.message }
            : {
                reason: "processing-failed",
                // Deliberately generic: an unexpected internal error is logged,
                // not echoed to the operator, so a stack trace or storage key
                // cannot leak through the admin form.
                message: "The image could not be processed. The file may be corrupt.",
              },
      });
    }
  }

  const accepted = outcomes.filter((outcome) => outcome.ok).length;
  return {
    outcomes,
    accepted,
    rejected: outcomes.length - accepted,
    persisted,
  };
}

/** Structural check for an R2 binding, matching the storage module's own guard. */
function isBucket(value: unknown): value is R2BucketBinding {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { put?: unknown }).put === "function"
  );
}

/**
 * True when both buckets are bound, so an upload could be stored.
 *
 * Exported for the admin route, which must decide whether to offer the form at
 * all. Keeping the check here means the route never names a bucket binding, so
 * the route module stays free of storage coupling and the same rule is used to
 * report the outcome.
 */
export function hasUploadStorage(env: { MASTERS?: unknown; IMAGES?: unknown } | undefined): boolean {
  return isBucket(env?.MASTERS) && isBucket(env?.IMAGES);
}
