/**
 * Upload validation — the gate every incoming photograph passes before any byte
 * is written anywhere (Slice 06).
 *
 * Deliberately pure and dependency-free so the SAME rules can be enforced in the
 * admin form's client-side hints and on the server. The server check is the one
 * that matters: a browser control is a convenience, never a security boundary,
 * and every rule here is re-applied to the real bytes in the Worker.
 *
 * The rules are deliberately conservative. An upload either becomes a private
 * master plus two public derivatives, or it is rejected with a reason the
 * operator can act on — there is no "store it anyway" path, because a master
 * that cannot be decoded can never produce a derivative, and a master that
 * cannot be trusted should not enter the archival bucket at all.
 */

/** The image formats this application accepts and can process. */
export const SUPPORTED_UPLOAD_TYPES = ["image/jpeg", "image/png"] as const;

export type SupportedUploadType = (typeof SUPPORTED_UPLOAD_TYPES)[number];

/** Largest accepted original, in bytes. A high-resolution master fits comfortably. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Largest number of files one submission may carry.
 *
 * A multipart request is read into Worker memory before anything can be judged,
 * so an unbounded batch is a way for one request to consume the isolate. This is
 * the count half of the batch policy; {@link MAX_BATCH_BYTES} is the byte half.
 */
export const MAX_BATCH_FILES = 10;

/**
 * Largest total size of one submission.
 *
 * Lower than `MAX_BATCH_FILES * MAX_UPLOAD_BYTES` on purpose: ten files may each
 * be within the per-file ceiling while the request as a whole is far too large.
 * Both limits are enforced before any image transformation happens.
 */
export const MAX_BATCH_BYTES = 64 * 1024 * 1024;

/**
 * Format used when an upload arrives without a usable declared content type.
 *
 * The declared type is a hint that must agree with the magic bytes when present
 * (see {@link validateUpload}), so defaulting an absent one to JPEG is safe: the
 * bytes still decide.
 */
export const DEFAULT_UPLOAD_DECLARED_TYPE = "image/jpeg";

/** The master's filename extension for a decoded source format. */
export function extensionForFormat(format: "image/jpeg" | "image/png"): string {
  return format === "image/png" ? "png" : "jpg";
}

/** Largest accepted pixel count per image (width x height). */
export const MAX_UPLOAD_PIXELS = 50_000_000;

/** Smallest accepted edge, in pixels: below this there is nothing to publish. */
export const MIN_UPLOAD_EDGE = 64;

/** Largest accepted edge, in pixels, per side. */
export const MAX_UPLOAD_EDGE = 20_000;

/** Longest accepted original filename, including any extension. */
export const MAX_UPLOAD_FILENAME_LENGTH = 180;

/** Why an upload was refused. Each value is a stable, testable reason code. */
export type UploadRejection =
  | "empty-file"
  | "too-large"
  | "type-not-allowed"
  | "type-mismatch"
  | "unsupported-image"
  | "too-many-pixels"
  | "dimensions-out-of-range"
  | "unsafe-filename"
  | "too-many-files"
  | "batch-too-large"
  | "length-required"
  | "request-too-large";

/**
 * Enforce the batch policy BEFORE any bytes are read or transformed.
 *
 * The caller supplies what the request DECLARES, so an oversized submission is
 * refused while it is still cheap to refuse: the point is to never materialise
 * the bodies of a batch that cannot possibly be accepted.
 */
export function assertBatchWithinPolicy(
  files: readonly { readonly size: number }[],
): void {
  if (files.length > MAX_BATCH_FILES) {
    throw new UploadError(
      "too-many-files",
      `${files.length} files were submitted; at most ${MAX_BATCH_FILES} are accepted per upload.`,
    );
  }
  let total = 0;
  for (const file of files) {
    total += Number.isFinite(file.size) && file.size > 0 ? file.size : 0;
  }
  if (total > MAX_BATCH_BYTES) {
    const megabytes = (total / (1024 * 1024)).toFixed(1);
    throw new UploadError(
      "batch-too-large",
      `The submission is ${megabytes} MB in total; the limit is ${
        MAX_BATCH_BYTES / (1024 * 1024)
      } MB.`,
    );
  }
}

/** A refused upload: a stable reason plus a message written for the operator. */
export class UploadError extends Error {
  readonly reason: UploadRejection;

  constructor(reason: UploadRejection, message: string) {
    super(message);
    this.name = "UploadError";
    this.reason = reason;
  }
}

