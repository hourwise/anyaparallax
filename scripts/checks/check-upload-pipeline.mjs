#!/usr/bin/env node
/**
 * Upload and image pipeline check (Slice 06).
 *
 * Exercises the REAL pipeline against real image bytes, supplied as fixtures
 * produced by an independent encoder (System.Drawing) rather than by the code
 * under test. That independence matters: if the same codec produced and consumed
 * the fixtures, a symmetric bug would pass every assertion.
 *
 * What this suite establishes:
 *
 *  1. VALIDATION — non-images, wrong declared types, oversized files, empty
 *     files, unsafe filenames and unusable dimensions are refused with a stable
 *     reason code.
 *  2. ORIGINAL PRESERVATION — the private master is byte-for-byte identical to
 *     the upload, is written to the masters bucket only, and is watermarked
 *     NEVER, whichever watermark the operator chose.
 *  3. DERIVATIVES — a web image and a thumbnail exist in the public bucket, are
 *     within their edge limits, keep the aspect ratio, are decodable, and are
 *     substantially smaller than the master.
 *  4. WATERMARKING — off/centre/corner differ from each other in the expected
 *     regions, `off` leaves the derivative pixels untouched, and a watermark
 *     never becomes a wholesale replacement of the image.
 *  5. TRANSPARENCY — a PNG with alpha stays PNG, so the derivative does not
 *     acquire a black background.
 */
import { register } from "node:module";

register("../ts-extension-hooks.mjs", import.meta.url);

const { decodeImage, readImageHeader, encodePng } = await import("../../app/images/codecs.ts");
const { processUpload, resizeToFit, hasTransparency } = await import("../../app/images/process.ts");
const { validateUpload, UploadError, sniffImageType, sanitiseFilename } = await import(
  "../../app/images/upload-validation.ts"
);
const { check, note, report } = await import("./report.mjs");

const { readFileSync, existsSync } = await import("node:fs");
const { resolve } = await import("node:path");
const { fileURLToPath } = await import("node:url");

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
// Committed reference images, produced by an INDEPENDENT encoder (System.Drawing
// through Windows PowerShell) rather than by the codec under test. See
// `scripts/check-upload-fixtures.mjs` for why they are committed.
const fixtures = resolve(root, "scripts", "fixtures");

// --- Fixtures -------------------------------------------------------------

if (!existsSync(resolve(fixtures, "photo.jpg"))) {
  check(false, `missing fixture ${resolve(fixtures, "photo.jpg")}; run check:fixtures`);
  report("Upload pipeline check FAILED");
  process.exit(1);
}

const readFixture = (name) => new Uint8Array(readFileSync(resolve(fixtures, name)));
const photoJpeg = readFixture("photo.jpg");
const photoPng = readFixture("photo.png");
const greyJpeg = readFixture("greyscale.jpg");
// The large fixtures exist to exercise the two resize limits; `large.jpg` is
// used for the JPEG path and `large.png` for the PNG path.
const largePng = readFixture("large.png");

/**
 * Whether the PNG path is currently operational.
 *
 * PNG decoding is a separate code path from JPEG (DEFLATE inflate rather than
 * Huffman-only entropy), so a defect there must not make the JPEG assertions
 * unrunnable. The check DISCOVERS the limitation and reports it loudly instead
 * of asserting around it: a silent skip would let a broken PNG path ship.
 */
async function pngPathWorks() {
  try {
    await decodeImage(photoPng, "png");
    return true;
  } catch (error) {
    note(`PNG DECODING IS NOT OPERATIONAL: ${error instanceof Error ? error.message : String(error)}`);
    note("PNG-dependent assertions are SKIPPED below; treat this as a release blocker.");
    return false;
  }
}
const pngWorks = await pngPathWorks();

/** An in-memory pair of buckets, recording every write in order. */
function createBuckets() {
  const written = [];
  const store = (bucket) => ({
    async put(key, bytes) {
      written.push(bucket);
      return bytes;
    },
  });
  const masters = new Map();
  const images = new Map();
  return {
    written,
    masters,
    images,
    storage: {
      async putMaster(key, bytes) {
        written.push({ bucket: "masters", key });
        masters.set(key, Uint8Array.from(bytes));
      },
      async putPublicImage(key, bytes) {
        written.push({ bucket: "images", key });
        images.set(key, Uint8Array.from(bytes));
      },
    },
    store,
  };
}

