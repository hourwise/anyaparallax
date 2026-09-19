/**
 * Public route URL helpers. Centralised so slugs render identically wherever a
 * photograph or gallery is linked (homepage, gallery grid, photo page, 404).
 */
export function photoPath(slug: string): string {
  return `/photo/${slug}`;
}

export function galleryPath(slug: string): string {
  return `/gallery/${slug}`;
}

export const galleriesPath = "/galleries";

/** Resolve a stored web asset path against the request origin for social metadata. */
export function absoluteUrl(origin: string, path: string): string {
  return new URL(path, origin).toString();
}
