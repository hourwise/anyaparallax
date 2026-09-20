#!/usr/bin/env node
/**
 * Upload HTTP boundary check (Slice 06 repair 02).
 *
 * The memory policy is only real if it is enforced at the HTTP boundary, before
 * anything is allocated. Repair 01's orchestration already refused an oversized
 * batch, but the route had already read every file body by then — the policy
 * could not prevent the allocation it existed to prevent.
 *
 * This suite asserts the boundary itself, in the order the route applies it:
 *
 *   1. `Content-Length` — refused from the HEADERS, before parsing. A request
 *      with no usable length is refused rather than read, because an unbounded
 *      request cannot be given a ceiling.
 *   2. Parsed file metadata — the batch policy runs on `size` and count BEFORE a
 *      single `readBytes()` call, so an unacceptable submission costs no file
 *      bodies at all.
 *   3. Sequential reads — the orchestration loop reads one file at a time, which
 *      is asserted by instrumenting the readers rather than by reading the code.
 *
 * A note on honesty: `Request.formData()` DOES buffer the multipart body, and no
 * bounded streaming parser is implemented here. What is proven is that an
 * oversized or unbounded request never reaches that point, and that at most one
 * file body is alive at a time afterwards. The assertions below say exactly that.
 */
import { register } from "node:module";

register("../ts-extension-hooks.mjs", import.meta.url);

const {
  assertRequestWithinLimit,
  declaredContentLength,
  fileSourcesFrom,
  MAX_UPLOAD_REQUEST_BYTES,
  MAX_MULTIPART_OVERHEAD_BYTES,
} = await import("../../app/images/upload-request.server.ts");
const { UploadError, MAX_BATCH_BYTES, MAX_BATCH_FILES } = await import(
  "../../app/images/upload-validation.ts"
);
const { ingestUploads } = await import("../../app/images/upload.server.ts");
const { check, note, report } = await import("./report.mjs");

const { readFileSync } = await import("node:fs");
const { resolve } = await import("node:path");
const { fileURLToPath } = await import("node:url");

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const photoJpeg = new Uint8Array(readFileSync(resolve(root, "scripts", "fixtures", "photo.jpg")));

// --- 1. The header gate, before any parsing -------------------------------

/** Run the header gate and report the refusal reason, or null when accepted. */
function headerGate(headers) {
  const request = new Request("http://localhost/admin/upload", { method: "POST", headers });
  try {
    return { length: assertRequestWithinLimit(request), reason: null };
  } catch (error) {
    return { length: null, reason: error instanceof UploadError ? error.reason : String(error) };
  }
}

check(
  declaredContentLength(new Request("http://localhost/x", { headers: { "content-length": "4096" } })) ===
    4096,
  "a plain Content-Length was not read",
);
check(
  declaredContentLength(new Request("http://localhost/x", { headers: { "content-length": "abc" } })) ===
    null,
  "a non-numeric Content-Length was accepted as a length",
);
check(
  declaredContentLength(new Request("http://localhost/x", { headers: { "content-length": "-5" } })) ===
    null,
  "a negative Content-Length was accepted as a length",
);
check(
  declaredContentLength(new Request("http://localhost/x")) === null,
  "an absent Content-Length was reported as a length",
);

// The ceiling is the batch budget plus a multipart allowance, and the allowance
// must be a real allowance rather than a rounding detail.
check(
  MAX_UPLOAD_REQUEST_BYTES === MAX_BATCH_BYTES + MAX_MULTIPART_OVERHEAD_BYTES,
  `the request ceiling (${MAX_UPLOAD_REQUEST_BYTES}) is not the batch budget plus the multipart allowance`,
);
check(
  MAX_MULTIPART_OVERHEAD_BYTES > 0,
  "there is no multipart overhead allowance, so a legitimate maximum batch would be refused",
);

const atLimit = headerGate({ "content-length": String(MAX_UPLOAD_REQUEST_BYTES) });
check(atLimit.reason === null, `a request exactly at the ceiling was refused: ${atLimit.reason}`);

const overLimit = headerGate({ "content-length": String(MAX_UPLOAD_REQUEST_BYTES + 1) });
check(
  overLimit.reason === "request-too-large",
  `a request above the ceiling reported ${overLimit.reason}, expected request-too-large`,
);

const noLength = headerGate({});
check(
  noLength.reason === "length-required",
  `a request without a length reported ${noLength.reason}, expected length-required`,
);
const badLength = headerGate({ "content-length": "not-a-number" });
check(
  badLength.reason === "length-required",
  `a request with an unusable length reported ${badLength.reason}, expected length-required`,
);

// The header gate must not consume the body: the same request must still be
// parseable afterwards, which is what "before the body is read" means.
const parseable = new Request("http://localhost/admin/upload", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "11" },
  body: "photos=abc&",
});
check(assertRequestWithinLimit(parseable) === 11, "the header gate refused a legitimate request");
const parsedAfterGate = await parseable.formData();
check(
  parsedAfterGate.get("photos") === "abc",
  "the header gate consumed the body, so a later parse saw nothing",
);
note("the header gate reads only headers: the body remained parseable afterwards");

// --- 2. Metadata gate, before any body read -------------------------------

/** Build a multipart form with `count` file parts of `size` bytes each. */
function formWithFiles(count, size, type = "image/jpeg") {
  const form = new FormData();
  for (let index = 0; index < count; index += 1) {
    form.append(
      "photos",
      new Blob([new Uint8Array(size)], { type }),
      `file-${index}.jpg`,
    );
  }
  return form;
}

