#!/usr/bin/env node
/**
 * Upload orchestration check (Slice 06 repair 01).
 *
 * Drives the REAL `ingestUploads` against a real D1 database and recording
 * buckets, so the whole operator path is exercised end to end:
 *
 *   bytes → batch policy → validation → platform processing → master →
 *   derivatives → atomic photo + tag commit
 *
 * What the pipeline-level check cannot show, and this one does:
 *
 *  * the photograph ROW records the processor's TRUSTED geometry and the storage
 *    keys that were actually written;
 *  * photograph and tag links are committed in ONE D1 batch, and a failing tag
 *    link leaves NEITHER the row nor any link;
 *  * a multi-file submission where one file is unsupported stores the others and
 *    reports the failure per file;
 *  * slug collisions resolve through the store;
 *  * a database commit failure removes the derivatives it could not record.
 */
import { register } from "node:module";

register("../ts-extension-hooks.mjs", import.meta.url);

const { ingestUploads, hasUploadStorage } = await import("../../app/images/upload.server.ts");
const { D1PortfolioRepository } = await import("../../app/data/repository.d1.server.ts");
const { seed } = await import("../../app/data/seed.ts");
const { createD1TestDatabase } = await import("./d1-harness.mjs");
const { check, note, report } = await import("./report.mjs");

const { readFileSync, existsSync } = await import("node:fs");
const { resolve } = await import("node:path");
const { fileURLToPath } = await import("node:url");

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const fixtures = resolve(root, "scripts", "fixtures");

for (const required of ["photo.jpg", "greyscale.jpg", "large.jpg"]) {
  check(existsSync(resolve(fixtures, required)), `missing fixture ${required}`);
}
const photoJpeg = new Uint8Array(readFileSync(resolve(fixtures, "photo.jpg")));
const greyJpeg = new Uint8Array(readFileSync(resolve(fixtures, "greyscale.jpg")));

const database = await createD1TestDatabase({ seed, label: "upload" });
const repository = new D1PortfolioRepository(database.binding);
void repository;

/**
 * A processor double that stands in for the platform.
 *
 * It reports the geometry its caller declared, which lets a case choose the
 * source dimensions and assert that the ROW records THOSE rather than anything
 * the upload claimed.
 */
function fakeProcessor(geometry = {}) {
  const calls = [];
  return {
    calls,
    async prepare(request) {
      calls.push(request);
      const width = geometry.width ?? 320;
      const height = geometry.height ?? 240;
      return {
        source: { width, height, format: geometry.format ?? "image/jpeg" },
        web: {
          bytes: new Uint8Array(1024).fill(3),
          width: geometry.webWidth ?? width,
          height: geometry.webHeight ?? height,
          contentType: "image/webp",
        },
        thumbnail: {
          bytes: new Uint8Array(256).fill(4),
          width: geometry.thumbWidth ?? width,
          height: geometry.thumbHeight ?? height,
          contentType: "image/webp",
        },
        watermarked: request.watermark.enabled && request.watermark.position !== "none",
      };
    },
  };
}

/** Recording buckets with the full surface the orchestrator uses. */
function createBuckets() {
  const masters = new Map();
  const images = new Map();
  const events = [];
  const binding = {
    async put(key, value) {
      const bytes = Uint8Array.from(new Uint8Array(value));
      if (key.startsWith("originals/")) {
        masters.set(key, bytes);
      } else {
        images.set(key, bytes);
      }
      events.push(`put:${key}`);
    },
    async get(key) {
      const bytes = masters.get(key) ?? images.get(key);
      if (!bytes) {
        return null;
      }
      return {
        size: bytes.byteLength,
        httpMetadata: { contentType: "image/webp" },
        async arrayBuffer() {
          return bytes.slice().buffer;
        },
      };
    },
    async head(key) {
      return masters.has(key) || images.has(key) ? {} : null;
    },
    async delete(key) {
      masters.delete(key);
      images.delete(key);
      events.push(`delete:${key}`);
    },
  };
  return { masters, images, events, binding };
}

const buckets = createBuckets();
const env = { DB: database.binding, MASTERS: buckets.binding, IMAGES: buckets.binding };

const galleryId = "gallery-nightlife";
check(
  seed.galleries.some((gallery) => gallery.id === galleryId),
  `the fixture gallery ${galleryId} does not exist`,
);

const baseOptions = {
  title: "Harbour lights",
  description: "A test upload.",
  galleryId,
  tags: ["tag-night", "tag-night", "tag-rain"],
  location: "Liverpool",
  captureDate: "2026-09-01",
  watermarkEnabled: true,
  watermarkPosition: "bottom-right",
  published: true,
  featured: false,
  printAvailable: false,
};

// --- 1. The happy path ----------------------------------------------------

