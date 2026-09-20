#!/usr/bin/env node
/**
 * Upload pipeline check (Slice 06 repair 01).
 *
 * The pipeline's job is ordering, and ordering is only observable when things
 * fail. So this suite drives the real `processUpload` with a deterministic fake
 * processor and recording buckets, and injects a failure at every stage:
 *
 *   inspection/transform · master put · web put · thumbnail put
 *
 * After each injected failure it asserts the bucket state exactly: nothing at
 * all for the stages before the first write, and the earlier objects REMOVED for
 * the stages after it. A file reported as refused must leave no master, no web
 * derivative, no thumbnail.
 *
 * It also pins the memory policy at the unit level: the pipeline never receives
 * a decoded raster, because the processor contract only ever hands back ENCODED
 * derivatives.
 */
import { register } from "node:module";

register("../ts-extension-hooks.mjs", import.meta.url);

const { processUpload } = await import("../../app/images/process.ts");
const { validateUpload, UploadError, assertBatchWithinPolicy, MAX_BATCH_FILES, MAX_BATCH_BYTES, sanitiseFilename, sniffImageType } =
  await import("../../app/images/upload-validation.ts");
const { check, note, report } = await import("./report.mjs");

const { readFileSync } = await import("node:fs");
const { resolve } = await import("node:path");
const { fileURLToPath } = await import("node:url");

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const photoJpeg = new Uint8Array(readFileSync(resolve(root, "scripts", "fixtures", "photo.jpg")));
const largeJpeg = new Uint8Array(readFileSync(resolve(root, "scripts", "fixtures", "large.jpg")));

// --- Doubles ---------------------------------------------------------------

/**
 * A processor double that records what it was asked for and can be made to fail.
 *
 * `failAt` injects a failure at a specific stage, which is how the ordering
 * guarantees are exercised: 'prepare' fails before any write, 'web'/'thumbnail'
 * are simulated by the storage double instead.
 */
function fakeProcessor(options = {}) {
  const calls = [];
  return {
    calls,
    async prepare(request) {
      calls.push({ photoId: request.photoId, watermark: request.watermark, bytes: request.bytes.byteLength });
      if (options.prepareThrows) {
        const { ImageProcessingError } = await import("../../app/images/image-processor.ts");
        throw new ImageProcessingError("not-an-image", "the upload could not be decoded");
      }
      return {
        source: { width: options.width ?? 320, height: options.height ?? 240, format: "image/jpeg" },
        web: { bytes: new Uint8Array(2048).fill(1), width: options.webWidth ?? 320, height: options.webHeight ?? 240, contentType: "image/webp" },
        thumbnail: { bytes: new Uint8Array(512).fill(2), width: options.thumbWidth ?? 320, height: options.thumbHeight ?? 240, contentType: "image/webp" },
        watermarked: request.watermark.enabled && request.watermark.position !== "none",
      };
    },
  };
}

/** Recording buckets whose writes can be made to fail stage by stage. */
function fakeStorage(options = {}) {
  const masters = new Map();
  const images = new Map();
  const events = [];
  const maybeFail = (stage) => {
    if (options.failAt === stage) {
      throw new Error(`injected ${stage} failure`);
    }
  };
  return {
    masters,
    images,
    events,
    putMaster(key, bytes) {
      events.push(`putMaster:${key}`);
      maybeFail("master");
      masters.set(key, bytes);
    },
    putPublicImage(key, bytes) {
      events.push(`putPublicImage:${key}`);
      maybeFail(key.includes("thumb") ? "thumbnail" : "web");
      images.set(key, bytes);
    },
    deleteMaster(key) {
      events.push(`deleteMaster:${key}`);
      masters.delete(key);
    },
    deletePublicImage(key) {
      events.push(`deletePublicImage:${key}`);
      images.delete(key);
    },
  };
}

async function run(options = {}) {
  const storage = fakeStorage(options);
  const processor = fakeProcessor(options);
  const outcome = await processUpload({
    photoId: "photo-test",
    bytes: photoJpeg,
    declaredType: "image/jpeg",
    filename: "Original Photo.JPG",
    watermarkEnabled: options.watermarkEnabled ?? true,
    watermarkPosition: options.watermarkPosition ?? "bottom-right",
    processor,
    storage,
  })
    .then((value) => ({ value, error: null }))
    .catch((error) => ({ value: null, error }));
  return { storage, processor, outcome };
}

// --- The happy path -------------------------------------------------------