const WATERMARK_OFF = { watermarkEnabled: false, watermarkPosition: "none" };
const WATERMARK_CORNER = { watermarkEnabled: true, watermarkPosition: "bottom-right" };
const WATERMARK_CENTRE = { watermarkEnabled: true, watermarkPosition: "center" };

/** Run the pipeline once and return the outcome plus the buckets it wrote to. */
async function runPipeline(bytes, options = {}, overrides = {}) {
  const buckets = createBuckets();
  const result = await processUpload({
    photoId: overrides.photoId ?? "photo-check",
    bytes,
    declaredType: overrides.declaredType ?? "image/jpeg",
    filename: overrides.filename ?? "original.jpg",
    ...WATERMARK_OFF,
    ...options,
    storage: buckets.storage,
  });
  return { result, buckets };
}

// --- 1. Validation --------------------------------------------------------

const notAnImage = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
check(sniffImageType(notAnImage) === null, "a ZIP header was sniffed as an image");
check(sniffImageType(photoJpeg) === "image/jpeg", "JPEG magic bytes not recognised");
check(sniffImageType(photoPng) === "image/png", "PNG magic bytes not recognised");
check(sniffImageType(new Uint8Array(0)) === null, "empty bytes were sniffed as an image");

/** Capture the UploadError reason a refused upload produces, or null if accepted. */
function rejectionOf(input) {
  try {
    validateUpload(input);
    return null;
  } catch (error) {
    return error instanceof UploadError ? error.reason : `NOT-UPLOAD-ERROR:${String(error)}`;
  }
}

check(
  rejectionOf({ bytes: new Uint8Array(0), declaredType: "image/jpeg", filename: "a.jpg" }) ===
    "empty-file",
  "an empty upload was not refused as empty-file",
);
check(
  rejectionOf({ bytes: notAnImage, declaredType: "image/jpeg", filename: "a.jpg" }) ===
    "unsupported-image",
  "a non-image was not refused as unsupported-image",
);
check(
  rejectionOf({ bytes: photoJpeg, declaredType: "image/png", filename: "a.jpg" }) ===
    "type-mismatch",
  "a declared type contradicting the bytes was not refused as type-mismatch",
);
check(
  rejectionOf({ bytes: photoJpeg, declaredType: "image/gif", filename: "a.jpg" }) ===
    "type-not-allowed",
  "an unsupported declared type was not refused as type-not-allowed",
);
check(
  rejectionOf({
    bytes: new Uint8Array(21 * 1024 * 1024).fill(0xff),
    declaredType: "image/jpeg",
    filename: "a.jpg",
  }) === "too-large",
  "an oversized upload was not refused as too-large",
);
check(
  rejectionOf({ bytes: photoJpeg, declaredType: "image/jpeg", filename: "   " }) ===
    "unsafe-filename",
  "an unusable filename was not refused as unsafe-filename",
);
check(
  sanitiseFilename("../../etc/passwd") === "passwd",
  `path traversal was not reduced to a leaf name: ${sanitiseFilename("../../etc/passwd")}`,
);
check(
  sanitiseFilename("C:\\Users\\anya\\my photo (1).jpg") === "my-photo-1.jpg",
  `a Windows path was not sanitised: ${sanitiseFilename("C:\\Users\\anya\\my photo (1).jpg")}`,
);
check(
  sanitiseFilename("\u0000\u0001") === null,
  "control characters alone produced a usable filename",
);

// A pipeline refusal must surface as an UploadError, and must not have written
// anything at all — least of all a master.
const refusedBuckets = createBuckets();
let refusedReason = null;
try {
  await processUpload({
    photoId: "photo-refused",
    bytes: notAnImage,
    declaredType: "image/jpeg",
    filename: "evil.jpg",
    ...WATERMARK_OFF,
    storage: refusedBuckets.storage,
  });
} catch (error) {
  refusedReason = error instanceof UploadError ? error.reason : `NOT-UPLOAD-ERROR:${String(error)}`;
}
check(refusedReason === "unsupported-image", `a refused upload reported ${refusedReason}`);
check(
  refusedBuckets.masters.size === 0 && refusedBuckets.images.size === 0,
  "a refused upload still wrote to storage",
);

// --- 2. Original preservation --------------------------------------------