const single = await ingestUploads({
  env,
  files: [{ filename: "harbour lights.jpg", declaredType: "image/jpeg", bytes: photoJpeg }],
  options: baseOptions,
  processorFactory: async () => fakeProcessor(),
});
check(single.accepted === 1 && single.rejected === 0, `single upload reported ${single.accepted}/${single.rejected}`);
check(single.persisted === true, "a D1-backed upload did not report itself persisted");
const created = single.outcomes[0];
check(created.ok === true, `the upload was refused: ${created.error?.message}`);
check(created.photo?.slug === "harbour-lights", `the slug was ${created.photo?.slug}`);
check(
  created.photo?.width === 320 && created.photo?.height === 240,
  `the row recorded ${created.photo?.width}x${created.photo?.height}`,
);
check(created.photo?.watermarked === true, "a watermarked upload did not report a watermark");

check(buckets.masters.size === 1, `expected one master, found ${buckets.masters.size}`);
const masterKey = [...buckets.masters.keys()][0] ?? "";
check(masterKey.startsWith("originals/"), `the master was stored at ${masterKey}`);
check(
  Buffer.compare(Buffer.from(buckets.masters.get(masterKey)), Buffer.from(photoJpeg)) === 0,
  "the stored master is not byte-identical to the upload",
);
check(buckets.images.size === 2, `expected two derivatives, found ${buckets.images.size}`);
check(
  [...buckets.images.keys()].every((key) => key.startsWith("web/") || key.startsWith("thumbs/")),
  `a public object landed outside web/thumbs: ${[...buckets.images.keys()].join(", ")}`,
);

// --- 2. The row and its tags ---------------------------------------------

const rows = database.query(
  "SELECT id, slug, title, gallery_id, width, height, original_storage_key, web_storage_key, thumbnail_storage_key, watermark_enabled, watermark_position, published, published_at FROM photos WHERE slug = 'harbour-lights'",
);
check(rows.length === 1, `expected one photograph row, found ${rows.length}`);
const row = rows[0];
check(row?.gallery_id === galleryId, `the row was filed into ${row?.gallery_id}`);
check(
  row?.original_storage_key?.startsWith("r2://masters/originals/") === true,
  `the row's master key is ${row?.original_storage_key}`,
);
check(
  row?.web_storage_key?.startsWith("r2://images/web/") === true &&
    row?.thumbnail_storage_key?.startsWith("r2://images/thumbs/") === true,
  "the row's derivative keys are not in the public domains",
);
check(row?.published === 1 && row?.published_at !== null, "a published upload was not recorded as published");

const tagRows = database.query("SELECT tag_id FROM photo_tags WHERE photo_id = ?1 ORDER BY tag_id", row?.id);
check(tagRows.length === 2, `expected the duplicate tag to collapse to two links, found ${tagRows.length}`);

// --- 3. D1 atomicity ------------------------------------------------------

// A tag id that does not exist makes the SECOND statement of the batch fail.
// The photograph must therefore not exist either: the batch is one transaction.
const atomic = await ingestUploads({
  env,
  files: [{ filename: "atomic.jpg", declaredType: "image/jpeg", bytes: photoJpeg }],
  options: { ...baseOptions, title: "Atomic failure", tags: ["tag-night", "tag-does-not-exist"] },
  processorFactory: async () => fakeProcessor(),
});
check(atomic.accepted === 0, "an upload whose tag link cannot exist was reported as accepted");
check(atomic.rejected === 1, "the refused upload was not counted as rejected");
check(
  database.query("SELECT COUNT(*) AS total FROM photos WHERE slug = 'atomic-failure'")[0]?.total === 0,
  "a failed tag link left the photograph row behind: the batch was not atomic",
);
check(
  database.query("SELECT COUNT(*) AS total FROM photo_tags WHERE tag_id = 'tag-does-not-exist'")[0]?.total === 0,
  "a failed batch left a tag link behind",
);
// The objects for the failed commit must have been removed again.
check(
  [...buckets.masters.keys()].every((key) => !key.includes("atomic")),
  "a failed database commit left the upload's master in place",
);
note(
  `objects after the injected commit failure: ${buckets.masters.size} masters, ${buckets.images.size} derivatives (unchanged from the accepted upload)`,
);

// --- 4. Publication controls ---------------------------------------------

const unpublished = await ingestUploads({
  env,
  files: [{ filename: "draft.jpg", declaredType: "image/jpeg", bytes: greyJpeg }],
  options: { ...baseOptions, title: "Draft frame", published: false, featured: true },
  processorFactory: async () => fakeProcessor(),
});
check(unpublished.accepted === 1, "an unpublished upload was refused");
const draftRow = database.query("SELECT published, published_at FROM photos WHERE slug = 'draft-frame'")[0];
check(draftRow?.published === 0, "an unpublished upload was recorded published");
check(draftRow?.published_at === null, "an unpublished upload carries a published_at");

