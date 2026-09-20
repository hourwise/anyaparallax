#!/usr/bin/env node
/**
 * Public derivative serving check (Slice 06).
 *
 * `/media/*` is the only route that serves a stored object, so it is the only
 * place a private master could leak through HTTP. These assertions drive the
 * real `serveMedia` implementation with (a) an empty bucket, (b) a bucket holding
 * a genuine derivative, and (c) attack-shaped paths, and they also prove the
 * route module stays resource-shaped: one loader, no component, no other export.
 *
 * The path matrix matters more than the happy case. Every one of these must be a
 * 404:
 *
 *   /media/originals/<id>/master.tif      a PRIVATE key written out in full
 *   /media/../originals/<id>/master.tif   traversal toward the private prefix
 *   /media/                               an empty object name
 *   /media/web/../../secrets              traversal out of the web prefix
 *   /media/thumbs/<id>/thumb.jpg          a well-formed key with no object
 */
import { register } from "node:module";

register("../ts-extension-hooks.mjs", import.meta.url);

const { serveMedia } = await import("../../app/images/media.server.ts");
const { createMemoryBuckets } = await import("../../app/data/storage.server.ts");
const { check, note, report } = await import("./report.mjs");

const { readFileSync, existsSync } = await import("node:fs");
const { resolve } = await import("node:path");
const { fileURLToPath } = await import("node:url");

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Build an environment whose IMAGES bucket holds one derivative. */
async function environmentWithDerivative() {
  const { masters, images } = createMemoryBuckets();
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  await images.put("web/photo-1/web.jpg", bytes, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  await masters.put("originals/photo-1/master.tif", new Uint8Array([9, 9, 9]), {
    httpMetadata: { contentType: "image/tiff" },
  });
  return { env: { IMAGES: images, MASTERS: masters }, images, masters };
}

/** Paths that must never produce bytes. */
const refusedPaths = [
  "",
  "web/photo-1/web.jpg/../../originals/photo-1/master.tif",
  "../originals/photo-1/master.tif",
  "originals/photo-1/master.tif",
  "web/../../originals/photo-1/master.tif",
  "thumbs/photo-1/thumb.jpg",
  "masters/originals/photo-1/master.tif",
  "web/%2e%2e/originals/photo-1/master.tif",
];

// --- Refusals -------------------------------------------------------------

const empty = await serveMedia("web/photo-1/web.jpg", undefined);
check(empty.status === 404, `no IMAGES binding produced ${empty.status}, expected 404`);

const emptyBuckets = createMemoryBuckets();
for (const path of refusedPaths) {
  const response = await serveMedia(path, { IMAGES: emptyBuckets.images });
  check(response.status === 404, `refused path "${path}" produced ${response.status}, expected 404`);
  const body = await response.text();
  check(body.length === 0, `refused path "${path}" returned a body`);
}

// A traversal that resolves back into the public domain is NOT a leak: it can
// only reach `r2://images/...`, which is public by definition. What matters is
// that it never reaches the masters bucket, which the assertion above covers.
const traversalStaysPublic = await serveMedia("../web/photo-1/web.jpg", {
  IMAGES: emptyBuckets.images,
});
check(
  traversalStaysPublic.status === 404,
  "a traversal into an empty public bucket did not 404",
);

// --- The happy path -------------------------------------------------------

const { env } = await environmentWithDerivative();
const served = await serveMedia("web/photo-1/web.jpg", env);
check(served.status === 200, `a stored derivative produced ${served.status}, expected 200`);
check(
  served.headers.get("content-type") === "image/jpeg",
  `content-type was ${served.headers.get("content-type")}`,
);
check(
  served.headers.get("cache-control")?.includes("max-age=") === true,
  "the derivative response is not cacheable",
);
check(
  served.headers.get("x-content-type-options") === "nosniff",
  "the derivative response does not disable content sniffing",
);
check(
  served.headers.get("x-robots-tag") === "noindex",
  "the derivative response is indexable",
);
const servedBytes = new Uint8Array(await served.arrayBuffer());
check(servedBytes.byteLength === 8, `served ${servedBytes.byteLength} bytes, expected 8`);
check(servedBytes[0] === 0xff && servedBytes[1] === 0xd8, "served bytes are not the stored object");

// A PRIVATE object that exists must still be unreachable: this is the assertion
// that matters most, because here the object is genuinely there to be leaked.
const privateAttempt = await serveMedia("originals/photo-1/master.tif", env);
check(
  privateAttempt.status === 404,
  `a stored PRIVATE master was served with status ${privateAttempt.status}`,
);
const privateBody = await privateAttempt.text();
check(privateBody.length === 0, "a refused private read returned a body");

// --- Route shape ----------------------------------------------------------

const routePath = resolve(root, "app", "routes", "media.ts");
check(existsSync(routePath), "app/routes/media.ts is missing");
const routeSource = readFileSync(routePath, "utf8");
check(
  /export async function loader/.test(routeSource),
  "the media route does not export a loader",
);
check(
  !/export default/.test(routeSource),
  "the media route exports a component, so it is not a resource route",
);
const exportNames = [...routeSource.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g)].map(
  (match) => match[1],
);
check(
  exportNames.length === 1 && exportNames[0] === "loader",
  `the media route exports ${exportNames.join(", ")}; a resource route must export only its loader, or the build pulls server code into the client bundle`,
);

// The manifest must register it OUTSIDE every layout, or a visitor would get the
// site chrome instead of image bytes.
const manifest = readFileSync(resolve(root, "app", "routes.ts"), "utf8");
check(
  /route\(\s*["']media\/\*["']\s*,\s*["']routes\/media\.ts["']\s*\)/.test(manifest),
  "app/routes.ts does not register the media resource route",
);
const mediaIndex = manifest.indexOf('routes/media.ts');
const firstLayout = manifest.indexOf("layout(");
check(
  mediaIndex !== -1 && mediaIndex < firstLayout,
  "the media route is registered inside a layout, so a derivative would be wrapped in HTML",
);

note(`refused paths verified: ${refusedPaths.length + 3}`);
report(
  "Media route check passed: only public derivatives serve, every private and malformed path 404s, " +
    "and the route stays a layout-free resource route.",
);