/** How many times `readBytes` was called on the sources a helper returned. */
function trackingIngest(files, options = {}) {
  const reads = [];
  let active = 0;
  let maxActive = 0;
  const instrumented = files.map((file) => ({
    ...file,
    readBytes: async () => {
      reads.push(file.filename);
      active += 1;
      maxActive = Math.max(maxActive, active);
      const bytes = await file.readBytes();
      active -= 1;
      return bytes;
    },
  }));
  // The processor is a refusal double: it proves the loop reached a file without
  // performing any real work, and each file's failure is recorded per-file rather
  // than thrown, so a multi-file run completes and the read log is complete.
  const settled = ingestUploads({
    // The buckets are doubles; `ALLOW_DEVELOPMENT_SEED` selects the in-process
    // seed repository so this check needs no database. The policy gates run
    // before either is consulted, which is what the assertions depend on.
    env: { MASTERS: fakeBucket(), IMAGES: fakeBucket(), ALLOW_DEVELOPMENT_SEED: "true" },
    files: instrumented,
    options: {
      title: "boundary",
      description: "",
      galleryId: "gallery-nightlife",
      tags: [],
      location: null,
      captureDate: null,
      watermarkEnabled: false,
      watermarkPosition: "none",
      published: false,
      featured: false,
      printAvailable: false,
    },
    processorFactory: async () => ({
      async prepare() {
        throw new Error("the processor must not be reached in this check");
      },
    }),
    ...options,
  })
    .then(() => null)
    .catch((error) => (error instanceof UploadError ? error.reason : String(error)));
  return { reads, maxActive: () => maxActive, refusal: settled };
}

/** The minimum bucket surface the orchestration checks before refusing. */
function fakeBucket() {
  return {
    async put() {},
    async get() {
      return null;
    },
    async head() {
      return null;
    },
    async delete() {},
  };
}

// Eleven files: above the count ceiling. The policy must refuse before any body
// is read, so `reads` must be empty and no reader may even be constructed.
const tooMany = trackingIngest(
  Array.from({ length: MAX_BATCH_FILES + 1 }, (_value, index) => ({
    filename: `file-${index}.jpg`,
    declaredType: "image/jpeg",
    size: 1024,
    readBytes: async () => photoJpeg,
  })),
);
check(
  (await tooMany.refusal) === "too-many-files",
  `eleven files reported ${await tooMany.refusal}, expected too-many-files`,
);
check(tooMany.reads.length === 0, `eleven files triggered ${tooMany.reads.length} reads before refusal`);
note("11 files rejected with zero readBytes calls");

// A total above the byte ceiling but within the count ceiling: also refused
// before any read.
const oversized = trackingIngest(
  Array.from({ length: MAX_BATCH_FILES }, (_value, index) => ({
    filename: `big-${index}.jpg`,
    declaredType: "image/jpeg",
    size: Math.ceil(MAX_BATCH_BYTES / MAX_BATCH_FILES) + 1,
    readBytes: async () => photoJpeg,
  })),
);
check(
  (await oversized.refusal) === "batch-too-large",
  `an oversized batch reported ${await oversized.refusal}, expected batch-too-large`,
);
check(oversized.reads.length === 0, `an oversized batch triggered ${oversized.reads.length} reads`);
note(`a declared total above ${MAX_BATCH_BYTES} bytes rejected with zero readBytes calls`);

// `fileSourcesFrom` is the route's own gate: it must apply the policy to the
// parsed metadata, and it must not read anything to do it.
const parsedForm = formWithFiles(MAX_BATCH_FILES + 1, 16);
let sourcesRefusal = null;
try {
  fileSourcesFrom(parsedForm);
} catch (error) {
  sourcesRefusal = error instanceof UploadError ? error.reason : String(error);
}
check(
  sourcesRefusal === "too-many-files",
  `fileSourcesFrom reported ${sourcesRefusal} for too many files`,
);
const acceptedSources = fileSourcesFrom(formWithFiles(2, 32));
check(acceptedSources.length === 2, `fileSourcesFrom returned ${acceptedSources.length} sources for 2 files`);
check(
  acceptedSources.every((source) => source.size === 32 && typeof source.readBytes === "function"),
  "a source did not expose its declared size and a reader",
);
check(
  acceptedSources.every((source) => !("bytes" in source)),
  "a source carried materialised bytes, so the read could not be lazy",
);

// --- 3. Sequential reads --------------------------------------------------

// Two acceptable files, with a processor that succeeds so the loop runs to the
// end. The instrumentation counts how many readers are active at once.
const sequential = trackingIngest(
  [
    {
      filename: "one.jpg",
      declaredType: "image/jpeg",
      size: photoJpeg.byteLength,
      readBytes: async () => photoJpeg,
    },
    {
      filename: "two.jpg",
      declaredType: "image/jpeg",
      size: photoJpeg.byteLength,
      readBytes: async () => photoJpeg,
    },
    {
      filename: "three.jpg",
      declaredType: "image/jpeg",
      size: photoJpeg.byteLength,
      readBytes: async () => photoJpeg,
    },
  ],
  {},
);
await sequential.refusal;
check(
  sequential.maxActive() <= 1,
  `up to ${sequential.maxActive()} file reads were active at once, so reads are not sequential`,
);
check(
  sequential.maxActive() === 1,
  "no file was actually read, so the sequencing assertion proves nothing",
);
note(`maximum simultaneous file reads: ${sequential.maxActive()}`);

report(
  "Upload HTTP boundary check passed: an oversized or unbounded request is refused from its headers, the batch " +
    "policy runs on parsed metadata before any file body is read, and file bodies are read one at a time.",
);