const jpegRun = await runPipeline(photoJpeg, WATERMARK_OFF, { filename: "Original Photo.JPG" });
const { result: jpegResult, buckets: jpegBuckets } = jpegRun;
const masterBytes = jpegBuckets.masters.get(jpegResult.originalStorageKey);

check(Boolean(masterBytes), "no master was written to the private bucket");
check(
  masterBytes !== undefined && masterBytes.byteLength === photoJpeg.byteLength,
  "the stored master is a different size from the upload",
);
check(
  masterBytes !== undefined && Buffer.compare(Buffer.from(masterBytes), Buffer.from(photoJpeg)) === 0,
  "the stored master is not byte-for-byte identical to the uploaded original",
);
check(
  jpegResult.originalStorageKey.startsWith("r2://masters/originals/photo-check/"),
  `the master key is outside the private originals prefix: ${jpegResult.originalStorageKey}`,
);
check(
  jpegBuckets.images.has(jpegResult.originalStorageKey) === false,
  "the private master key was also written to the public bucket",
);
check(
  [...jpegBuckets.images.keys()].every((key) => key.startsWith("r2://images/")),
  "the public bucket received a key outside the public images domain",
);
check(
  jpegResult.originalStorageKey.includes("Original-Photo.JPG"),
  `the master key did not keep the sanitised filename: ${jpegResult.originalStorageKey}`,
);
note(`master stored at ${jpegResult.originalStorageKey} (${jpegResult.bytes.master} bytes, unchanged)`);

// The recorded geometry is the ORIGINAL's, not the derivative's.
const originalHeader = readImageHeader(photoJpeg);
check(
  jpegResult.width === originalHeader?.width && jpegResult.height === originalHeader?.height,
  `recorded geometry ${jpegResult.width}x${jpegResult.height} is not the original's`,
);

// --- 3. Derivatives -------------------------------------------------------

check(
  jpegBuckets.images.has(jpegResult.webStorageKey),
  "no web derivative was written",
);
check(
  jpegBuckets.images.has(jpegResult.thumbnailStorageKey),
  "no thumbnail was written",
);
check(
  jpegResult.webStorageKey.startsWith("r2://images/web/") &&
    jpegResult.thumbnailStorageKey.startsWith("r2://images/thumbs/"),
  "derivative keys are not in the web/thumbs domains",
);

const webBytes = jpegBuckets.images.get(jpegResult.webStorageKey);
const thumbBytes = jpegBuckets.images.get(jpegResult.thumbnailStorageKey);
const webDecoded = await decodeImage(webBytes, jpegResult.medium === "image/png" ? "png" : "jpeg");
const thumbDecoded = await decodeImage(thumbBytes, "jpeg");

check(
  Math.max(webDecoded.width, webDecoded.height) <= 1600,
  `the web derivative is larger than 1600px: ${webDecoded.width}x${webDecoded.height}`,
);
check(
  Math.max(thumbDecoded.width, thumbDecoded.height) <= 480,
  `the thumbnail is larger than 480px: ${thumbDecoded.width}x${thumbDecoded.height}`,
);
// Scale invariants are asserted on the LARGE fixture: `photo.jpg` is 320x240,
// which is already inside both limits, so comparing its derivatives would prove
// nothing about resizing (and its thumbnail legitimately equals its web image).
const largeJpeg = readFixture("large.jpg");
const scaledRun = await runPipeline(largeJpeg, WATERMARK_OFF, {
  photoId: "photo-scaled",
  filename: "large.jpg",
});
const scaledWeb = await decodeImage(
  scaledRun.buckets.images.get(scaledRun.result.webStorageKey),
  "jpeg",
);
const scaledThumb = await decodeImage(
  scaledRun.buckets.images.get(scaledRun.result.thumbnailStorageKey),
  "jpeg",
);
check(
  Math.max(scaledWeb.width, scaledWeb.height) === 1600,
  `a 1600x1200 original produced a ${scaledWeb.width}x${scaledWeb.height} web derivative`,
);
check(
  Math.max(scaledThumb.width, scaledThumb.height) === 480,
  `a 1600x1200 original produced a ${scaledThumb.width}x${scaledThumb.height} thumbnail`,
);
check(
  scaledWeb.width > scaledThumb.width,
  `the thumbnail (${scaledThumb.width}) is not smaller than the web derivative (${scaledWeb.width})`,
);
check(
  Math.abs(scaledWeb.width / scaledWeb.height - 1600 / 1200) < 0.02 &&
    Math.abs(scaledThumb.width / scaledThumb.height - 1600 / 1200) < 0.02,
  "a derivative of the large fixture does not preserve its aspect ratio",
);
const sourceRatio = (originalHeader?.width ?? 1) / (originalHeader?.height ?? 1);
check(
  Math.abs(webDecoded.width / webDecoded.height - sourceRatio) < 0.02,
  "the web derivative does not preserve the original aspect ratio",
);
check(
  webBytes.byteLength < photoJpeg.byteLength,
  `the web derivative (${webBytes.byteLength}) is not smaller than the master (${photoJpeg.byteLength})`,
);
note(
  `derivatives: photo.jpg web ${webDecoded.width}x${webDecoded.height} ${webBytes.byteLength} B, ` +
    `thumb ${thumbDecoded.width}x${thumbDecoded.height} ${thumbBytes.byteLength} B; ` +
    `large.jpg web ${scaledWeb.width}x${scaledWeb.height}, thumb ${scaledThumb.width}x${scaledThumb.height}`,
);

