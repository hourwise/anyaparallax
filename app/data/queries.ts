/**
 * Public portfolio queries — the single boundary between stored portfolio data
 * and anything a visitor can see.
 *
 * Two contracts are enforced here:
 *
 * 1. VISIBILITY — a photograph is publicly visible only when `published` is
 *    true, and a gallery only when its own `published` flag is true.
 *    Unpublished and unknown items are indistinguishable publicly: public
 *    routes render the same 404 for both.
 *
 * 2. PROJECTION — this module never returns raw persistence records. Every
 *    export returns explicit public view types built field by field by the
 *    `toPublic*` mappers, so private-master fields (for example
 *    `originalStorageKey`) and other internal columns cannot reach loader
 *    payloads even by accident. Loader data is serialised to the browser, so
 *    anything returned here is effectively public.
 *
 * Slice 04 replaces the `seed` source with D1 queries while keeping these
 * signatures, so routes and components do not change.
 */
import type {
  GalleryRecord,
  PhotoRecord,
  PublicGallery,
  PublicGalleryWithPhotos,
  PublicPhoto,
  PublicPhotoDetail,
  PublicPhotoWithGallery,
  PublicTag,
} from "./model";
import { seed } from "./seed";

// ---------------------------------------------------------------------------
// Projection mappers. These are the only place where persistence fields are
// chosen for public consumption; everything else is dropped.
// ---------------------------------------------------------------------------

/** Persistence photograph → public projection. */
function toPublicPhoto(photo: PhotoRecord): PublicPhoto {
  return {
    id: photo.id,
    slug: photo.slug,
    title: photo.title,
    description: photo.description,
    galleryId: photo.galleryId,
    tags: photo.tags,
    location: photo.location,
    captureDate: photo.captureDate,
    width: photo.width,
    height: photo.height,
    orientation: photo.orientation,
    webStorageKey: photo.webStorageKey,
    thumbnailStorageKey: photo.thumbnailStorageKey,
    featured: photo.featured,
    featuredVariant: photo.featuredVariant,
    printAvailable: photo.printAvailable,
  };
}

/** Persistence gallery → public projection. */
function toPublicGallery(gallery: GalleryRecord): PublicGallery {
  return {
    id: gallery.id,
    name: gallery.name,
    slug: gallery.slug,
    description: gallery.description,
    coverPhotoId: gallery.coverPhotoId,
    displayOrder: gallery.displayOrder,
  };
}

// ---------------------------------------------------------------------------
// Internal record-level visibility helpers. Not exported: callers outside this
// module must use the projected public functions below.
// ---------------------------------------------------------------------------

function isPublishedPhoto(photo: PhotoRecord): photo is PhotoRecord {
  return photo.published;
}

