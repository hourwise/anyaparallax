/**
 * Public portfolio queries — the single boundary between stored portfolio data
 * and anything a visitor can see.
 *
 * Visibility contract (Slice 03):
 * - A photograph is publicly visible only when `published` is true.
 * - A gallery is publicly visible only when its own `published` flag is true.
 * - Unpublished galleries and photographs are indistinguishable from absent
 *   ones on public routes: both produce the same 404, so publication state can
 *   never be inferred from public behaviour.
 * - Public list views contain published items only.
 *
 * Slice 04 replaces the `seed` source below with D1 queries while keeping these
 * function signatures, so routes and components do not change.
 */
import type {
  GalleryRecord,
  GalleryWithPhotos,
  PhotoRecord,
  PublishedGallery,
  PublishedPhoto,
} from "./model";
import { seed } from "./seed";

/** A published photograph with its publishing gallery resolved. */
export type PhotoWithGallery = PublishedPhoto & {
  readonly gallery: PublishedGallery;
};

/** A published photograph with adjacent navigation inside its gallery. */
export type PhotoDetail = {
  readonly photo: PublishedPhoto;
  readonly gallery: PublishedGallery;
  readonly previous: PublishedPhoto | null;
  readonly next: PublishedPhoto | null;
};

function isPublishedPhoto(photo: PhotoRecord): photo is PublishedPhoto {
  return photo.published;
}

function isPublishedGallery(gallery: GalleryRecord): gallery is PublishedGallery {
  return gallery.published;
}

/** Newest first, then stable alphabetical slug order. */
function byPublishedAtDesc(a: PhotoRecord, b: PhotoRecord): number {
  const left = a.publishedAt ?? "";
  const right = b.publishedAt ?? "";
  if (left === right) {
    return a.slug.localeCompare(b.slug);
  }
  return left < right ? 1 : -1;
}

function publishedInGallery(galleryId: string): PublishedPhoto[] {
  const result: PublishedPhoto[] = [];
  for (const photo of seed.photos) {
    if (isPublishedPhoto(photo) && photo.galleryId === galleryId) {
      result.push(photo);
    }
  }
  return result.sort(byPublishedAtDesc);
}

/** Published galleries, in configured display order. */
export function listPublishedGalleries(): readonly PublishedGallery[] {
  const result: PublishedGallery[] = [];
  for (const gallery of seed.galleries) {
    if (isPublishedGallery(gallery)) {
      result.push(gallery);
    }
  }
  return result.sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * A published gallery with its published photographs, or null when the slug
 * does not exist or the gallery is unpublished.
 */
export function getPublishedGallery(slug: string): GalleryWithPhotos | null {
  const gallery = seed.galleries.find(
    (candidate) => candidate.slug === slug && isPublishedGallery(candidate),
  );
  if (!gallery) {
    return null;
  }
  return { ...gallery, photos: publishedInGallery(gallery.id) };
}

/** Every published photograph across published galleries, newest first. */
export function listPublishedPhotos(): readonly PublishedPhoto[] {
  const visibleGalleryIds = new Set(listPublishedGalleries().map((gallery) => gallery.id));
  const result: PublishedPhoto[] = [];
  for (const photo of seed.photos) {
    if (isPublishedPhoto(photo) && visibleGalleryIds.has(photo.galleryId)) {
      result.push(photo);
    }
  }
  return result.sort(byPublishedAtDesc);
}

/** The most recently published photographs, bounded by `limit`. */
export function listRecentPhotos(limit: number): readonly PublishedPhoto[] {
  return listPublishedPhotos().slice(0, limit);
}

/**
 * Featured photographs for editorial presentation. Only published photographs
 * in published galleries qualify, newest first.
 */
export function listFeaturedPhotos(limit?: number): readonly PublishedPhoto[] {
  const featured = listPublishedPhotos().filter((photo) => photo.featured);
  return typeof limit === "number" ? featured.slice(0, limit) : featured;
}

function galleryFor(photo: PhotoRecord): PublishedGallery | null {
  for (const candidate of seed.galleries) {
    if (candidate.id === photo.galleryId && isPublishedGallery(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Attach gallery context to every published photograph that has a published
 * gallery. Used by the homepage and any view that links back to a collection.
 */
function withGallery(photos: readonly PublishedPhoto[]): readonly PhotoWithGallery[] {
  const result: PhotoWithGallery[] = [];
  for (const photo of photos) {
    const gallery = galleryFor(photo);
    if (gallery) {
      result.push({ ...photo, gallery });
    }
  }
  return result;
}

/** Featured published photographs with gallery context, newest first. */
export function listFeaturedWithGallery(limit?: number): readonly PhotoWithGallery[] {
  return withGallery(listFeaturedPhotos(limit));
}

/** Recent published photographs with gallery context, newest first. */
export function listRecentWithGallery(limit: number): readonly PhotoWithGallery[] {
  return withGallery(listRecentPhotos(limit));
}

/**
 * A published photograph resolved with its gallery, or null when the slug does
 * not exist, the photograph is unpublished, or its gallery is unpublished.
 */
export function getPublishedPhoto(slug: string): PhotoWithGallery | null {
  const photo = seed.photos.find(
    (candidate) => candidate.slug === slug && isPublishedPhoto(candidate),
  );
  if (!photo) {
    return null;
  }
  const gallery = galleryFor(photo);
  if (!gallery) {
    return null;
  }
  return { ...photo, gallery };
}

/**
 * A photograph with previous/next navigation inside its gallery. Unpublished
 * photographs are never part of the navigation order.
 */
export function getPhotoDetail(slug: string): PhotoDetail | null {
  const photo = getPublishedPhoto(slug);
  if (!photo) {
    return null;
  }
  const siblings = publishedInGallery(photo.galleryId);
  const index = siblings.findIndex((candidate) => candidate.slug === slug);
  const previous = index > 0 ? siblings[index - 1] ?? null : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] ?? null : null;
  return {
    photo,
    gallery: photo.gallery,
    previous,
    next,
  };
}

/** Published published-photo counts per gallery, keyed by gallery id. */
export function publishedPhotoCounts(): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const gallery of listPublishedGalleries()) {
    counts.set(gallery.id, publishedInGallery(gallery.id).length);
  }
  return counts;
}

/** Tag registry entry as exposed publicly. */
export type PublicTag = {
  readonly name: string;
  readonly slug: string;
};

/** Resolve tag ids to their public registry entries, preserving input order. */
export function resolveTags(tagIds: readonly string[]): readonly PublicTag[] {
  return tagIds
    .map((id) => seed.tags.find((tag) => tag.id === id))
    .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
    .map((tag) => ({ name: tag.name, slug: tag.slug }));
}

/** Every tag that is used by at least one published photograph, A–Z. */
export function listPublishedTags(): readonly PublicTag[] {
  const used = new Set(listPublishedPhotos().flatMap((photo) => [...photo.tags]));
  return seed.tags
    .filter((tag) => used.has(tag.id))
    .map((tag) => ({ name: tag.name, slug: tag.slug }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The gallery cover as a published photograph. Falls back to the newest
 * published member when the configured cover is missing or unpublished, and
 * returns null when the gallery has no published photographs at all.
 */
export function galleryCover(gallery: GalleryRecord): PublishedPhoto | null {
  const photos = publishedInGallery(gallery.id);
  return photos.find((photo) => photo.id === gallery.coverPhotoId) ?? photos[0] ?? null;
}
