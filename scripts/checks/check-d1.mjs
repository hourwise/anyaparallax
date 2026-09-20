#!/usr/bin/env node
/**
 * D1 repository check (Slice 04).
 *
 * Creates an isolated local D1 database, applies the real migrations, loads
 * fixture rows generated from the same shape as the development seed, then runs
 * the shared visibility/projection suite against `D1PortfolioRepository` — so
 * the production data path is proved equivalent to the local one.
 *
 * Slice 05 adds the authorised-user directory checks, and repair 01 adds the
 * identity-uniqueness checks: the unique NOCASE index exists, a case variant of
 * an authorised address cannot become a second row, a lookup by any casing
 * resolves the one account, the lookup is served by that index, and the D1 role
 * decisions are unchanged for photographer, manager, inactive and unknown
 * identities. Probes run inside rolled-back transactions, so the fixture the
 * other checks read is never mutated.
 *
 * Nothing contacts Cloudflare: `wrangler d1 execute --local` is used throughout.
 */
import { RouterContextProvider } from "react-router";

import { findAccountByEmail, listAccounts } from "../../app/auth/accounts.server.ts";
import { ACCOUNT_BY_EMAIL_SQL } from "../../app/auth/accounts.ts";
import { requireAdminAccess, requireManagerAccess } from "../../app/auth/authorization.server.ts";
import { appContext } from "../../app/data/context.ts";
import { D1PortfolioRepository } from "../../app/data/repository.d1.server.ts";
import { seed } from "../../app/data/seed.ts";
import { MASTERS_SCHEME } from "../../app/data/storage.ts";
import { createD1TestDatabase } from "./d1-harness.mjs";
import { check, note, report } from "./report.mjs";
import { runRepositoryChecks } from "./repository-checks.mjs";

/**
 * A `RouterContextProvider` carrying an environment, exactly as the Worker entry
 * builds it, so the D1 account source can be driven through the real guards.
 */
function contextFor(env) {
  const context = new RouterContextProvider();
  context.set(appContext, { env });
  return context;
}

/** The status of a guard denial (a thrown `data()` value), or null if it allowed the request. */
function denialStatus(error) {
  if (!error || typeof error !== "object") {
    return null;
  }
  const init = error.init;
  if (init && typeof init.status === "number") {
    return init.status;
  }
  return typeof error.status === "number" ? error.status : null;
}

/** Run a guard and report either the authorised user or the denial status. */
async function attemptGuard(guard, request, context) {
  try {
    return { user: await guard(request, context), status: null };
  } catch (error) {
    return { user: null, status: denialStatus(error) };
  }
}

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

// --- Authorised-identity uniqueness (Slice 05 repair 01) ------------------

// Case variants of one address are ONE identity. Migration 0002 enforces that
// at the database layer with a unique NOCASE index, and the account lookup must
// use the same rule so authority can never be ambiguous.
const identityIndexRow = database.query(
  "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'users' AND name = 'idx_users_email_identity_nocase'",
)[0];
check(
  Boolean(identityIndexRow),
  "migration 0002 did not create the idx_users_email_identity_nocase index",
);
check(
  (identityIndexRow?.sql ?? "").includes("UNIQUE"),
  "idx_users_email_identity_nocase is not UNIQUE",
);
check(
  (identityIndexRow?.sql ?? "").includes("COLLATE NOCASE"),
  "idx_users_email_identity_nocase does not use COLLATE NOCASE",
);
const userIndexes = database
  .query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'users' ORDER BY name")
  .map((row) => row.name);
check(
  userIndexes.includes("idx_users_email_identity_nocase"),
  `users indexes are ${userIndexes.join(", ")}`,
);
note(`users indexes: ${userIndexes.join(", ")}`);

// Migrations 0001 and 0002 applied from an empty state, in order.
const appliedMigrations = database
  .query("SELECT name FROM d1_migrations ORDER BY id")
  .map((row) => row.name);
check(
  appliedMigrations.join(",") === "0001_initial_schema.sql,0002_user_email_identity_uniqueness.sql",
  `migrations applied out of order or incomplete: ${appliedMigrations.join(", ")}`,
);

