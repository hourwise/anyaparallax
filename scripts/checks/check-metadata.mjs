#!/usr/bin/env node
/**
 * Metadata boundary check (Slice 07) — pure assertions.
 *
 * The served-HTML check proves the tags reach the wire. This one pins the rules
 * that decide them, at the level where a regression is unambiguous:
 *
 *   * the canonical origin comes from CONFIGURATION. A public hostname in the
 *     request does not become the canonical URL, which is what stops a preview
 *     host from minting canonicals or a Host header from redefining the site;
 *   * a production derivative key (`r2://images/...`) becomes a `/media/...` path;
 *   * a private reference NEVER becomes a preview image — the master scheme, the
 *     `originals/` prefix and an unknown storage domain are each refused, and the
 *     tag is omitted rather than substituted;
 *   * the emitted tag set is exactly the required one, and `twitter:card` is
 *     `summary_large_image`.
 *
 * No network, no server, no database: this is the boundary as arithmetic.
 */
import { register } from "node:module";

register("../ts-extension-hooks.mjs", import.meta.url);

const {
  DEFAULT_PUBLIC_SITE_ORIGIN,
  canonicalUrl,
  normaliseSiteOrigin,
  siteOriginFrom,
} = await import("../../app/data/canonical-origin.ts");
const { publicImagePathFrom, publicRefUrl, refFromPublicUrl } = await import(
  "../../app/data/storage.ts"
);
const { toPublicPhoto } = await import("../../app/data/project.ts");
const { metadataTags, photoMetadataFor } = await import("../../app/engagement/metadata.ts");
const { check, note, report } = await import("./report.mjs");

const CANONICAL = "https://anyaparallax.co.uk";

// --- The canonical origin is configuration, never the request -------------

check(
  DEFAULT_PUBLIC_SITE_ORIGIN === CANONICAL,
  `the documented production origin is ${DEFAULT_PUBLIC_SITE_ORIGIN}`,
);
check(siteOriginFrom({ PUBLIC_SITE_ORIGIN: CANONICAL }) === CANONICAL, "a configured origin was not used");
check(
  siteOriginFrom({ PUBLIC_SITE_ORIGIN: `${CANONICAL}/` }) === CANONICAL,
  "a trailing slash was not normalised away",
);
check(
  siteOriginFrom({ PUBLIC_SITE_ORIGIN: `  ${CANONICAL}  ` }) === CANONICAL,
  "surrounding whitespace was not trimmed",
);
check(
  siteOriginFrom({ PUBLIC_SITE_ORIGIN: "ANYAPARALLAX.CO.UK" }) === CANONICAL,
  "a scheme-less value should not be accepted as an origin",
);
check(siteOriginFrom(undefined) === CANONICAL, "an absent configuration did not fall back to the default");
check(siteOriginFrom({}) === CANONICAL, "an empty environment did not fall back to the default");

// Invalid configuration falls back to the DOCUMENTED origin rather than to the
// request: a typo must not silently change what the site claims its address is.
for (const bad of [
  "not a url",
  "ftp://anyaparallax.co.uk",
  "http://anyaparallax.co.uk",
  "https://anyaparallax.co.uk/photo",
  "https://anyaparallax.co.uk/?x=1",
  "https://anyaparallax.co.uk/#top",
  "https://user:pass@anyaparallax.co.uk",
  "",
  "   ",
  42,
  null,
]) {
  check(
    normaliseSiteOrigin(bad) === null,
    `normaliseSiteOrigin accepted ${JSON.stringify(bad)}`,
  );
}
// A loopback HTTP origin is the one plain-HTTP exception, so local work needs no
// certificate to render a truthful canonical URL.
check(
  normaliseSiteOrigin("http://localhost:5173") === "http://localhost:5173",
  "a loopback development origin was refused",
);
check(
  normaliseSiteOrigin("https://anyaparallax.co.uk:8443") === "https://anyaparallax.co.uk:8443",
  "an explicit port was dropped from a valid origin",
);

check(
  canonicalUrl(CANONICAL, "/photo/closing-time") === `${CANONICAL}/photo/closing-time`,
  "the canonical URL is not built from the configured origin",
);
check(
  canonicalUrl(CANONICAL, "photo/closing-time") === `${CANONICAL}/photo/closing-time`,
  "a path without a leading slash was not accepted",
);
// A path that is itself absolute must not be able to escape the canonical origin.
check(
  canonicalUrl(CANONICAL, "https://evil.example/photo/x") === `${CANONICAL}/photo/x`,
  "an absolute path escaped the canonical origin",
);

// --- The public image path boundary (Slice 07A) ---------------------------