/** What the byte sniffing found, independent of any declared type. */
const SIGNATURES: readonly { readonly type: SupportedUploadType; readonly bytes: readonly number[] }[] = [
  // JPEG: SOI marker followed by any marker introducer.
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  // PNG: the full 8-byte signature is checked separately below.
  { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

/**
 * Identify an image from its leading bytes.
 *
 * Magic bytes are the authority: a declared MIME type is only ever a hint, and a
 * mismatch is a rejection rather than something to reconcile. Returns null for
 * anything this application does not process.
 */
export function sniffImageType(bytes: Uint8Array): SupportedUploadType | null {
  for (const signature of SIGNATURES) {
    if (bytes.byteLength < signature.bytes.length) {
      continue;
    }
    if (signature.bytes.every((byte, index) => bytes[index] === byte)) {
      return signature.type;
    }
  }
  return null;
}

/**
 * Reduce an operator-supplied filename to a safe leaf name.
 *
 * The stored master key embeds the photo id, not the operator's filename, so
 * this exists only to keep the display name sane and to stop path characters
 * from ever reaching a storage key. Returns null when nothing usable remains.
 */
export function sanitiseFilename(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  // Both separators, because a filename may have been produced on either OS.
  const leaf = value.split(/[\\/]/).pop() ?? "";
  const cleaned = leaf
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    // Collapse a dash that runs into an extension: "my photo (1).jpg" becomes
    // "my-photo-1.jpg", not "my-photo-1-.jpg". Done before the leading strip so
    // a name that is entirely punctuation still reduces to null below.
    .replace(/-+(\.[A-Za-z0-9]+)$/, "$1")
    .replace(/^[.-]+/, "")
    // ...and again, because stripping the leading dashes can expose a trailing
    // one that was previously interior.
    .replace(/-+(\.[A-Za-z0-9]+)$/, "$1")
    .replace(/-+$/, "")
    .trim();
  if (cleaned.length === 0) {
    return null;
  }
  return cleaned.length > MAX_UPLOAD_FILENAME_LENGTH
    ? cleaned.slice(-MAX_UPLOAD_FILENAME_LENGTH)
    : cleaned;
}

/** The declared MIME type, or null when it is absent or not a string. */
export function declaredTypeOf(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const type = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return type.length > 0 ? type : null;
}

/** Dimensions accepted by {@link assertUsableDimensions}. */
export type ImageDimensions = { readonly width: number; readonly height: number };

/**
 * Enforce the size and dimension limits on an image whose type is already known.
 *
 * Pixel limits come BEFORE decoding, so a decompression bomb (a small file that
 * expands to an enormous frame) is refused while it is still cheap to refuse.
 */
export function assertUsableDimensions(dimensions: ImageDimensions): void {
  const { width, height } = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new UploadError("unsupported-image", "The image reports no usable dimensions.");
  }
  if (width * height > MAX_UPLOAD_PIXELS) {
    throw new UploadError(
      "too-many-pixels",
      `The image is ${width}x${height}, which exceeds the ${MAX_UPLOAD_PIXELS}-pixel limit.`,
    );
  }
  const smallest = Math.min(width, height);
  const largest = Math.max(width, height);
  if (smallest < MIN_UPLOAD_EDGE) {
    throw new UploadError(
      "dimensions-out-of-range",
      `The image's shorter edge is ${smallest}px; at least ${MIN_UPLOAD_EDGE}px is required.`,
    );
  }
  if (largest > MAX_UPLOAD_EDGE) {
    throw new UploadError(
      "dimensions-out-of-range",
      `The image's longer edge is ${largest}px; at most ${MAX_UPLOAD_EDGE}px is accepted.`,
    );
  }
}

/**
 * Validate the parts of an upload that can be judged without decoding it: size,
 * declared type, magic bytes and filename. Throws {@link UploadError} on the
 * first problem found, so the operator gets one actionable reason.
 *
 * Returns the sniffed type and the safe filename; dimension checks follow once
 * the header has been read.
 */
export function validateUpload(input: {
  readonly bytes: Uint8Array;
  readonly declaredType?: unknown;
  readonly filename?: unknown;
}): { readonly type: SupportedUploadType; readonly filename: string } {
  if (input.bytes.byteLength === 0) {
    throw new UploadError("empty-file", "The uploaded file is empty.");
  }
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    const megabytes = (input.bytes.byteLength / (1024 * 1024)).toFixed(1);
    throw new UploadError(
      "too-large",
      `The uploaded file is ${megabytes} MB; the limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
    );
  }

  const declared = declaredTypeOf(input.declaredType);
  if (declared !== null && !(SUPPORTED_UPLOAD_TYPES as readonly string[]).includes(declared)) {
    throw new UploadError(
      "type-not-allowed",
      `Files of type ${declared} are not accepted; use JPEG or PNG.`,
    );
  }

  const sniffed = sniffImageType(input.bytes);
  if (sniffed === null) {
    throw new UploadError(
      "unsupported-image",
      "The file is not a JPEG or PNG image. Renaming a file does not change its contents.",
    );
  }
  // A declared type that contradicts the bytes is refused rather than trusted:
  // the two must agree for the upload to be considered understood.
  if (declared !== null && declared !== sniffed) {
    throw new UploadError(
      "type-mismatch",
      `The file is declared as ${declared} but its contents are ${sniffed}.`,
    );
  }

  const filename = sanitiseFilename(input.filename);
  if (filename === null) {
    throw new UploadError("unsafe-filename", "The uploaded file has no usable filename.");
  }

  return { type: sniffed, filename };
}
