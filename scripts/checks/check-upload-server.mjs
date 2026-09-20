#!/usr/bin/env node
/**
 * Upload orchestration check (Slice 06).
 *
 * Drives the REAL `ingestUploads` against a source-backed D1 database and
 * in-memory buckets, so the whole operator path is exercised end to end:
 *
 *   bytes → validation → private master → derivatives → photograph row → tags
 *
 * What the unit-level pipeline check cannot show, and this one does:
 *
 *  * the photograph ROW records the ORIGINAL's geometry and the storage keys the
 *    pipeline actually wrote (not a value retyped by hand);
 *  * tag links are written and duplicates collapsed;
 *  * a multi-file submission where one file is corrupt stores the others and
 *    reports the failure per file, rather than losing the whole batch;
 *  * slug collisions resolve to `base`, `base-2`, … through the store;
 *  * a refused upload leaves NOTHING behind: no master, no derivative, no row.
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

for (const required of ["photo.jpg", "greyscale.jpg"]) {
  check(
    existsSync(resolve(fixtures, required)),
    `missing fixture ${required}; run pnpm run check:fixtures first`,
  );
}
const photoJpeg = new Uint8Array(readFileSync(resolve(fixtures, "photo.jpg")));
const greyJpeg = new Uint8Array(readFileSync(resolve(fixtures, "greyscale.jpg")));

// --- A real D1 database, behind in-memory buckets --------------------------

const database = await createD1TestDatabase({ seed, label: "upload" });
const repository = new D1PortfolioRepository(database.binding);

/** In-memory buckets that remember every write, for assertions after the fact. */
function createBuckets() {
  const masters = new Map();
  const images = new Map();
  return {
    masters,
    images,
    putMaster(key, bytes) {
      masters.set(key, Uint8Array.from(bytes));
    },
    putPublicImage(key, bytes) {
      images.set(key, Uint8Array.from(bytes));
    },
    binding: {
      async put(key, value) {
        const bytes = new Uint8Array(value);
        if (key.startsWith("originals/")) {
          masters.set(key, bytes);
        } else {
          images.set(key, bytes);
        }
      },
      async get(key) {
        const bytes = masters.get(key) ?? images.get(key);
        if (!bytes) {
          return null;
        }
        return {
          size: bytes.byteLength,
          httpMetadata: { contentType: "image/jpeg" },
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
      },
    },
  };
}

const buckets = createBuckets();
const env = { DB: database.binding, MASTERS: buckets.binding, IMAGES: buckets.binding };

/** The gallery every test upload is filed into. */
const galleryId = "gallery-nightlife";
const galleryIds = new Set(seed.galleries.map((gallery) => gallery.id));
check(galleryIds.has(galleryId), `the fixture gallery ${galleryId} does not exist`);

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
});
check(single.accepted === 1 && single.rejected === 0, `single upload reported ${single.accepted} accepted / ${single.rejected} rejected`);
check(single.persisted === true, "a D1-backed upload did not report itself persisted");

const created = single.outcomes[0];
check(created.ok === true, `the upload was refused: ${created.error?.message}`);
check(
  created.photo?.width === 320 && created.photo?.height === 240,
  `the row recorded ${created.photo?.width}x${created.photo?.height} instead of the original's 320x240`,
);
check(
  created.photo?.webWidth === 320 && created.photo?.webHeight === 240,
  `a 320x240 original produced a ${created.photo?.webWidth}x${created.photo?.webHeight} derivative`,
);
check(created.photo?.watermarked === true, "a watermarked upload did not report a watermark");
check(
  created.photo?.slug === "harbour-lights",
  `the slug was ${created.photo?.slug}, expected harbour-lights`,
);

// The master is byte-identical and private; the derivatives are public.
const masterKeys = [...buckets.masters.keys()];
check(masterKeys.length === 1, `expected one master object, found ${masterKeys.length}`);
check(
  masterKeys[0]?.startsWith("originals/") === true,
  `the master was stored at ${masterKeys[0]}, outside the originals prefix`,
);
check(
  Buffer.compare(Buffer.from(buckets.masters.get(masterKeys[0])), Buffer.from(photoJpeg)) === 0,
  "the stored master is not byte-identical to the upload",
);
check(
  buckets.images.size === 2,
  `expected two public derivatives, found ${buckets.images.size}`,
);
check(
  [...buckets.images.keys()].every((key) => key.startsWith("web/") || key.startsWith("thumbs/")),
  `a public object landed outside web/thumbs: ${[...buckets.images.keys()].join(", ")}`,
);

