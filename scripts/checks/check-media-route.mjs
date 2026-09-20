#!/usr/bin/env node
/**
 * Media route check (Slice 06 repair 01).
 *
 * `/media/*` is the only route that serves a stored object, so it is where a
 * private master could leak AND where an unpublished photograph could leak. The
 * repair makes "the object exists" insufficient authority, so this suite is
 * built around publication state rather than around keys:
 *
 *   published photo + published gallery + exact derivative   -> 200
 *   unpublished photo                                        -> 404
 *   photo in an unpublished gallery                          -> 404
 *   a key belonging to no photograph                         -> 404
 *   a private master-shaped path                             -> 404
 *   traversal and malformed paths                            -> 404
 *
 * Every refusal must be the SAME bare 404 with no body, so the response cannot
 * be used to discover whether an unpublished object exists. A real D1 database
 * holds the fixture rows, so the SQL that decides publication is the production
 * SQL.
 */
import { register } from "node:module";

register("../ts-extension-hooks.mjs", import.meta.url);

const { serveMedia } = await import("../../app/images/media.server.ts");
const { createMemoryBuckets } = await import("../../app/data/storage.server.ts");
const { seed } = await import("../../app/data/seed.ts");
const { createD1TestDatabase } = await import("./d1-harness.mjs");
const { check, note, report } = await import("./report.mjs");

const { readFileSync, existsSync } = await import("node:fs");
const { resolve } = await import("node:path");
const { fileURLToPath } = await import("node:url");

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

// --- Environment: real D1 rows, in-memory buckets -------------------------

const database = await createD1TestDatabase({ seed, label: "media" });
const { masters, images } = createMemoryBuckets();

/** Objects that exist in the public bucket, whatever the database says. */
const PUBLISHED_WEB = "r2://images/web/published-photo/web.webp";
const PUBLISHED_THUMB = "r2://images/thumbs/published-photo/thumb.webp";
const DRAFT_WEB = "r2://images/web/draft-photo/web.webp";
const HIDDEN_WEB = "r2://images/web/hidden-photo/web.webp";
const ORPHAN_WEB = "r2://images/web/orphan-photo/web.webp";
const PRIVATE_MASTER = "r2://masters/originals/published-photo/master.jpg";

const derivative = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
for (const key of [PUBLISHED_WEB, PUBLISHED_THUMB, DRAFT_WEB, HIDDEN_WEB, ORPHAN_WEB]) {
  await images.put(key.replace("r2://images/", ""), derivative, {
    httpMetadata: { contentType: "image/webp" },
  });
}
await masters.put(PRIVATE_MASTER.replace("r2://masters/", ""), new Uint8Array([9, 9, 9]), {
  httpMetadata: { contentType: "image/jpeg" },
});

const env = { DB: database.binding, IMAGES: images, MASTERS: masters };

/** Create one photograph row, with its gallery published or not. */
function insertPhoto({ id, galleryId, published, webKey, thumbKey }) {
  const now = "2026-09-01T00:00:00.000Z";
  database.exec(
    `INSERT INTO photos (id, title, slug, description, gallery_id, width, height,
       original_storage_key, web_storage_key, thumbnail_storage_key, watermark_enabled,
       watermark_position, featured, published, print_available, created_at, updated_at, published_at)
     VALUES ('${id}', '${id}', '${id}', '', '${galleryId}', 100, 100,
       'r2://masters/originals/${id}/master.jpg', '${webKey}', '${thumbKey}', 0,
       'bottom-right', 0, ${published ? 1 : 0}, 0, '${now}', '${now}', ${published ? `'${now}'` : "NULL"})`,
  );
}