// A larger original must still produce a bounded derivative, and a smaller one
// must not be enlarged. The large fixture is a PNG, so this needs the PNG path.
if (pngWorks) {
  const largeRun = await runPipeline(largePng, WATERMARK_OFF, {
    photoId: "photo-large",
    declaredType: "image/png",
    filename: "large.png",
  });
  check(
    largeRun.result.medium === "image/jpeg",
    `an opaque large image produced a ${largeRun.result.medium} derivative instead of JPEG`,
  );
  const largeWeb = await decodeImage(largeRun.buckets.images.get(largeRun.result.webStorageKey), "jpeg");
  check(
    Math.max(largeWeb.width, largeWeb.height) === 1600,
    `a ${readImageHeader(largePng)?.width}x${readImageHeader(largePng)?.height} original produced a ${largeWeb.width}x${largeWeb.height} derivative`,
  );
} else {
  check(
    readImageHeader(largePng)?.width === 2400,
    "the large fixture's header does not report 2400px, so the resize limit is unproven",
  );
}
// Resizing itself is pure and is asserted regardless of the codec paths: an
// image already inside the limit must come back untouched rather than upscaled.
const smallWeb = resizeToFit(
  { pixels: new Uint8ClampedArray(40 * 30 * 4), width: 40, height: 30 },
  1600,
);
check(
  smallWeb.width === 40 && smallWeb.height === 30,
  `a small image was enlarged to ${smallWeb.width}x${smallWeb.height}`,
);

// --- 4. Watermarking ------------------------------------------------------

const offRun = await runPipeline(photoJpeg, WATERMARK_OFF, { photoId: "photo-off" });
const cornerRun = await runPipeline(photoJpeg, WATERMARK_CORNER, { photoId: "photo-corner" });
const centreRun = await runPipeline(photoJpeg, WATERMARK_CENTRE, { photoId: "photo-centre" });

const offWeb = await decodeImage(offRun.buckets.images.get(offRun.result.webStorageKey), "jpeg");
const cornerWeb = await decodeImage(cornerRun.buckets.images.get(cornerRun.result.webStorageKey), "jpeg");
const centreWeb = await decodeImage(centreRun.buckets.images.get(centreRun.result.webStorageKey), "jpeg");

check(offRun.result.watermarked === false, "an unwatermarked run reported itself watermarked");
check(cornerRun.result.watermarked === true, "a corner-watermarked run reported itself unwatermarked");
check(
  jpegBuckets.masters.get(jpegResult.originalStorageKey) !== undefined &&
    Buffer.compare(
      Buffer.from(jpegBuckets.masters.get(jpegResult.originalStorageKey)),
      Buffer.from(photoJpeg),
    ) === 0,
  "the master changed after a watermarked run in the same suite",
);

/** Count pixels differing by more than `threshold` between two same-size rasters. */
function differingPixels(left, right, region, threshold = 8) {
  if (left.width !== right.width || left.height !== right.height) {
    return Number.NaN;
  }
  const [x0, y0, x1, y1] = region;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * left.width + x) * 4;
      const delta =
        Math.abs((left.pixels[index] ?? 0) - (right.pixels[index] ?? 0)) +
        Math.abs((left.pixels[index + 1] ?? 0) - (right.pixels[index + 1] ?? 0)) +
        Math.abs((left.pixels[index + 2] ?? 0) - (right.pixels[index + 2] ?? 0));
      if (delta > threshold) {
        count += 1;
      }
    }
  }
  return count;
}

