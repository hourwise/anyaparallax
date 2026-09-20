#!/usr/bin/env node
/**
 * Media route check (Slice 06 repair 01).
 *
 * `/media/*` is the only route that serves a stored object, so it is where a
 * private master could leak AND where an unpublished photograph could leak. The
 * repair makes "the object exists" insufficient authority, so this suite is
 * built around publication state rather than around keys:
 *
 *   published photo + published gallery + exact derivative   -> 200, indexable
 *   unpublished photo                                        -> 404
 *   photo in an unpublished gallery                          -> 404
 *   a key belonging to no photograph                         -> 404
 *   a private master-shaped path                             -> 404
 *   traversal and malformed paths                            -> 404
 *
 * Every refusal must be the SAME bare 404 with no body, so the response cannot
 * be used to discover whether an unpublished object exists, and every refusal
 * stays `noindex`. The served derivative, by contrast, carries no crawler
 * prohibition at all (REPAIR-09D2): it is a public photograph in a published
 * gallery, and the specification says public photographs may be indexed. A real
 * D1 database holds the fixture rows, so the SQL that decides publication is the
 * production SQL.
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

/** True when a response tells crawlers not to index it, by any spelling. */
function indexingProhibited(response) {
  const tokens = (response.headers.get("x-robots-tag") ?? "")
    .toLowerCase()
    .split(",")
    .map((token) => token.trim());
  return tokens.some((token) => token === "noindex" || token === "noimageindex" || token === "none");
}

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
  check(
    indexingProhibited(response),
    `${label} must not be indexable, saw x-robots-tag: ${response.headers.get("x-robots-tag")}`,
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
// The publication decision is MUTABLE while the object key is not, so a served
// derivative must be revalidated on every request. An immutable one-year policy
// would let a withdrawn photograph keep being served from a warm cache.
check(
  served.headers.get("cache-control") === "no-store",
  `a served derivative must be no-store, saw ${served.headers.get("cache-control")}`,
);
check(
  served.headers.get("etag") === null,
  "a no-store response must not carry an ETag, which only has a purpose when a representation may be reused",
);
check(
  !(served.headers.get("cache-control") ?? "").includes("immutable"),
  "a served derivative still claims to be immutable",
);
check(served.headers.get("x-content-type-options") === "nosniff", "sniffing must be disabled");
// The served derivative is public content the site wants found, so it must carry
// no crawler prohibition — and no crawl directive at all, which is the smallest
// way to say that (REPAIR-09D2). Crawlability came from the robots policy;
// indexability comes from this response's silence.
check(
  !indexingProhibited(served),
  `a published derivative must be indexable, saw x-robots-tag: ${served.headers.get("x-robots-tag")}`,
);
check(
  served.headers.get("x-robots-tag") === null,
  `a published derivative carries a crawler directive: ${served.headers.get("x-robots-tag")}`,
);
const servedBytes = new Uint8Array(await served.arrayBuffer());
check(servedBytes.byteLength === derivative.byteLength, "the wrong object was served");

const servedThumb = await serveMedia("thumbs/published-photo/thumb.webp", env);
check(servedThumb.status === 200, `a published THUMBNAIL returned ${servedThumb.status}, expected 200`);
check(
  servedThumb.headers.get("cache-control") === "no-store",
  "a served thumbnail must be no-store",
);

// --- Unpublication takes effect immediately -------------------------------

// The same URL, with no cache involved, must stop being served the moment the
// photograph is unpublished. This is the behaviour the no-store policy exists to
// make meaningful: nothing may outlive the permission that allowed it.
const url = "web/published-photo/web.webp";
const thumbUrl = "thumbs/published-photo/thumb.webp";
const beforeUnpublish = await serveMedia(url, env);
check(beforeUnpublish.status === 200, "the derivative was not served before unpublishing");

database.exec("UPDATE photos SET published = 0, published_at = NULL WHERE id = 'published-photo'");
const afterUnpublish = await serveMedia(url, env);
check(
  afterUnpublish.status === 404,
  `after unpublishing, the SAME url returned ${afterUnpublish.status}, expected 404`,
);
const afterUnpublishThumb = await serveMedia(thumbUrl, env);
check(
  afterUnpublishThumb.status === 404,
  `after unpublishing, the thumbnail returned ${afterUnpublishThumb.status}, expected 404`,
);
check(
  afterUnpublish.headers.get("cache-control") === "no-store",
  "the refusal after unpublishing must not be cacheable",
);
check((await afterUnpublish.text()).length === 0, "the refusal after unpublishing returned a body");

// Re-publishing restores service, so the refusal tracks the decision rather than
// having permanently poisoned the key.
database.exec(
  "UPDATE photos SET published = 1, published_at = '2026-09-01T00:00:00.000Z' WHERE id = 'published-photo'",
);
const afterRepublish = await serveMedia(url, env);
check(afterRepublish.status === 200, `after re-publishing, the url returned ${afterRepublish.status}`);
note("unpublication verified: the same derivative URL returned 200, then 404, then 200 again");

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
// unable to do anything anywhere except the operator's own machine: repair 01
// checked only the development flag, and since that flag is "true" in this
// repository's own Wrangler configuration, a deployment inheriting it would have
// exposed an unauthenticated path into the real upload pipeline.
const verification = await import("../../app/routes/dev-verification.ts");
const { RouterContextProvider } = await import("react-router");
const { appContext } = await import("../../app/data/context.ts");

/** A loader/action context carrying an environment, exactly as the Worker builds it. */
function contextFor(env) {
  const context = new RouterContextProvider();
  context.set(appContext, { env });
  return context;
}

/** A POST with a throwaway multipart body, which the gate must refuse to parse. */
function verificationRequest(hostname) {
  const form = new FormData();
  form.append("photos", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "x.jpg");
  return new Request(`http://${hostname}/dev-verification`, { method: "POST", body: form });
}

/**
 * The development flag exactly as a local run sets it, PLUS the real bindings,
 * so the loopback case is genuinely able to reach the pipeline and the public-host
 * case is genuinely able to mutate state if the gate were absent. Without the
 * bindings the inertness proof below would be vacuous: nothing could mutate
 * anything whether or not the gate worked.
 */
const devEnv = {
  ALLOW_DEVELOPMENT_IDENTITY: "true",
  MASTERS: masters,
  IMAGES: images,
  DB: database.binding,
};
const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];
const publicHosts = ["public.example", "localhost.attacker.example", "example.com", "127.0.0.1.example"];

