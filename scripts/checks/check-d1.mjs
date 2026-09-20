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
import { findAccountByEmail, listAccounts } from "../../app/auth/accounts.server.ts";
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

// The fixture carries no likes; remove both probe rows before the leak checks.
database.exec("DELETE FROM likes");

// --- Foreign key integrity (D1 enforces foreign keys by default) ----------

// The schema must declare both halves of the gallery/photograph relationship.
const photoForeignKeys = database.query("PRAGMA foreign_key_list('photos')");
const galleryForeignKey = photoForeignKeys.find(
  (row) => row.from === "gallery_id" && row.table === "galleries" && row.to === "id",
);
check(
  Boolean(galleryForeignKey),
  "photos.gallery_id has no foreign key to galleries(id)",
);
check(
  galleryForeignKey?.on_delete === "RESTRICT",
  `photos.gallery_id delete policy should RESTRICT, got ${galleryForeignKey?.on_delete}`,
);

const galleryForeignKeys = database.query("PRAGMA foreign_key_list('galleries')");
const coverForeignKey = galleryForeignKeys.find(
  (row) => row.from === "cover_photo_id" && row.table === "photos" && row.to === "id",
);
check(
  Boolean(coverForeignKey),
  "galleries.cover_photo_id has no foreign key to photos(id)",
);
check(
  coverForeignKey?.on_delete === "SET NULL",
  `galleries.cover_photo_id delete policy should SET NULL, got ${coverForeignKey?.on_delete}`,
);
note(
  `foreign keys on photos: ${photoForeignKeys.map((row) => `${row.from}->${row.table}(${row.on_delete})`).join(", ")}`,
);
note(
  `foreign keys on galleries: ${galleryForeignKeys.map((row) => `${row.from}->${row.table}(${row.on_delete})`).join(", ")}`,
);

// Invalid relationships must be rejected.
const [orphanPhoto] = database.probe([
  "INSERT INTO photos (id, title, slug, description, gallery_id, width, height, " +
    "original_storage_key, web_storage_key, thumbnail_storage_key, created_at, updated_at) " +
    "VALUES ('p-orphan', 'Orphan', 'orphan', '', 'gallery-missing', 100, 100, " +
    "'r2://masters/originals/p-orphan/master.tif', 'r2://images/web/p-orphan/web.jpg', " +
    "'r2://images/thumbs/p-orphan/thumb.jpg', '2026-01-01', '2026-01-01')",
]);
check(
  /FOREIGN KEY constraint failed/i.test(orphanPhoto ?? ""),
  "a photograph citing a nonexistent gallery was accepted",
);

const [orphanGallery] = database.probe([
  "INSERT INTO galleries (id, name, slug, description, cover_photo_id, display_order, published, created_at, updated_at) " +
    "VALUES ('g-orphan', 'Orphan', 'orphan', '', 'no-such-photo', 99, 0, '2026-01-01', '2026-01-01')",
]);
check(
  /FOREIGN KEY constraint failed/i.test(orphanGallery ?? ""),
  "a gallery cover citing a nonexistent photograph was accepted",
);

const [orphanTagLink] = database.probe([
  "INSERT INTO photo_tags (photo_id, tag_id) VALUES ('no-such-photo', 'tag-night')",
]);
check(
  /FOREIGN KEY constraint failed/i.test(orphanTagLink ?? ""),
  "foreign keys did not reject an orphaned photo_tags row",
);

// Valid relationships must be accepted.
const validRelationship = database.probe([
  "INSERT INTO galleries (id, name, slug, description, cover_photo_id, display_order, published, created_at, updated_at) " +
    "VALUES ('g-valid', 'Valid', 'valid', '', NULL, 90, 0, '2026-01-01', '2026-01-01')",
  "INSERT INTO photos (id, title, slug, description, gallery_id, width, height, " +
    "original_storage_key, web_storage_key, thumbnail_storage_key, created_at, updated_at) " +
    "VALUES ('p-valid', 'Valid', 'valid', '', 'g-valid', 100, 100, " +
    "'r2://masters/originals/p-valid/master.tif', 'r2://images/web/p-valid/web.jpg', " +
    "'r2://images/thumbs/p-valid/thumb.jpg', '2026-01-01', '2026-01-01')",
  "UPDATE galleries SET cover_photo_id = 'p-valid' WHERE id = 'g-valid'",
]);
check(
  validRelationship.every((outcome) => outcome === null),
  `a valid gallery/photograph/cover relationship was rejected: ${validRelationship.find(Boolean)}`,
);

// The cover policy clears the reference when its photograph is deleted, rather
// than deleting the gallery or failing.
const coverCleared = database.probe([
  "INSERT INTO galleries (id, name, slug, description, cover_photo_id, display_order, published, created_at, updated_at) " +
    "VALUES ('g-cover', 'Cover', 'cover', '', NULL, 91, 0, '2026-01-01', '2026-01-01')",
  "INSERT INTO photos (id, title, slug, description, gallery_id, width, height, " +
    "original_storage_key, web_storage_key, thumbnail_storage_key, created_at, updated_at) " +
    "VALUES ('p-cover', 'Cover', 'cover', '', 'g-cover', 100, 100, " +
    "'r2://masters/originals/p-cover/master.tif', 'r2://images/web/p-cover/web.jpg', " +
    "'r2://images/thumbs/p-cover/thumb.jpg', '2026-01-01', '2026-01-01')",
  "UPDATE galleries SET cover_photo_id = 'p-cover' WHERE id = 'g-cover'",
  "DELETE FROM photos WHERE id = 'p-cover'",
  "SELECT 1",
]);
check(
  coverCleared.every((outcome) => outcome === null),
  `deleting a cover photograph was rejected: ${coverCleared.find(Boolean)}`,
);