function isPublishedGallery(gallery: GalleryRecord): gallery is GalleryRecord {
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

/** Published photographs belonging to a gallery, newest first. */
function publishedRecordsInGallery(galleryId: string): PhotoRecord[] {
  const result: PhotoRecord[] = [];
  for (const photo of seed.photos) {
    if (isPublishedPhoto(photo) && photo.galleryId === galleryId) {
      result.push(photo);
    }
  }
  return result.sort(byPublishedAtDesc);
}

/** Published gallery records, in configured display order. */
function publishedGalleryRecords(): GalleryRecord[] {
  const result: GalleryRecord[] = [];
  for (const gallery of seed.galleries) {
    if (isPublishedGallery(gallery)) {
      result.push(gallery);
    }
  }
  return result.sort((a, b) => a.displayOrder - b.displayOrder);
}

/** Published photograph records across published galleries, newest first. */
function publishedPhotoRecords(): PhotoRecord[] {
  const visibleGalleryIds = new Set(publishedGalleryRecords().map((gallery) => gallery.id));
  const result: PhotoRecord[] = [];
  for (const photo of seed.photos) {
    if (isPublishedPhoto(photo) && visibleGalleryIds.has(photo.galleryId)) {
      result.push(photo);
    }
  }
  return result.sort(byPublishedAtDesc);
}

function publishedGalleryRecordById(galleryId: string): GalleryRecord | null {
  for (const gallery of publishedGalleryRecords()) {
    if (gallery.id === galleryId) {
      return gallery;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API — projections only.
// ---------------------------------------------------------------------------

/** Published galleries, in configured display order. */
export function listPublishedGalleries(): readonly PublicGallery[] {
  return publishedGalleryRecords().map(toPublicGallery);
}

/**
 * A published gallery with its published member photographs, or null when the
 * slug does not exist or the gallery is unpublished.
 */
export function getPublishedGallery(slug: string): PublicGalleryWithPhotos | null {
  const gallery = seed.galleries.find(
    (candidate) => candidate.slug === slug && isPublishedGallery(candidate),
  );
  if (!gallery) {
    return null;
  }
  return {
    ...toPublicGallery(gallery),
    photos: publishedRecordsInGallery(gallery.id).map(toPublicPhoto),
  };
}

/** Every published photograph across published galleries, newest first. */
export function listPublishedPhotos(): readonly PublicPhoto[] {
  return publishedPhotoRecords().map(toPublicPhoto);
}

/** Public counts of published photographs per gallery id. */
export function publishedPhotoCounts(): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const gallery of publishedGalleryRecords()) {
    counts.set(gallery.id, publishedRecordsInGallery(gallery.id).length);
  }
  return counts;
}

function withGallery(records: readonly PhotoRecord[]): PublicPhotoWithGallery[] {
  const result: PublicPhotoWithGallery[] = [];
  for (const record of records) {
    const gallery = publishedGalleryRecordById(record.galleryId);
    if (gallery) {
      result.push({ ...toPublicPhoto(record), gallery: toPublicGallery(gallery) });
    }
  }
  return result;
}

/** Featured published photographs with gallery context, newest first. */
export function listFeaturedWithGallery(limit?: number): readonly PublicPhotoWithGallery[] {
  const records = publishedPhotoRecords().filter((photo) => photo.featured);
  const bounded = typeof limit === "number" ? records.slice(0, limit) : records;
  return withGallery(bounded);
}

/** Recent published photographs with gallery context, newest first. */
export function listRecentWithGallery(limit: number): readonly PublicPhotoWithGallery[] {
  return withGallery(publishedPhotoRecords().slice(0, limit));
}

/**
 * A published photograph resolved with its gallery, or null when the slug does
 * not exist, the photograph is unpublished, or its gallery is unpublished.
 */
export function getPublishedPhoto(slug: string): PublicPhotoWithGallery | null {
  const record = seed.photos.find(
    (candidate) => candidate.slug === slug && isPublishedPhoto(candidate),
  );
  if (!record) {
    return null;
  }
  const gallery = publishedGalleryRecordById(record.galleryId);
  if (!gallery) {
    return null;
  }
  return { ...toPublicPhoto(record), gallery: toPublicGallery(gallery) };
}

/**
 * A photograph with previous/next navigation inside its gallery. Unpublished
 * photographs are never part of the navigation order.
 */
export function getPhotoDetail(slug: string): PublicPhotoDetail | null {
  const photo = getPublishedPhoto(slug);
  if (!photo) {
    return null;
  }
  const siblings = publishedRecordsInGallery(photo.galleryId);
  const index = siblings.findIndex((candidate) => candidate.slug === slug);
  const previousRecord = index > 0 ? siblings[index - 1] ?? null : null;
  const nextRecord =
    index >= 0 && index < siblings.length - 1 ? siblings[index + 1] ?? null : null;
  return {
    photo,
    gallery: photo.gallery,
    previous: previousRecord ? toPublicPhoto(previousRecord) : null,
    next: nextRecord ? toPublicPhoto(nextRecord) : null,
  };
}

/** Resolve tag ids to their public registry entries, preserving input order. */
export function resolveTags(tagIds: readonly string[]): readonly PublicTag[] {
  const resolved: PublicTag[] = [];
  for (const tagId of tagIds) {
    const tag = seed.tags.find((candidate) => candidate.id === tagId);
    if (tag) {
      resolved.push({ name: tag.name, slug: tag.slug });
    }
  }
  return resolved;
}

/** Every tag used by at least one published photograph, A–Z. */
export function listPublishedTags(): readonly PublicTag[] {
  const used = new Set<string>();
  for (const photo of publishedPhotoRecords()) {
    for (const tagId of photo.tags) {
      used.add(tagId);
    }
  }
  const result: PublicTag[] = [];
  for (const tag of seed.tags) {
    if (used.has(tag.id)) {
      result.push({ name: tag.name, slug: tag.slug });
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The gallery cover as a public photograph. Falls back to the newest published
 * member when the configured cover is missing or unpublished, and returns null
 * when the gallery has no published photographs at all.
 */
export function galleryCover(gallery: PublicGallery): PublicPhoto | null {
  const photos = publishedRecordsInGallery(gallery.id);
  const cover =
    photos.find((photo) => photo.id === gallery.coverPhotoId) ?? photos[0] ?? null;
  return cover ? toPublicPhoto(cover) : null;
}
