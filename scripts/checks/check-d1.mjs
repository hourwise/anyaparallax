#!/usr/bin/env node
/**
 * D1 repository check (Slice 04).
 *
 * Creates an isolated local D1 database, applies the real migrations, loads
 * fixture rows generated from the same shape as the development seed, then runs
 * the shared visibility/projection suite against `D1PortfolioRepository` — so
 * the production data path is proved equivalent to the local one.
 *
 * Nothing contacts Cloudflare: `wrangler d1 execute --local` is used throughout.
 */
import { D1PortfolioRepository } from "../../app/data/repository.d1.server.ts";
import { seed } from "../../app/data/seed.ts";
import { MASTERS_SCHEME } from "../../app/data/storage.ts";
import { createD1TestDatabase } from "./d1-harness.mjs";
import { check, note, report } from "./report.mjs";
import { runRepositoryChecks } from "./repository-checks.mjs";

const label = "d1";
const database = await createD1TestDatabase({ seed, label });

// Confirm the migrations actually ran and created the expected schema.
const tables = await database.query(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%' AND name NOT LIKE 'd1_%' ORDER BY name",
);
const tableNames = tables.map((row) => row.name);
for (const expected of [
  "enquiries",
  "galleries",
  "likes",
  "photo_tags",
  "photos",
  "share_events",
  "site_settings",
  "tags",
  "users",
]) {
  check(tableNames.includes(expected), `migration did not create table ${expected}`);
}
note(`tables created: ${tableNames.join(", ")}`);

const indexes = await database.query(
  "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name",
);
const indexNames = indexes.map((row) => row.name);
for (const expected of [
  "idx_enquiries_status",
  "idx_galleries_published",
  "idx_likes_photo",
  "idx_photo_tags_tag",
  "idx_photos_featured",
  "idx_photos_gallery",
  "idx_photos_publication",
  "idx_share_events_photo",
]) {
  check(indexNames.includes(expected), `migration did not create index ${expected}`);
}
note(`indexes created: ${indexNames.length}`);

// Row counts must match the fixture.
const counts = {
  galleries: (await database.query("SELECT COUNT(*) AS total FROM galleries"))[0]?.total,
  photos: (await database.query("SELECT COUNT(*) AS total FROM photos"))[0]?.total,
  tags: (await database.query("SELECT COUNT(*) AS total FROM tags"))[0]?.total,
};
check(counts.galleries === seed.galleries.length, "gallery rows did not load");
check(counts.photos === seed.photos.length, "photo rows did not load");
check(counts.tags === seed.tags.length, "tag rows did not load");

// The private master keys must be present in the database (so the projection
// check is meaningful) and must be distinct from the public derivative keys.
const masterRows = await database.query(
  "SELECT original_storage_key, web_storage_key FROM photos ORDER BY id",
);
check(
  masterRows.every((row) => row.original_storage_key.startsWith(MASTERS_SCHEME)),
  "fixture master keys are not in the private masters domain",
);
check(
  masterRows.every((row) => row.original_storage_key !== row.web_storage_key),
  "fixture reuses one key for master and derivative",
);
note(`master keys verified private: ${masterRows.length}`);

// --- Repository behaviour ------------------------------------------------

const visibleGalleryIds = new Set(
  seed.galleries.filter((gallery) => gallery.published).map((gallery) => gallery.id),
);
const visiblePhotos = seed.photos.filter(
  (photo) => photo.published && visibleGalleryIds.has(photo.galleryId),
);
const hiddenPhotoSlugs = seed.photos
  .filter((photo) => !visiblePhotos.includes(photo))
  .map((photo) => photo.slug);
const hiddenGallery = seed.galleries.find((gallery) => !gallery.published);

await runRepositoryChecks("d1 repository", {
  repository: new D1PortfolioRepository(database.binding),
  expectations: {
    publishedGalleries: seed.galleries.filter((gallery) => gallery.published).length,
    publishedPhotos: visiblePhotos.length,
    gallerySlugs: seed.galleries
      .filter((gallery) => gallery.published)
      .map((gallery) => gallery.slug),
    photoSlugs: visiblePhotos.map((photo) => photo.slug),
    hiddenSlugs: hiddenPhotoSlugs,
    hiddenGallerySlug: hiddenGallery?.slug,
    publishedAtBySlug: visiblePhotos.map((photo) => [photo.slug, photo.publishedAt ?? ""]),
  },
});

// --- Schema behaviour ----------------------------------------------------

// NOT NULL and CHECK constraints reject invalid rows.
const badRole = database.failureOf(
  "INSERT INTO users (id, email, role, active, created_at, updated_at) " +
    "VALUES ('u-bad', 'bad@example.com', 'owner', 1, '2026-01-01', '2026-01-01')",
);
check(
  /CHECK constraint failed/i.test(badRole ?? ""),
  "users.role CHECK constraint did not reject an unsupported role",
);

const badWatermark = database.failureOf(
  "UPDATE photos SET watermark_position = 'middle' WHERE id = 'closing-time'",
);
check(
  /CHECK constraint failed/i.test(badWatermark ?? ""),
  "photos.watermark_position CHECK constraint did not reject a bad value",
);

// One browser cannot like a photograph twice.
database.exec("DELETE FROM likes");
database.exec(
  "INSERT INTO likes (id, photo_id, browser_token, created_at) " +
    "VALUES ('like-1', 'closing-time', 'browser-a', '2026-09-19T10:00:00.000Z')",
);
const duplicateLike = database.failureOf(
  "INSERT INTO likes (id, photo_id, browser_token, created_at) " +
    "VALUES ('like-2', 'closing-time', 'browser-a', '2026-09-19T10:05:00.000Z')",
);
check(
  /UNIQUE constraint failed/i.test(duplicateLike ?? ""),
  "likes did not reject a duplicate browser token for one photograph",
);

// A different browser may like the same photograph.
const distinctLike = database.failureOf(
  "INSERT INTO likes (id, photo_id, browser_token, created_at) " +
    "VALUES ('like-3', 'closing-time', 'browser-b', '2026-09-19T10:10:00.000Z')",
);
check(distinctLike === null, `likes rejected a distinct browser token: ${distinctLike}`);

// Share events start unconfirmed: V1 only ever records that a share started.
database.exec(
  "INSERT INTO share_events (id, photo_id, channel, created_at) " +
    "VALUES ('share-1', 'closing-time', 'copy-link', '2026-09-19T10:15:00.000Z')",
);
const shareRow = database.query(
  "SELECT external_confirmed_at FROM share_events WHERE id = 'share-1'",
)[0];
check(
  shareRow?.external_confirmed_at === null,
  "share_events implied an external confirmation that never happened",
);

// Foreign keys are enforceable when the connection opts in (documented in the
// migration header; D1 leaves them off by default).
database.exec("PRAGMA foreign_keys = ON");
const orphan = database.failureOf(
  "INSERT INTO photo_tags (photo_id, tag_id) VALUES ('no-such-photo', 'tag-night')",
);
check(
  /FOREIGN KEY constraint failed/i.test(orphan ?? ""),
  "foreign keys did not reject an orphaned photo_tags row",
);
database.exec("PRAGMA foreign_keys = OFF");
database.close();

report(
  `D1 check passed: schema, indexes and ${seed.photos.length} fixture photographs verified; ` +
    `repository returns ${visiblePhotos.length} published photographs and keeps ` +
    `${hiddenPhotoSlugs.length} hidden.`,
);