// --- 2. The row and its tags ---------------------------------------------

const photoRows = database.query(
  "SELECT id, slug, title, gallery_id, width, height, original_storage_key, web_storage_key, thumbnail_storage_key, watermark_enabled, watermark_position, published, print_available, published_at FROM photos WHERE slug = 'harbour-lights'",
);
check(photoRows.length === 1, `expected one photograph row, found ${photoRows.length}`);
const row = photoRows[0];
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
check(row?.published === 1, "a published upload was recorded unpublished");
check((row?.published_at ?? null) !== null, "a published upload has no published_at");
check(row?.watermark_position === "bottom-right", `watermark position stored as ${row?.watermark_position}`);

const tagRows = database.query(
  "SELECT tag_id FROM photo_tags WHERE photo_id = ?1 ORDER BY tag_id",
  row?.id,
);
check(
  tagRows.length === 2,
  `expected the duplicate tag to collapse to two links, found ${tagRows.length}`,
);

// --- 3. Publication controls ---------------------------------------------

const unpublished = await ingestUploads({
  env,
  files: [{ filename: "draft.jpg", declaredType: "image/jpeg", bytes: greyJpeg }],
  options: { ...baseOptions, title: "Draft frame", published: false, featured: true },
});
check(unpublished.accepted === 1, "an unpublished upload was refused");
const draftRow = database.query("SELECT published, published_at FROM photos WHERE slug = 'draft-frame'")[0];
check(draftRow?.published === 0, "an unpublished upload was recorded published");
check(draftRow?.published_at === null, "an unpublished upload carries a published_at");

// --- 4. Slug collisions ---------------------------------------------------

const collisionA = await ingestUploads({
  env,
  files: [{ filename: "a.jpg", declaredType: "image/jpeg", bytes: photoJpeg }],
  options: { ...baseOptions, title: "Repeated name" },
});
const collisionB = await ingestUploads({
  env,
  files: [{ filename: "b.jpg", declaredType: "image/jpeg", bytes: photoJpeg }],
  options: { ...baseOptions, title: "Repeated name" },
});
check(collisionA.outcomes[0]?.photo?.slug === "repeated-name", `first slug was ${collisionA.outcomes[0]?.photo?.slug}`);
check(collisionB.outcomes[0]?.photo?.slug === "repeated-name-2", `second slug was ${collisionB.outcomes[0]?.photo?.slug}`);

// --- 5. Multi-file with one bad file -------------------------------------

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
});
check(mixed.accepted === 2 && mixed.rejected === 1, `batch reported ${mixed.accepted} accepted / ${mixed.rejected} rejected`);
const refusedOutcome = mixed.outcomes.find((outcome) => !outcome.ok);
check(refusedOutcome?.filename === "not-an-image.jpg", "the wrong file was reported as refused");
check(refusedOutcome?.error?.reason === "unsupported-image", `the refusal reason was ${refusedOutcome?.error?.reason}`);
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

// --- 6. A submission with no usable file ---------------------------------

const empty = await ingestUploads({
  env,
  files: [{ filename: "empty.jpg", declaredType: "image/jpeg", bytes: new Uint8Array(0) }],
  options: baseOptions,
});
check(empty.accepted === 0, "an empty file was accepted");
check(empty.outcomes[0]?.error?.reason === "empty-file", `an empty file reported ${empty.outcomes[0]?.error?.reason}`);

// --- 7. Missing bindings --------------------------------------------------

check(hasUploadStorage(env) === true, "a configured environment was reported as unconfigured");
check(hasUploadStorage(undefined) === false, "an absent environment was reported as configured");
check(hasUploadStorage({ DB: database.binding }) === false, "a bucket-less environment was reported as configured");

// --- 8. Title handling for a multi-file batch ----------------------------

const titles = mixed.outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.photo?.title);
check(
  titles.every((title) => typeof title === "string" && title.length > 0),
  `a batch file was given no title: ${JSON.stringify(titles)}`,
);
check(
  new Set(titles).size === titles.length,
  `a batch produced duplicate titles: ${JSON.stringify(titles)}`,
);

database.close();
note(
  `ingest verified: ${single.accepted + unpublished.accepted + collisionA.accepted + collisionB.accepted} single uploads, ` +
    `a 3-file batch with one refusal, slug collision handling and ${buckets.images.size} public objects`,
);
report(
  "Upload orchestration check passed: master preserved byte-for-byte, derivatives public, rows and tag links " +
    "recorded, per-file failures isolated, and nothing stored for a refused file.",
);