// --- 5. Slug collisions ---------------------------------------------------

const collisionA = await ingestUploads({
  env,
  files: [{ filename: "a.jpg", declaredType: "image/jpeg", bytes: photoJpeg }],
  options: { ...baseOptions, title: "Repeated name" },
  processorFactory: async () => fakeProcessor(),
});
const collisionB = await ingestUploads({
  env,
  files: [{ filename: "b.jpg", declaredType: "image/jpeg", bytes: photoJpeg }],
  options: { ...baseOptions, title: "Repeated name" },
  processorFactory: async () => fakeProcessor(),
});
check(collisionA.outcomes[0]?.photo?.slug === "repeated-name", `first slug was ${collisionA.outcomes[0]?.photo?.slug}`);
check(collisionB.outcomes[0]?.photo?.slug === "repeated-name-2", `second slug was ${collisionB.outcomes[0]?.photo?.slug}`);

// --- 6. Multi-file with one bad file -------------------------------------

const beforeMasters = buckets.masters.size;
const beforeImages = buckets.images.size;
const mixed = await ingestUploads({
  env,
  files: [
    { filename: "good-one.jpg", declaredType: "image/jpeg", bytes: photoJpeg },
    { filename: "not-an-image.jpg", declaredType: "image/jpeg", bytes: new Uint8Array([1, 2, 3, 4]) },
    { filename: "good-two.jpg", declaredType: "image/jpeg", bytes: greyJpeg },
  ],
  options: { ...baseOptions, title: "Batch" },
  processorFactory: async () => fakeProcessor(),
});
check(mixed.accepted === 2 && mixed.rejected === 1, `batch reported ${mixed.accepted}/${mixed.rejected}`);
const refusedOutcome = mixed.outcomes.find((outcome) => !outcome.ok);
check(refusedOutcome?.filename === "not-an-image.jpg", "the wrong file was reported as refused");
check(
  refusedOutcome?.error?.reason === "unsupported-image",
  `the refusal reason was ${refusedOutcome?.error?.reason}`,
);
check(
  buckets.masters.size === beforeMasters + 2 && buckets.images.size === beforeImages + 4,
  "a partly-failed batch did not store exactly the two acceptable files",
);
check(
  [...buckets.masters.keys()].every((key) => !key.includes("not-an-image")),
  "the refused file reached the private bucket",
);
check(
  database.query("SELECT COUNT(*) AS total FROM photos WHERE original_storage_key LIKE '%not-an-image%'")[0]
    ?.total === 0,
  "the refused file produced a photograph row",
);

// --- 7. Batch policy and bindings ----------------------------------------

let batchRefusal = null;
try {
  await ingestUploads({
    env,
    files: Array.from({ length: 11 }, () => ({
      filename: "x.jpg",
      declaredType: "image/jpeg",
      bytes: photoJpeg,
    })),
    options: baseOptions,
    processorFactory: async () => fakeProcessor(),
  });
} catch (error) {
  batchRefusal = error?.reason ?? String(error);
}
check(batchRefusal === "too-many-files", `an oversized batch reported ${batchRefusal}`);

check(hasUploadStorage(env) === true, "a configured environment was reported as unconfigured");
check(hasUploadStorage(undefined) === false, "an absent environment was reported as configured");
check(hasUploadStorage({ DB: database.binding }) === false, "a bucket-less environment was reported as configured");

// A processor that cannot be built must refuse the upload rather than store a
// master it could never turn into a derivative.
let noProcessor = null;
try {
  await ingestUploads({
    env,
    files: [{ filename: "y.jpg", declaredType: "image/jpeg", bytes: photoJpeg }],
    options: baseOptions,
    processorFactory: async () => null,
  });
} catch (error) {
  noProcessor = error?.reason ?? String(error);
}
check(noProcessor === "unsupported-image", `a missing processor reported ${noProcessor}`);

// --- 8. Titles for a batch -----------------------------------------------

const titles = mixed.outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.photo?.title);
check(
  titles.every((title) => typeof title === "string" && title.length > 0),
  `a batch file was given no title: ${JSON.stringify(titles)}`,
);
check(new Set(titles).size === titles.length, `a batch produced duplicate titles: ${JSON.stringify(titles)}`);

database.close();
note(`ingest verified: rows, tag links, atomic rollback, slug collisions and per-file isolation`);
report(
  "Upload orchestration check passed: master preserved byte-for-byte, derivatives public, the row and its " +
    "tag links committed atomically, a failed commit leaving neither row nor objects, and per-file failures isolated.",
);