// Loopback with the exact flag: available.
for (const host of loopbackHosts) {
  const response = await verification.loader({
    request: new Request(`http://${host}/dev-verification`),
    context: contextFor(devEnv),
  });
  check(response.status === 200, `the verification loader refused loopback host ${host} (${response.status})`);
}
// A public hostname with the exact flag: the same bare 404 as when it is off.
for (const host of publicHosts) {
  const loaderResponse = await verification.loader({
    request: new Request(`http://${host}/dev-verification`),
    context: contextFor(devEnv),
  });
  check(
    loaderResponse.status === 404,
    `the verification loader allowed public host ${host} (${loaderResponse.status})`,
  );
  check(
    loaderResponse.headers.get("cache-control") === "no-store",
    `the refusal for ${host} must not be cacheable`,
  );
  const actionResponse = await verification.action({
    request: verificationRequest(host),
    context: contextFor(devEnv),
  });
  check(
    actionResponse.status === 404,
    `the verification ACTION allowed public host ${host} (${actionResponse.status})`,
  );
}
// The flag itself: absent, differently cased or otherwise not exactly "true".
for (const flag of [undefined, "TRUE", "1", "true "]) {
  const response = await verification.loader({
    request: new Request("http://localhost/dev-verification"),
    context: contextFor(flag === undefined ? {} : { ALLOW_DEVELOPMENT_IDENTITY: flag }),
  });
  check(
    response.status === 404,
    `the verification route accepted flag ${JSON.stringify(flag)} (${response.status})`,
  );
}

// THE INERTNESS PROOF: a public hostname must cause ZERO database or bucket
// mutation. Counted around the call, so "it returned 404" is not the evidence —
// "nothing changed" is.
const mutationsBefore = {
  photos: database.query("SELECT COUNT(*) AS total FROM photos")[0]?.total,
  photoTags: database.query("SELECT COUNT(*) AS total FROM photo_tags")[0]?.total,
  masters: masters.size,
  images: images.size,
};
const deniedAction = await verification.action({
  request: verificationRequest("public.example"),
  context: contextFor(devEnv),
});
check(deniedAction.status === 404, "a public hostname was not refused");
const mutationsAfter = {
  photos: database.query("SELECT COUNT(*) AS total FROM photos")[0]?.total,
  photoTags: database.query("SELECT COUNT(*) AS total FROM photo_tags")[0]?.total,
  masters: masters.size,
  images: images.size,
};
check(
  JSON.stringify(mutationsBefore) === JSON.stringify(mutationsAfter),
  `a denied verification request mutated state: ${JSON.stringify(mutationsBefore)} -> ${JSON.stringify(mutationsAfter)}`,
);
note(
  `public-hostname denial left state untouched: ${mutationsAfter.photos} photos, ` +
    `${mutationsAfter.photoTags} tag links, ${mutationsAfter.masters + mutationsAfter.images} objects`,
);

database.close();
note("publication boundary verified: published 200, unpublished/hidden/orphan/master/traversal all bare 404");
report(
  "Media route check passed: only published derivatives serve, every unpublished, private, orphaned and " +
    "malformed path returns the same bare 404, and the route stays a layout-free resource route.",
);