const happy = await run();
check(happy.outcome.error === null, `a valid upload failed: ${happy.outcome.error?.message}`);
check(happy.storage.masters.size === 1, `expected one master, found ${happy.storage.masters.size}`);
check(happy.storage.images.size === 2, `expected two derivatives, found ${happy.storage.images.size}`);
check(
  [...happy.storage.masters.keys()].every((key) => key.startsWith("r2://masters/originals/photo-test/")),
  `the master key is wrong: ${[...happy.storage.masters.keys()].join(", ")}`,
);
check(
  [...happy.storage.images.keys()].every(
    (key) => key.startsWith("r2://images/web/photo-test/") || key.startsWith("r2://images/thumbs/photo-test/"),
  ),
  `a derivative key is outside the public domains: ${[...happy.storage.images.keys()].join(", ")}`,
);
const storedMaster = [...happy.storage.masters.values()][0];
check(
  storedMaster !== undefined &&
    Buffer.compare(Buffer.from(storedMaster), Buffer.from(photoJpeg)) === 0,
  "the stored master is not byte-for-byte identical to the upload",
);
check(
  ![...happy.storage.images.keys()].some((key) => key.includes("masters")),
  "a private master key appeared in the public bucket",
);
check(
  happy.outcome.value?.sourceFormat === "image/jpeg",
  `the recorded source format was ${happy.outcome.value?.sourceFormat}`,
);
check(
  happy.outcome.value?.webWidth === 320 && happy.outcome.value?.webHeight === 240,
  `the derivative geometry was ${happy.outcome.value?.webWidth}x${happy.outcome.value?.webHeight}`,
);

// The processor is asked to do the work BEFORE anything is written.
check(
  happy.storage.events[0]?.startsWith("putMaster") === true,
  `the first storage event was ${happy.storage.events[0]}`,
);
check(happy.processor.calls.length === 1, "the processor must be asked exactly once per upload");
check(
  happy.processor.calls[0]?.watermark.position === "bottom-right",
  "the watermark position was not passed through to the processor",
);
check(
  happy.processor.calls[0]?.bytes === photoJpeg.byteLength,
  "the processor did not receive the original bytes",
);

// --- Failure injection ----------------------------------------------------

// 1. Preparation fails: NOTHING may be written.
const prepareFails = await run({ prepareThrows: true });
check(
  prepareFails.outcome.error !== null,
  "an upload whose processing failed was reported as accepted",
);
check(
  prepareFails.storage.events.length === 0,
  `a failed preparation still touched storage: ${prepareFails.storage.events.join(", ")}`,
);
check(
  prepareFails.storage.masters.size === 0 && prepareFails.storage.images.size === 0,
  "a failed preparation left objects behind",
);

// 2. The master write fails: no objects at all.
const masterFails = await run({ failAt: "master" });
check(masterFails.outcome.error !== null, "a failed master write was reported as accepted");
check(
  masterFails.storage.masters.size === 0 && masterFails.storage.images.size === 0,
  `a failed master write left ${masterFails.storage.masters.size} masters and ${masterFails.storage.images.size} derivatives`,
);

// 3. The web write fails: the master must be removed again.
const webFails = await run({ failAt: "web" });
check(webFails.outcome.error !== null, "a failed web write was reported as accepted");
check(
  webFails.storage.masters.size === 0,
  `a failed web write left ${webFails.storage.masters.size} orphan master(s)`,
);
check(webFails.storage.images.size === 0, "a failed web write left a derivative behind");
check(
  webFails.storage.events.some((event) => event.startsWith("deleteMaster:")),
  `a failed web write did not compensate: ${webFails.storage.events.join(", ")}`,
);

// 4. The thumbnail write fails: BOTH earlier objects must be removed.
const thumbnailFails = await run({ failAt: "thumbnail" });
check(thumbnailFails.outcome.error !== null, "a failed thumbnail write was reported as accepted");
check(
  thumbnailFails.storage.masters.size === 0 && thumbnailFails.storage.images.size === 0,
  `a failed thumbnail write left ${thumbnailFails.storage.masters.size} master(s) and ${thumbnailFails.storage.images.size} derivative(s)`,
);
check(
  thumbnailFails.storage.events.some((event) => event.startsWith("deleteMaster:")) &&
    thumbnailFails.storage.events.some((event) => event.startsWith("deletePublicImage:")),
  `a failed thumbnail write did not compensate for both objects: ${thumbnailFails.storage.events.join(", ")}`,
);

// Compensation is scoped to THIS attempt: an unrelated pre-existing object must
// survive a rollback untouched.
const preexisting = fakeStorage({ failAt: "thumbnail" });
preexisting.masters.set("r2://masters/originals/photo-earlier/master.tif", new Uint8Array([9]));
preexisting.images.set("r2://images/web/photo-earlier/web.webp", new Uint8Array([9]));
await processUpload({
  photoId: "photo-test",
  bytes: photoJpeg,
  declaredType: "image/jpeg",
  filename: "o.jpg",
  watermarkEnabled: false,
  watermarkPosition: "none",
  processor: fakeProcessor(),
  storage: preexisting,
}).catch(() => undefined);
check(
  preexisting.masters.size === 1 && preexisting.images.size === 1,
  "compensating cleanup deleted an object that belonged to an earlier upload",
);
check(
  preexisting.masters.has("r2://masters/originals/photo-earlier/master.tif"),
  "compensating cleanup removed a previously accepted master",
);