// `publicImagePathFrom` is where a stored reference becomes something a browser
// may fetch, and it is the function the PUBLIC PROJECTION now uses. Both
// legitimate reference shapes must convert, and every private shape must be
// refused — returning null so the caller OMITS the image rather than guessing.
check(
  publicImagePathFrom("r2://images/web/photo-1/web.webp") === "/media/web/photo-1/web.webp",
  "a production derivative key did not become a public media path",
);
check(
  publicImagePathFrom("/images/dev/red-glow.svg") === "/images/dev/red-glow.svg",
  "a development public asset path was refused",
);
check(
  publicRefUrl("r2://images/web/photo-1/web.webp") === "/media/web/photo-1/web.webp",
  "the storage-key-only conversion changed behaviour",
);
check(
  publicRefUrl("/images/dev/red-glow.svg") === null,
  "the storage-key-only conversion accepted a plain site path",
);
check(
  refFromPublicUrl("/media/web/photo-1/web.webp") === "r2://images/web/photo-1/web.webp",
  "the public path does not round-trip back to its storage key",
);
for (const [value, label] of [
  ["r2://masters/originals/photo-1/master.tif", "a private master key"],
  ["r2://masters/originals/photo-1/master.jpg", "a private master key with a public-looking extension"],
  ["r2://something-else/photo-1/web.webp", "an unknown storage domain"],
  ["/originals/photo-1/master.tif", "a site path inside the originals prefix"],
  ["/masters/photo-1/master.tif", "a site path inside a masters prefix"],
  ["//evil.example/web.webp", "a protocol-relative path"],
  ["https://evil.example/web.webp", "an absolute URL"],
  ["", "an empty value"],
  [undefined, "an undefined value"],
  [null, "a null value"],
  [42, "a non-string value"],
]) {
  check(publicImagePathFrom(value) === null, `${label} produced a public image path`);
}
note("public image path: production keys convert, every private shape is refused");

// --- The PROJECTION is where the repair lives -----------------------------

/**
 * A minimal persistence row, so the projection can be driven directly.
 *
 * This is the layer the defect was in: `toPublicPhoto` used to copy the stored
 * key into the public projection, and components then emitted it as a `src`.
 */
function photoRecordWith(webStorageKey, thumbnailStorageKey) {
  return {
    id: "photo-1",
    title: "Closing time",
    slug: "closing-time",
    description: "The last few minutes of a night, picked out in red.",
    galleryId: "gallery-nightlife",
    tags: [],
    location: null,
    captureDate: "2026-08-02",
    width: 1080,
    height: 720,
    orientation: "landscape",
    originalStorageKey: "r2://masters/originals/photo-1/master.tif",
    webStorageKey,
    thumbnailStorageKey,
    watermarkEnabled: false,
    watermarkPosition: "bottom-right",
    featured: false,
    featuredVariant: "a",
    published: true,
    printAvailable: false,
    createdAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-05T12:00:00.000Z",
    publishedAt: "2026-08-05T20:00:00.000Z",
  };
}

const projected = toPublicPhoto(
  photoRecordWith("r2://images/web/photo-1/web.webp", "r2://images/thumbs/photo-1/thumb.webp"),
);
check(
  projected.webImagePath === "/media/web/photo-1/web.webp",
  `the projection produced ${JSON.stringify(projected.webImagePath)} for the web derivative`,
);
check(
  projected.thumbnailImagePath === "/media/thumbs/photo-1/thumb.webp",
  `the projection produced ${JSON.stringify(projected.thumbnailImagePath)} for the thumbnail`,
);
// The decisive assertion: no internal storage reference survives the projection.
for (const [field, value] of [
  ["webImagePath", projected.webImagePath],
  ["thumbnailImagePath", projected.thumbnailImagePath],
]) {
  check(
    typeof value !== "string" || !/^r2:/i.test(value),
    `the projection left a storage URI in ${field}: ${JSON.stringify(value)}`,
  );
}
check(
  !("webStorageKey" in projected) && !("thumbnailStorageKey" in projected),
  "the public projection still exposes a storage-key field",
);
check(
  !("originalStorageKey" in projected),
  "the public projection exposes the private master key",
);
check(
  !JSON.stringify(projected).includes("masters"),
  "the public projection mentions the private domain",
);
// A seed photograph keeps working: its stored reference is already a public path.
const projectedSeed = toPublicPhoto(photoRecordWith("/images/dev/red-glow.svg", "/images/dev/red-glow.svg"));
check(
  projectedSeed.webImagePath === "/images/dev/red-glow.svg",
  `a development seed image did not survive the projection: ${JSON.stringify(projectedSeed.webImagePath)}`,
);
// A private reference fails closed in the projection too.
const projectedPrivate = toPublicPhoto(
  photoRecordWith("r2://masters/originals/photo-1/master.tif", "/originals/photo-1/master.tif"),
);
check(
  projectedPrivate.webImagePath === null && projectedPrivate.thumbnailImagePath === null,
  "a private stored reference produced a public image path in the projection",
);
note("projection: derivative keys and seed paths convert, private references become null");