// A PRIVATE gallery, so "photo published but gallery not" is representable.
database.exec(
  `INSERT INTO galleries (id, name, slug, description, cover_photo_id, display_order, published, created_at, updated_at)
   VALUES ('gallery-hidden', 'Hidden', 'hidden', '', NULL, 99, 0, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
);
insertPhoto({
  id: "published-photo",
  galleryId: "gallery-nightlife",
  published: 1,
  webKey: PUBLISHED_WEB,
  thumbKey: PUBLISHED_THUMB,
});
insertPhoto({
  id: "draft-photo",
  galleryId: "gallery-nightlife",
  published: 0,
  webKey: DRAFT_WEB,
  thumbKey: DRAFT_WEB,
});
insertPhoto({
  id: "hidden-photo",
  galleryId: "gallery-hidden",
  published: 1,
  webKey: HIDDEN_WEB,
  thumbKey: HIDDEN_WEB,
});

/** The refusal shape every denial must share. */
async function refusal(path, label) {
  const response = await serveMedia(path, env);
  const body = await response.text();
  check(response.status === 404, `${label} returned ${response.status}, expected 404`);
  check(body.length === 0, `${label} returned a body`);
  check(
    response.headers.get("cache-control") === "no-store",
    `${label} must not be cacheable`,
  );
  return response;
}

// --- The published case ---------------------------------------------------

const served = await serveMedia("web/published-photo/web.webp", env);
check(served.status === 200, `a published derivative returned ${served.status}, expected 200`);
check(
  served.headers.get("content-type") === "image/webp",
  `content type was ${served.headers.get("content-type")}`,
);
check(
  served.headers.get("cache-control")?.includes("max-age=") === true,
  "a served derivative must be cacheable",
);
check(served.headers.get("x-content-type-options") === "nosniff", "sniffing must be disabled");
check(served.headers.get("x-robots-tag") === "noindex", "derivatives must not be indexed");
const servedBytes = new Uint8Array(await served.arrayBuffer());
check(servedBytes.byteLength === derivative.byteLength, "the wrong object was served");

const servedThumb = await serveMedia("thumbs/published-photo/thumb.webp", env);
check(servedThumb.status === 200, `a published THUMBNAIL returned ${servedThumb.status}, expected 200`);

// --- The publication boundary --------------------------------------------

await refusal("web/draft-photo/web.webp", "an UNPUBLISHED photo's derivative");
await refusal("thumbs/draft-photo/web.webp", "an UNPUBLISHED photo's thumbnail");
await refusal("web/hidden-photo/web.webp", "a derivative of a photo in an UNPUBLISHED gallery");

// A key that exists in the bucket but belongs to no photograph.
await refusal("web/orphan-photo/web.webp", "an object with no photograph row");

// A PRIVATE object that genuinely exists, including through traversal.
await refusal("originals/published-photo/master.jpg", "a private master path");
await refusal("../originals/published-photo/master.jpg", "a traversal toward the private prefix");
await refusal("web/../../originals/published-photo/master.jpg", "a deep traversal toward the private prefix");
await refusal("masters/originals/published-photo/master.jpg", "a master-shaped public path");
await refusal("web/published-photo/web.webp/../../originals/published-photo/master.jpg", "a traversal after a valid key");

// Malformed and empty paths.
await refusal("", "an empty path");
await refusal("web/", "a directory-shaped path");
await refusal("web/nonexistent.webp", "a nonexistent derivative");
await refusal("web/published-photo/", "a published directory without an object");

// --- Without a database, nothing is served -------------------------------

// No DB means publication cannot be PROVEN, and an unprovable claim is refused
// rather than assumed.
const noDatabase = await serveMedia("web/published-photo/web.webp", { IMAGES: images });
check(
  noDatabase.status === 404,
  `with no database a published derivative returned ${noDatabase.status}, expected 404`,
);
const noBinding = await serveMedia("web/published-photo/web.webp", undefined);
check(noBinding.status === 404, `with no environment the route returned ${noBinding.status}`);
const noBucket = await serveMedia("web/published-photo/web.webp", { DB: database.binding });
check(noBucket.status === 404, `with no bucket the route returned ${noBucket.status}`);

// --- Route shape ----------------------------------------------------------

const routePath = resolve(root, "app", "routes", "media.ts");
check(existsSync(routePath), "app/routes/media.ts is missing");
const routeSource = readFileSync(routePath, "utf8");
check(/export async function loader/.test(routeSource), "the media route does not export a loader");
check(
  !/export default/.test(routeSource),
  "the media route exports a component, so it is not a resource route",
);
const exportNames = [
  ...routeSource.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g),
].map((match) => match[1]);
check(
  exportNames.length === 1 && exportNames[0] === "loader",
  `the media route exports ${exportNames.join(", ")}; a resource route must export only its loader`,
);

const manifest = readFileSync(resolve(root, "app", "routes.ts"), "utf8");
check(
  /route\(\s*["']media\/\*["']\s*,\s*["']routes\/media\.ts["']\s*\)/.test(manifest),
  "app/routes.ts does not register the media resource route",
);
const mediaIndex = manifest.indexOf("routes/media.ts");
check(
  mediaIndex !== -1 && mediaIndex < manifest.indexOf("layout("),
  "the media route is registered inside a layout",
);

// --- The platform verification route stays inert --------------------------

// It exists so the real Cloudflare binding can be measured, and it must be
// unable to do anything in a deployment that has disabled its development
// switches. It performs no privileged action of its own — it calls the same
// production pipeline as the admin form — but the guard is what keeps it from
// being reachable at all.
const verification = await import("../../app/routes/dev-verification.ts");
const offLoader = await verification.loader({ context: undefined });
check(
  offLoader.status === 404,
  `the verification route responded ${offLoader.status} without the development switch`,
);
const offAction = await verification.action({
  request: new Request("http://localhost/dev-verification", { method: "POST", body: new FormData() }),
  context: undefined,
});
check(
  offAction.status === 404,
  `the verification route's action responded ${offAction.status} without the development switch`,
);
const wrongFlag = await verification.loader({
  context: { env: { ALLOW_DEVELOPMENT_IDENTITY: "TRUE" } },
});
check(
  wrongFlag.status === 404,
  `the verification route accepted a case-variant development flag (${wrongFlag.status})`,
);

database.close();
note("publication boundary verified: published 200, unpublished/hidden/orphan/master/traversal all bare 404");
report(
  "Media route check passed: only published derivatives serve, every unpublished, private, orphaned and " +
    "malformed path returns the same bare 404, and the route stays a layout-free resource route.",
);