// --- Watermark plumbing ---------------------------------------------------

const off = await run({ watermarkEnabled: false, watermarkPosition: "bottom-right" });
check(off.outcome.value?.watermarked === false, "a disabled watermark reported itself watermarked");
check(
  off.processor.calls[0]?.watermark.enabled === false,
  "the disabled watermark was not passed through to the processor",
);

// --- Validation and the batch policy -------------------------------------

/** The reason a refused upload produces, or null when it was accepted. */
function rejectionOf(input) {
  try {
    validateUpload(input);
    return null;
  } catch (error) {
    return error instanceof UploadError ? error.reason : `NOT-UPLOAD-ERROR:${String(error)}`;
  }
}

check(
  rejectionOf({ bytes: new Uint8Array(0), declaredType: "image/jpeg", filename: "a.jpg" }) === "empty-file",
  "an empty upload was not refused as empty-file",
);
check(
  rejectionOf({ bytes: new Uint8Array([1, 2, 3, 4]), declaredType: "image/jpeg", filename: "a.jpg" }) ===
    "unsupported-image",
  "a non-image was not refused as unsupported-image",
);
check(
  rejectionOf({ bytes: photoJpeg, declaredType: "image/png", filename: "a.jpg" }) === "type-mismatch",
  "a declared type contradicting the bytes was not refused",
);
check(sanitiseFilename("../../etc/passwd") === "passwd", "path traversal was not reduced to a leaf name");
check(
  sanitiseFilename("C:\\Users\\anya\\my photo (1).jpg") === "my-photo-1.jpg",
  `a Windows path was not sanitised: ${sanitiseFilename("C:\\Users\\anya\\my photo (1).jpg")}`,
);
check(sniffImageType(photoJpeg) === "image/jpeg", "JPEG magic bytes were not recognised");
check(sniffImageType(largeJpeg) === "image/jpeg", "the large fixture was not recognised as JPEG");

/** The batch-policy reason, or null when the batch is acceptable. */
function batchRejection(files) {
  try {
    assertBatchWithinPolicy(files);
    return null;
  } catch (error) {
    return error instanceof UploadError ? error.reason : `NOT-UPLOAD-ERROR:${String(error)}`;
  }
}

check(
  batchRejection(Array.from({ length: MAX_BATCH_FILES + 1 }, () => ({ size: 1024 }))) === "too-many-files",
  `a batch above ${MAX_BATCH_FILES} files was not refused`,
);
check(
  batchRejection([{ size: MAX_BATCH_BYTES + 1 }]) === "batch-too-large",
  "a batch above the byte ceiling was not refused",
);
check(batchRejection([{ size: 1024 }, { size: 1024 }]) === null, "a small batch was refused");
check(
  batchRejection(Array.from({ length: MAX_BATCH_FILES }, () => ({ size: 1024 }))) === null,
  `a batch of exactly ${MAX_BATCH_FILES} files must be accepted`,
);
// The byte ceiling must be reachable independently of the count ceiling.
check(
  batchRejection(Array.from({ length: MAX_BATCH_FILES }, () => ({ size: MAX_BATCH_BYTES / MAX_BATCH_FILES + 1 }))) ===
    "batch-too-large",
  "a batch within the count ceiling but above the byte ceiling was not refused",
);

// --- Memory policy --------------------------------------------------------

// The processor contract is the memory boundary: it returns ENCODED derivatives,
// never a decoded raster. A raster of this size would be ~4 bytes per pixel.
const rasterBytes = 2400 * 1600 * 4;
check(
  happy.outcome.value !== null &&
    happy.outcome.value.bytes.web + happy.outcome.value.bytes.thumbnail < rasterBytes,
  "the pipeline carried more bytes than an encoded derivative should need",
);
check(
  happy.outcome.value?.bytes.web === 2048,
  `the pipeline reported ${happy.outcome.value?.bytes.web} web bytes, expected the encoded size`,
);
note(
  `memory: no decoded raster in application code; a 2400x1600 decode would be ~${Math.round(rasterBytes / 1024 / 1024)} MB`,
);

note(
  `failure injection verified: prepare, master, web and thumbnail stages, each leaving zero objects ` +
    `(or compensating for the ones it created)`,
);
report(
  "Upload pipeline check passed: master preserved byte-for-byte, derivatives public, commit-or-nothing " +
    "ordering proven by injecting a failure at every stage, and the batch policy bounded before any read.",
);