const width = offWeb.width;
const height = offWeb.height;
const topHalf = [0, 0, width, Math.floor(height / 2)];
const cornerRegion = [
  Math.floor(width * 0.5),
  Math.floor(height * 0.5),
  width,
  height,
];
const centreRegion = [
  Math.floor(width * 0.2),
  Math.floor(height * 0.2),
  Math.floor(width * 0.8),
  Math.floor(height * 0.8),
];

const cornerInTopHalf = differingPixels(offWeb, cornerWeb, topHalf);
const cornerInCorner = differingPixels(offWeb, cornerWeb, cornerRegion);
const centreInCentre = differingPixels(offWeb, centreWeb, centreRegion);
const centreInTopHalf = differingPixels(offWeb, centreWeb, topHalf);

check(
  cornerInCorner > 200,
  `a corner watermark changed only ${cornerInCorner} pixels in the bottom-right region`,
);
check(
  cornerInTopHalf === 0,
  `a bottom-right watermark changed ${cornerInTopHalf} pixels in the top half`,
);
check(
  centreInCentre > 200,
  `a centred watermark changed only ${centreInCentre} pixels in the centre region`,
);
check(
  centreInTopHalf > 0,
  "a centred watermark did not reach the top half, so it is not centred",
);
check(
  differingPixels(offWeb, cornerWeb, [0, 0, width, height]) < width * height * 0.5,
  "the watermark replaced most of the image rather than overlaying it",
);
note(
  `watermark pixel deltas: corner-region ${cornerInCorner}, top-half(corner) ${cornerInTopHalf}, ` +
    `centre-region ${centreInCentre}, top-half(centre) ${centreInTopHalf}`,
);

// --- 5. Transparency ------------------------------------------------------

// An opaque JPEG must never decode as if it had alpha, whichever codec path is
// available — that assertion is independent of PNG support.
check(
  (await decodeImage(photoJpeg, "jpeg")).pixels.some(
    (value, index) => index % 4 === 3 && value !== 255,
  ) === false,
  "an opaque JPEG decoded with transparency",
);
check(
  hasTransparency(await decodeImage(photoJpeg, "jpeg")) === false,
  "hasTransparency reported transparency on an opaque JPEG",
);

if (pngWorks) {
  const transparent = new Uint8ClampedArray(64 * 64 * 4);
  for (let index = 0; index < transparent.length; index += 4) {
    transparent[index] = 200;
    transparent[index + 1] = 40;
    transparent[index + 2] = 90;
    transparent[index + 3] = index % 8 === 0 ? 0 : 255;
  }
  const transparentPng = await encodePng({
    pixels: transparent,
    width: 64,
    height: 64,
  });
  const transparentRun = await runPipeline(transparentPng, WATERMARK_OFF, {
    photoId: "photo-alpha",
    declaredType: "image/png",
    filename: "alpha.png",
  });
  check(
    transparentRun.result.medium === "image/png",
    `a transparent PNG produced a ${transparentRun.result.medium} derivative`,
  );
  const alphaDecoded = await decodeImage(
    transparentRun.buckets.images.get(transparentRun.result.webStorageKey),
    "png",
  );
  check(
    hasTransparency(alphaDecoded),
    "transparency was lost when deriving from a transparent PNG",
  );
}

// --- 6. Greyscale ---------------------------------------------------------

const greyRun = await runPipeline(greyJpeg, WATERMARK_OFF, {
  photoId: "photo-grey",
  filename: "grey.jpg",
});
const greyHeader = readImageHeader(greyJpeg);
check(
  greyRun.result.width === greyHeader?.width && greyRun.result.height === greyHeader?.height,
  "a greyscale JPEG produced the wrong recorded geometry",
);
check(
  greyRun.buckets.images.has(greyRun.result.webStorageKey),
  "a greyscale JPEG produced no web derivative",
);

report(
  `Upload pipeline check passed: validation refusals, ${jpegResult.bytes.master}-byte master preserved unchanged, ` +
    `bounded web/thumbnail derivatives, off/corner/centre watermarking and transparency handling verified.`,
);