// The lookup must be served by the NOCASE index rather than by scanning the
// table with `lower(email)`, so the comparison and the constraint share a rule.
// The plan is taken from the PRODUCTION query text, so a change to the account
// lookup is planned here too rather than silently diverging from a copy.
const accountPlan = database
  .query(`EXPLAIN QUERY PLAN ${ACCOUNT_BY_EMAIL_SQL}`, "photographer@anyaparallax.test")
  .map((row) => row.detail)
  .join(" | ");
check(
  accountPlan.includes("idx_users_email_identity_nocase"),
  `the account lookup does not use the identity index: ${accountPlan}`,
);
check(
  !/SCAN users/.test(accountPlan),
  `the account lookup scans the whole users table: ${accountPlan}`,
);
note(`account lookup plan: ${accountPlan}`);

// The proven probe: insert an authorised address, attempt a case variant as a
// second row, then resolve the identity through a third casing. All inside a
// rolled-back transaction, so the fixture the other checks read is untouched.
const duplicateStatements = [
  "INSERT INTO users (id, email, role, active, created_at, updated_at) " +
    "VALUES ('u-probe-identity', 'anya@example.test', 'photographer', 1, '2026-01-01', '2026-01-01')",
  "INSERT INTO users (id, email, role, active, created_at, updated_at) " +
    "VALUES ('u-probe-duplicate', 'ANYA@example.test', 'manager', 1, '2026-01-01', '2026-01-01')",
  "SELECT id, email, role FROM users WHERE email COLLATE NOCASE = 'AnyA@Example.Test'",
];

// The same invariant across every write path: a row may change its own case
// (that is still ONE identity), but no statement can leave one identity with two
// rows, so authority can never be ambiguous.
const recaseStatements = [
  "INSERT INTO users (id, email, role, active, created_at, updated_at) " +
    "VALUES ('u-probe-recase', 'anya@example.test', 'photographer', 1, '2026-01-01', '2026-01-01')",
  "UPDATE users SET email = 'ANYA@example.test', role = 'manager' WHERE id = 'u-probe-recase'",
  "SELECT id, email, role FROM users WHERE email COLLATE NOCASE = 'anya@example.test'",
  "INSERT INTO users (id, email, role, active, created_at, updated_at) " +
    "VALUES ('u-probe-second', 'AnyA@Example.Test', 'photographer', 1, '2026-01-01', '2026-01-01')",
];

const duplicateIdentityProbe = database.probeQuery(duplicateStatements);
const duplicateVerdicts = duplicateIdentityProbe.map((outcome) =>
  outcome.error === null ? "ok" : outcome.error,
);
check(
  duplicateIdentityProbe.length === duplicateStatements.length,
  `the duplicate-identity probe ran ${duplicateIdentityProbe.length} of ` +
    `${duplicateStatements.length} statements: ${JSON.stringify(duplicateVerdicts)}`,
);
check(
  duplicateVerdicts[0] === "ok",
  `inserting anya@example.test failed: ${JSON.stringify(duplicateVerdicts)}`,
);
check(
  /UNIQUE constraint failed/i.test(duplicateVerdicts[1] ?? ""),
  `a case variant (ANYA@example.test) was accepted as a second identity: ` +
    `${JSON.stringify(duplicateVerdicts)}`,
);
const identityLookupRows = duplicateIdentityProbe[2].rows;
check(
  identityLookupRows.length === 1 && identityLookupRows[0].id === "u-probe-identity",
  `a case-insensitive lookup did not resolve the one identity row: ` +
    `${JSON.stringify(identityLookupRows)}`,
);

// The same invariant across a second write path.
const recaseProbe = database.probeQuery(recaseStatements);
const recaseVerdicts = recaseProbe.map((outcome) =>
  outcome.error === null ? "ok" : outcome.error,
);
check(
  recaseProbe.length === recaseStatements.length,
  `the re-case probe ran ${recaseProbe.length} of ${recaseStatements.length} statements: ` +
    `${JSON.stringify(recaseVerdicts)}`,
);
check(
  recaseVerdicts[0] === "ok",
  `re-casing the one identity row failed: ${JSON.stringify(recaseVerdicts)}`,
);
const recasedRows = recaseProbe[2].rows;
check(
  recasedRows.length === 1 && recasedRows[0].role === "manager",
  `re-casing left something other than one identity row: ${JSON.stringify(recasedRows)}`,
);
check(
  /UNIQUE constraint failed/i.test(recaseVerdicts[3] ?? ""),
  `a case variant was accepted as a second identity after an update: ` +
    `${JSON.stringify(recaseVerdicts)}`,
);