// RESTRICT protects photographs: a gallery holding them cannot be deleted.
const restricted = database.probe([
  "INSERT INTO galleries (id, name, slug, description, cover_photo_id, display_order, published, created_at, updated_at) " +
    "VALUES ('g-restrict', 'Restrict', 'restrict', '', NULL, 92, 0, '2026-01-01', '2026-01-01')",
  "INSERT INTO photos (id, title, slug, description, gallery_id, width, height, " +
    "original_storage_key, web_storage_key, thumbnail_storage_key, created_at, updated_at) " +
    "VALUES ('p-restrict', 'Restrict', 'restrict', '', 'g-restrict', 100, 100, " +
    "'r2://masters/originals/p-restrict/master.tif', 'r2://images/web/p-restrict/web.jpg', " +
    "'r2://images/thumbs/p-restrict/thumb.jpg', '2026-01-01', '2026-01-01')",
  "DELETE FROM galleries WHERE id = 'g-restrict'",
]);
check(
  restricted[0] === null && restricted[1] === null,
  `the setup for the RESTRICT probe failed: ${restricted[1] ?? restricted[0]}`,
);
check(
  /FOREIGN KEY constraint failed/i.test(restricted[2] ?? ""),
  "deleting a gallery that still holds photographs was allowed",
);

// --- Authorised-user directory (Slice 05) ---------------------------------

// The users table feeds the authorization guard, so the D1 lookup is proved
// here against the same fixtured rows the seed set produced.
const fixtureAccounts = database.query("SELECT COUNT(*) AS total FROM users")[0]?.total;
check(
  fixtureAccounts === seed.users.length,
  `the fixture holds ${fixtureAccounts} accounts, expected ${seed.users.length}`,
);

const d1Environment = { DB: database.binding, ALLOW_DEVELOPMENT_SEED: "false" };
const d1Photographer = await findAccountByEmail("PHOTOGRAPHER@Anyaparallax.TEST", d1Environment);
check(d1Photographer?.role === "photographer", "D1 account lookup did not return the photographer");
check(d1Photographer?.active === true, "D1 account lookup reported an active account as inactive");
check(d1Photographer?.email === "photographer@anyaparallax.test", "D1 account lookup did not normalise the email");

const d1Inactive = await findAccountByEmail("deactivated@anyaparallax.test", d1Environment);
check(d1Inactive?.active === false, "D1 account lookup did not report the inactive account");
check(
  (await findAccountByEmail("stranger@anyaparallax.test", d1Environment)) === null,
  "D1 account lookup invented an account for an unknown email",
);

const d1Accounts = await listAccounts(d1Environment);
check(
  d1Accounts.length === seed.users.length,
  `D1 directory listed ${d1Accounts.length} accounts, expected ${seed.users.length}`,
);
check(
  d1Accounts.every((account) => account.role === "photographer" || account.role === "manager"),
  "D1 directory listed an unsupported role",
);
check(d1Accounts[0]?.role === "manager", "D1 directory is not ordered managers-first");

// Share events start unconfirmed: V1 only ever records that a share started.
// The row is removed again so the fixture stays exactly as loaded.
const shareProbe = database.probe([
  "INSERT INTO share_events (id, photo_id, channel, created_at) " +
    "VALUES ('share-probe', 'closing-time', 'copy-link', '2026-09-19T10:15:00.000Z')",
]);
check(shareProbe[0] === null, `recording a share initiation was rejected: ${shareProbe[0]}`);

database.exec(
  "INSERT INTO share_events (id, photo_id, channel, created_at) " +
    "VALUES ('share-check', 'closing-time', 'copy-link', '2026-09-19T10:15:00.000Z')",
);
const shareRow = database.query(
  "SELECT external_confirmed_at FROM share_events WHERE id = 'share-check'",
)[0];
check(Boolean(shareRow), "the share event row was not written");
check(
  shareRow?.external_confirmed_at === null,
  "share_events implied an external confirmation that never happened",
);
database.exec("DELETE FROM share_events WHERE id = 'share-check'");

check(
  database.query("SELECT COUNT(*) AS total FROM likes")[0]?.total === 0,
  "constraint probes leaked rows into the fixture",
);
check(
  database.query("SELECT COUNT(*) AS total FROM galleries WHERE id LIKE 'g-%'")[0]?.total === 0,
  "gallery probes leaked rows into the fixture",
);

database.close();

report(
  `D1 check passed: schema, ${photoForeignKeys.length + galleryForeignKeys.length} foreign keys, ` +
    `indexes and ${seed.photos.length} fixture photographs verified; ` +
    `repository returns ${visiblePhotos.length} published photographs and keeps ` +
    `${hiddenPhotoSlugs.length} hidden; ${d1Accounts.length} authorised accounts served from D1.`,
);