// --- The exact metadata for a representative photograph -------------------

const input = {
  slug: "closing-time",
  title: "Closing time",
  description: "The last few minutes of a night, picked out in red.",
  // The metadata receives a PUBLIC PATH, exactly as the projection produces it.
  webImagePath: "/media/web/closing-time/web.webp",
  fallbackDescription: "Site description",
  siteName: "Anyaparallax Photography",
};
const metadata = photoMetadataFor(CANONICAL, input);
check(
  metadata.canonical === `${CANONICAL}/photo/closing-time`,
  `the canonical is ${metadata.canonical}`,
);
check(
  metadata.image === `${CANONICAL}/media/web/closing-time/web.webp`,
  `the preview image is ${metadata.image}`,
);
check(
  metadata.description === input.description,
  "the photograph's own description was not used",
);
const noDescription = photoMetadataFor(CANONICAL, { ...input, description: "   " });
check(
  noDescription.description === input.fallbackDescription,
  "a photograph with no description did not fall back to the site description",
);

// --- The emitted tag set --------------------------------------------------

/**
 * Read a descriptor's key and value generically.
 *
 * The descriptors are plain objects whose key varies (`title`, `name`,
 * `property`), so they are read through `Object` rather than by casting: this is
 * a plain `.mjs` check, and Node's type stripper does not accept TypeScript
 * assertions in it.
 */
function descriptorKey(tag) {
  return tag.property ?? tag.name ?? "title";
}

function descriptorValue(tag) {
  return tag.content ?? tag.href ?? "";
}

const tags = metadataTags(metadata);
const byKey = new Map(tags.map((tag) => [descriptorKey(tag), descriptorValue(tag)]));
for (const [key, expected] of [
  ["description", input.description],
  ["og:type", "article"],
  ["og:title", "Closing time — Anyaparallax Photography"],
  ["og:description", input.description],
  ["og:url", `${CANONICAL}/photo/closing-time`],
  ["og:image", `${CANONICAL}/media/web/closing-time/web.webp`],
  ["twitter:card", "summary_large_image"],
  ["twitter:title", "Closing time — Anyaparallax Photography"],
  ["twitter:description", input.description],
  ["twitter:image", `${CANONICAL}/media/web/closing-time/web.webp`],
]) {
  check(
    byKey.get(key) === expected,
    `${key} is ${JSON.stringify(byKey.get(key))}, expected ${JSON.stringify(expected)}`,
  );
}
const canonicalTag = tags.find((tag) => tag.rel === "canonical");
check(
  canonicalTag?.href === `${CANONICAL}/photo/closing-time`,
  "the canonical link tag does not carry the canonical URL",
);

// A projection that refused the stored reference produces a null path, and the
// image tags are then OMITTED rather than substituted with anything.
const privateMetadata = photoMetadataFor(CANONICAL, { ...input, webImagePath: null });
check(privateMetadata.image === null, "a null public path produced a preview image");
const privateTags = metadataTags(privateMetadata);
const privateKeys = privateTags.map(descriptorKey);
check(!privateKeys.includes("og:image"), "og:image was emitted for a photograph with no public preview");
check(!privateKeys.includes("twitter:image"), "twitter:image was emitted for a photograph with no public preview");
check(
  !JSON.stringify(privateTags).includes("masters"),
  "a private reference reached the metadata tags",
);
// End to end through the real projection: a private stored reference yields no
// preview image anywhere in the metadata.
const privateProjected = toPublicPhoto(
  photoRecordWith("r2://masters/originals/photo-1/master.tif", "r2://masters/originals/photo-1/master.tif"),
);
const privateEndToEnd = photoMetadataFor(CANONICAL, {
  ...input,
  webImagePath: privateProjected.webImagePath,
});
check(
  privateEndToEnd.image === null,
  "a private stored reference produced a social preview image",
);
check(
  !JSON.stringify(metadataTags(privateEndToEnd)).includes("master"),
  "a private reference reached the tags through the projection",
);
note(`tags verified: ${tags.length} for a public preview, ${privateTags.length} when the image is omitted`);

report(
  "Metadata boundary check passed: the canonical origin is configuration rather than the request, the public " +
    "projection converts derivative keys to media paths and refuses every private shape, omitted images stay " +
    "omitted rather than substituted, and the emitted tag set matches the required canonical/OpenGraph/Twitter shape.",
);