// Role behaviour through the real guards, reading authority from these rows: a
// development identity (resolved through the same account directory) plus the
// same role sets the /admin and /manager layouts apply.
const guardEnvironment = { ...d1Environment, ALLOW_DEVELOPMENT_IDENTITY: "true" };
const photographerAdmin = await attemptGuard(
  requireAdminAccess,
  new Request("http://localhost:5173/admin", {
    headers: { "x-anyaparallax-development-identity": "PHOTOGRAPHER@Anyaparallax.TEST" },
  }),
  contextFor(guardEnvironment),
);
check(
  photographerAdmin.user?.role === "photographer",
  `D1-backed photographer was denied /admin: ${photographerAdmin.status ?? "no denial"}`,
);

const photographerManager = await attemptGuard(
  requireManagerAccess,
  new Request("http://localhost:5173/manager", {
    headers: {
      "x-anyaparallax-development-identity": "PHOTOGRAPHER@Anyaparallax.TEST",
      "x-anyaparallax-role": "manager",
    },
  }),
  contextFor(guardEnvironment),
);
check(
  photographerManager.status === 403,
  `D1-backed photographer was not denied /manager: ${photographerManager.status ?? "allowed"}`,
);

const managerManager = await attemptGuard(
  requireManagerAccess,
  new Request("http://localhost:5173/manager", {
    headers: { "x-anyaparallax-development-identity": "MANAGER@Anyaparallax.TEST" },
  }),
  contextFor(guardEnvironment),
);
check(
  managerManager.user?.role === "manager",
  `D1-backed manager was denied /manager: ${managerManager.status ?? "no denial"}`,
);

const inactiveGuard = await attemptGuard(
  requireAdminAccess,
  new Request("http://localhost:5173/admin", {
    headers: { "x-anyaparallax-development-identity": "deactivated@anyaparallax.test" },
  }),
  contextFor(guardEnvironment),
);
check(
  inactiveGuard.status === 403,
  `a deactivated D1 account was not denied: ${inactiveGuard.status ?? "allowed"}`,
);

const unknownGuard = await attemptGuard(
  requireAdminAccess,
  new Request("http://localhost:5173/admin", {
    headers: { "x-anyaparallax-development-identity": "stranger@anyaparallax.test" },
  }),
  contextFor(guardEnvironment),
);
check(
  unknownGuard.status === 403,
  `an identity with no D1 account was not denied: ${unknownGuard.status ?? "allowed"}`,
);

const anonymousGuard = await attemptGuard(
  requireAdminAccess,
  new Request("http://localhost:5173/admin"),
  contextFor(guardEnvironment),
);
check(
  anonymousGuard.status === 401,
  `an unidentified D1 request was not 401: ${anonymousGuard.status ?? "allowed"}`,
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
check(
  new Set(d1Accounts.map((account) => account.email)).size === d1Accounts.length,
  "D1 directory listed one identity twice",
);

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
check(
  database.query("SELECT COUNT(*) AS total FROM users WHERE id LIKE 'u-probe-%'")[0]?.total === 0,
  "identity probes leaked rows into the fixture",
);
check(
  database.query("SELECT COUNT(*) AS total FROM users WHERE email COLLATE NOCASE = 'anya@example.test'")[0]
    ?.total === 0,
  "the identity probe address leaked into the fixture",
);

database.close();

report(
  `D1 check passed: schema, ${photoForeignKeys.length + galleryForeignKeys.length} foreign keys, ` +
    `indexes and ${seed.photos.length} fixture photographs verified; ` +
    `repository returns ${visiblePhotos.length} published photographs and keeps ` +
    `${hiddenPhotoSlugs.length} hidden; ${d1Accounts.length} authorised accounts served from D1 ` +
    `under a unique case-insensitive email identity.`,
);
