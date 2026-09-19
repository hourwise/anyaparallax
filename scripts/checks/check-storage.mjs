#!/usr/bin/env node
/**
 * Storage-layer checks (Slice 04).
 *
 * Verifies the object-key strategy, the private/public boundary in
 * `app/data/storage.server.ts`, and that the R2-backed implementation routes
 * writes and reads to the correct bucket — including the rule that the private
 * master bucket can never be read through a public path.
 */
import {
  MASTERS_SCHEME,
  IMAGES_SCHEME,
  PUBLIC_MEDIA_PREFIX,
  asMasterRef,
  asPublicImageRef,
  masterKey,
  publicRefUrl,
  refFromPublicUrl,
  thumbnailKey,
  webKey,
} from "../../app/data/storage.ts";
import { R2ObjectStorage, createMemoryBuckets } from "../../app/data/storage.server.ts";
import { check, note, report } from "./report.mjs";

// --- Key strategy ---------------------------------------------------------

const photoId = "photo-1234";
const master = masterKey(photoId, "master.tif");
const web = webKey(photoId, "web-1600.jpg");
const thumb = thumbnailKey(photoId, "thumb-640.jpg");

check(master.startsWith(MASTERS_SCHEME), "master key is not in the masters domain");
check(web.startsWith(IMAGES_SCHEME), "web key is not in the images domain");
check(thumb.startsWith(IMAGES_SCHEME), "thumbnail key is not in the images domain");

check(publicRefUrl(master) === null, "a master key must not produce a public URL");
check(
  publicRefUrl(web)?.startsWith(PUBLIC_MEDIA_PREFIX) === true,
  "web key does not produce a public URL",
);
check(
  publicRefUrl(thumb)?.startsWith(PUBLIC_MEDIA_PREFIX) === true,
  "thumbnail key does not produce a public URL",
);
check(
  publicRefUrl(master) === null && !JSON.stringify(publicRefUrl(web)).includes("masters"),
  "public URL leaks the masters domain",
);
check(
  refFromPublicUrl(publicRefUrl(web) ?? "") === web,
  "public URL does not round-trip to its object key",
);
check(refFromPublicUrl("/photo/anything") === null, "non-media paths must not resolve to keys");
check(refFromPublicUrl(`${PUBLIC_MEDIA_PREFIX}`) === null, "empty media path must not resolve");

let asMasterThrew = false;
try {
  asMasterRef(web);
} catch {
  asMasterThrew = true;
}
check(asMasterThrew, "asMasterRef accepted a public image key");

let asPublicThrew = false;
try {
  asPublicImageRef(master);
} catch {
  asPublicThrew = true;
}
check(asPublicThrew, "asPublicImageRef accepted a master key");

// --- R2 implementation ----------------------------------------------------

const buckets = createMemoryBuckets();
const storage = new R2ObjectStorage({ MASTERS: buckets.masters, IMAGES: buckets.images });

const masterBytes = new Uint8Array([1, 2, 3, 4]);
await storage.putMaster(master, masterBytes, "image/tiff");
check(buckets.masters.size === 1, "master was not written to the private bucket");
check(buckets.images.size === 0, "writing a master wrote to the public bucket");

const readBack = await storage.readMaster(master);
check(readBack?.bytes.byteLength === 4, "master bytes did not round-trip");
check(readBack?.contentType === "image/tiff", "master content type did not round-trip");

await storage.putPublicImage(web, new Uint8Array([9, 9]), "image/jpeg");
check(buckets.images.size === 1, "public image was not written to the public bucket");
check(buckets.masters.size === 1, "writing a public image wrote to the private bucket");

// A public read must refuse a master key outright.
let publicReadOfMasterThrew = false;
try {
  await storage.readPublicImage(master);
} catch {
  publicReadOfMasterThrew = true;
}
check(publicReadOfMasterThrew, "readPublicImage accepted a master key");

let masterWriteThrew = false;
try {
  await storage.putMaster(web, new Uint8Array([0]), "image/jpeg");
} catch {
  masterWriteThrew = true;
}
check(masterWriteThrew, "putMaster accepted a public image key");

let publicWriteThrew = false;
try {
  await storage.putPublicImage(master, new Uint8Array([0]), "image/jpeg");
} catch {
  publicWriteThrew = true;
}
check(publicWriteThrew, "putPublicImage accepted a master key");

check((await storage.readPublicImage(web))?.bytes.byteLength === 2, "public image did not round-trip");
check((await storage.readPublicImage(thumb)) === null, "missing public image should read as null");
check((await storage.readMaster(masterKey("nobody", "master.tif"))) === null, "missing master should read as null");

await storage.deletePublicImage(web);
check(buckets.images.size === 0, "deletePublicImage did not remove the object");
check(buckets.masters.size === 1, "deletePublicImage touched the private bucket");
note("buckets: masters contains 1 object, images contains 0 after delete");

report(
  "Storage boundary check passed: master keys never resolve to public URLs and never reach the public bucket.",
);
