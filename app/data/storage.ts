/**
 * Image object model and storage-key strategy (Slice 04).
 *
 * Two security domains, two buckets:
 *
 *   MASTERS (private)  — the archival/print original. Never served to a
 *                        visitor, never watermarked, never overwritten by a
 *                        derivative.
 *   IMAGES  (public)   — web derivatives and gallery thumbnails. Safe to serve
 *                        once the photograph is published.
 *
 * Keys carry the domain in their scheme so a mistake is detectable rather than
 * silent:
 *
 *   r2://masters/originals/<id>/<filename>   private, never public
 *   r2://images/web/<id>/<filename>          public derivative
 *   r2://images/thumbs/<id>/<filename>       public thumbnail
 *
 * `publicRefUrl()` is the only way a storage reference becomes a URL a browser
 * may fetch, and it refuses master references by construction. Slices 06/07
 * serve them through a `GET /media/...` route; until then no route serves
 * stored objects at all.
 *
 * This module is deliberately free of server-only imports so it can be unit
 * checked and reused; binding access lives in `storage.server.ts`.
 */

export type StorageDomain = "masters" | "images";

export const MASTERS_SCHEME = "r2://masters/";
export const IMAGES_SCHEME = "r2://images/";
/** Prefix applied to public object keys when they are served over HTTP. */
export const PUBLIC_MEDIA_PREFIX = "/media/";

/** Storage reference to any object. */
export type StorageRef = {
  readonly domain: StorageDomain;
  /** Object key including the domain prefix, e.g. `r2://images/web/photo-1/1080.jpg`. */
  readonly key: string;
};

/** Reference to the private archival/print master. */
export type MasterRef = StorageRef & {
  readonly domain: "masters";
  readonly original: true;
};

/** Reference to a publicly servable derivative. */
export type PublicImageRef = StorageRef & {
  readonly domain: "images";
  readonly original: false;
};

export function isMastersKey(key: string): boolean {
  return key.startsWith(MASTERS_SCHEME);
}

export function isImagesKey(key: string): boolean {
  return key.startsWith(IMAGES_SCHEME);
}

export function isStorageKey(key: string): boolean {
  return isMastersKey(key) || isImagesKey(key);
}

/** Assert and refine a private master reference. */
export function asMasterRef(key: string): MasterRef {
  if (!isMastersKey(key)) {
    throw new Error(`Not a master storage key: ${key}`);
  }
  return { domain: "masters", key, original: true };
}

/** Assert and refine a public image reference. */
export function asPublicImageRef(key: string): PublicImageRef {
  if (!isImagesKey(key)) {
    throw new Error(`Not a public image storage key: ${key}`);
  }
  return { domain: "images", key, original: false };
}

/** Build the private master key for a stored original. */
export function masterKey(photoId: string, filename: string): string {
  return `${MASTERS_SCHEME}originals/${photoId}/${filename}`;
}

/** Build the public derivative key. */
export function webKey(photoId: string, filename: string): string {
  return `${IMAGES_SCHEME}web/${photoId}/${filename}`;
}

/** Build the public thumbnail key. */
export function thumbnailKey(photoId: string, filename: string): string {
  return `${IMAGES_SCHEME}thumbs/${photoId}/${filename}`;
}

/**
 * The URL a browser may fetch for a public image, or null when the key is not a
 * public derivative. Uses only the part of the key after the scheme so the
 * storage scheme never leaks into markup.
 */
export function publicRefUrl(key: string): string | null {
  if (!isImagesKey(key)) {
    return null;
  }
  return `${PUBLIC_MEDIA_PREFIX}${key.slice(IMAGES_SCHEME.length)}`;
}

/** Split a public URL path back into an object key, or null when it is not one. */
export function refFromPublicUrl(path: string): string | null {
  if (!path.startsWith(PUBLIC_MEDIA_PREFIX)) {
    return null;
  }
  const rest = path.slice(PUBLIC_MEDIA_PREFIX.length);
  return rest.length > 0 ? `${IMAGES_SCHEME}${rest}` : null;
}

/**
 * The browser-facing PUBLIC path for a stored image reference, or null.
 *
 * This is the one place a stored reference becomes something a browser may
 * fetch, and it exists because two legitimate reference shapes reach it:
 *
 *   `r2://images/web/<id>/web.webp`  a DB-backed photograph, converted through
 *                                    the public media boundary to `/media/...`
 *   `/images/dev/<name>.svg`         a development seed photograph, which is
 *                                    already a public site path
 *
 * Anything else returns null, and a null is meant to be OMITTED rather than
 * substituted. That matters most for the private shapes: a master reference
 * (`r2://masters/...`) and a path under `/originals/` or `/masters/` are refused
 * explicitly rather than by failing to match a public rule, because a leak here
 * puts a print-quality original in front of a browser.
 *
 * `publicRefUrl` above remains the stricter, storage-key-only conversion: it is
 * the inverse of `refFromPublicUrl` and returns null for anything that is not a
 * public derivative key. This function is the PUBLIC RENDERING boundary — what a
 * `src` attribute may contain — and the two are deliberately separate, so a
 * future storage scheme cannot become public just by being mentioned here.
 */
export function publicImagePathFrom(storedRef: unknown): string | null {
  if (typeof storedRef !== "string" || storedRef.length === 0) {
    return null;
  }
  const publicPath = publicRefUrl(storedRef);
  if (publicPath !== null) {
    return publicPath;
  }
  if (isStorageKey(storedRef)) {
    // A storage reference that is not a public image: a private master, or an
    // unknown domain. Never converted.
    return null;
  }
  if (!storedRef.startsWith("/") || storedRef.startsWith("//")) {
    return null;
  }
  const lowered = storedRef.toLowerCase();
  if (lowered.includes("masters") || lowered.includes("originals")) {
    return null;
  }
  return storedRef;
}
