/**
 * Development seed implementation of `PortfolioRepository`.
 *
 * Used when no D1 binding is available and `ALLOW_DEVELOPMENT_SEED` is enabled
 * (see `app/data/queries.ts`). It applies exactly the same visibility rules as
 * the D1 implementation, so local behaviour matches production and the data
 * checks cover both.
 *
 * Server-only: importing it from a client module would pull the seed set into
 * the browser bundle.
 */
import type {
  GalleryRecord,
  PhotoRecord,
  PublicGallery,
  PublicGalleryWithPhotos,
  PublicPhoto,
  PublicPhotoWithGallery,
  PublicTag,
} from "./model";
import {
  editorialSlotForIndex,
  orientationOf,
  toPublicGallery,
  toPublicPhoto,
  toPublicPhotoWithGallery,
} from "./project";
import type { PortfolioRepository, PublicPhotoDetail } from "./repository";
import { slugify, suffixedSlug, type NewPhotoInput } from "./repository";
import { seed } from "./seed";

/** Newest first, then stable alphabetical slug order. */
function byPublishedAtDesc(a: PhotoRecord, b: PhotoRecord): number {
  const left = a.publishedAt ?? "";
  const right = b.publishedAt ?? "";
  if (left === right) {
    return a.slug.localeCompare(b.slug);
  }
  return left < right ? 1 : -1;
}

export class SeedPortfolioRepository implements PortfolioRepository {
  #publishedGalleries(): GalleryRecord[] {
    return seed.galleries
      .filter((gallery) => gallery.published)
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder || a.slug.localeCompare(b.slug));
  }

  #galleryById(galleryId: string): GalleryRecord | null {
    return this.#publishedGalleries().find((gallery) => gallery.id === galleryId) ?? null;
  }

  #photosInGallery(galleryId: string): PhotoRecord[] {
    return seed.photos
      .filter((photo) => photo.published && photo.galleryId === galleryId)
      .sort(byPublishedAtDesc);
  }

  #publishedPhotos(): PhotoRecord[] {
    const visible = new Set(this.#publishedGalleries().map((gallery) => gallery.id));
    return seed.photos
      .filter((photo) => photo.published && visible.has(photo.galleryId))
      .sort(byPublishedAtDesc);
  }

  async listGalleries(): Promise<readonly PublicGallery[]> {
    return this.#publishedGalleries().map(toPublicGallery);
  }

  async getGallery(slug: string): Promise<PublicGalleryWithPhotos | null> {
    const gallery = this.#publishedGalleries().find((candidate) => candidate.slug === slug);
    if (!gallery) {
      return null;
    }
    return {
      ...toPublicGallery(gallery),
      photos: this.#photosInGallery(gallery.id).map(toPublicPhoto),
    };
  }

  async photoCounts(): Promise<ReadonlyMap<string, number>> {
    const counts = new Map<string, number>();
    for (const gallery of this.#publishedGalleries()) {
      counts.set(gallery.id, this.#photosInGallery(gallery.id).length);
    }
    return counts;
  }

  async listPhotos(): Promise<readonly PublicPhoto[]> {
    return this.#publishedPhotos().map(toPublicPhoto);
  }

  async getPhoto(slug: string): Promise<PublicPhotoWithGallery | null> {
    const photo = this.#publishedPhotos().find((candidate) => candidate.slug === slug);
    if (!photo) {
      return null;
    }
    const gallery = this.#galleryById(photo.galleryId);
    if (!gallery) {
      return null;
    }
    return toPublicPhotoWithGallery(photo, gallery);
  }

  async getPhotoDetail(slug: string): Promise<PublicPhotoDetail | null> {
    const photo = await this.getPhoto(slug);
    if (!photo) {
      return null;
    }
    const siblings = this.#photosInGallery(photo.galleryId);
    const index = siblings.findIndex((candidate) => candidate.slug === slug);
    const previous = index > 0 ? siblings[index - 1] ?? null : null;
    const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] ?? null : null;
    return {
      photo,
      gallery: photo.gallery,
      previous: previous ? toPublicPhoto(previous) : null,
      next: next ? toPublicPhoto(next) : null,
    };
  }

  async listFeatured(limit?: number): Promise<readonly PublicPhotoWithGallery[]> {
    const featured = this.#publishedPhotos().filter((photo) => photo.featured);
    return this.#withGalleries(typeof limit === "number" ? featured.slice(0, limit) : featured);
  }

  async listRecent(limit: number): Promise<readonly PublicPhotoWithGallery[]> {
    return this.#withGalleries(this.#publishedPhotos().slice(0, limit));
  }

  async resolveTags(tagIds: readonly string[]): Promise<readonly PublicTag[]> {
    const resolved: PublicTag[] = [];
    for (const tagId of tagIds) {
      const tag = seed.tags.find((candidate) => candidate.id === tagId);
      if (tag) {
        resolved.push({ name: tag.name, slug: tag.slug });
      }
    }
    return resolved;
  }

  async listTags(): Promise<readonly PublicTag[]> {
    const used = new Set<string>();
    for (const photo of this.#publishedPhotos()) {
      for (const tagId of photo.tags) {
        used.add(tagId);
      }
    }
    return seed.tags
      .filter((tag) => used.has(tag.id))
      .map((tag) => ({ name: tag.name, slug: tag.slug }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getGalleryCover(gallery: PublicGallery): Promise<PublicPhoto | null> {
    const photos = this.#photosInGallery(gallery.id);
    const cover = gallery.coverPhotoId
      ? photos.find((photo) => photo.id === gallery.coverPhotoId)
      : undefined;
    const chosen = cover ?? photos[0];
    return chosen ? toPublicPhoto(chosen) : null;
  }

  #withGalleries(photos: readonly PhotoRecord[]): PublicPhotoWithGallery[] {
    const result: PublicPhotoWithGallery[] = [];
    photos.forEach((photo, index) => {
      const gallery = this.#galleryById(photo.galleryId);
      if (!gallery) {
        return;
      }
      result.push(
        toPublicPhotoWithGallery(
          { ...photo, featuredVariant: editorialSlotForIndex(index) },
          gallery,
        ),
      );
    });
    return result;
  }

  /**
   * A slug no seed photograph holds yet.
   *
   * Mirrors the D1 implementation's shape (`base`, `base-2`, `base-3`, …) so a
   * local upload and a production upload of the same title name the photograph
   * identically. Uniqueness covers ALL seed photographs, published or not,
   * because `photos.slug` is unique in the table regardless of visibility.
   */
  async availablePhotoSlug(preferred: string): Promise<string> {
    const base = slugify(preferred) ?? "photo";
    const taken = new Set(seed.photos.map((photo) => photo.slug));
    if (!taken.has(base)) {
      return base;
    }
    for (let attempt = 2; attempt <= 1000; attempt += 1) {
      const candidate = suffixedSlug(base, attempt);
      if (!taken.has(candidate)) {
        return candidate;
      }
    }
    return `${base}-${Date.now()}`;
  }

  /**
   * Record a photograph in the in-memory seed set.
   *
   * The development seed is not a database, so this appends to the process's
   * seed array: the upload appears for the life of the dev server and is gone
   * after a restart. That is deliberate — writing uploads into shipped source
   * data would be worse — and the admin page says so when it runs on the seed
   * source.
   */
  async createPhoto(input: NewPhotoInput): Promise<PhotoRecord> {
    const now = new Date().toISOString();
    const record: PhotoRecord = {
      id: input.id,
      title: input.title,
      slug: input.slug,
      description: input.description,
      galleryId: input.galleryId,
      tags: [...new Set(input.tags)],
      location: input.location,
      captureDate: input.captureDate,
      width: input.width,
      height: input.height,
      orientation: orientationOf(input.width, input.height),
      originalStorageKey: input.originalStorageKey,
      webStorageKey: input.webStorageKey,
      thumbnailStorageKey: input.thumbnailStorageKey,
      watermarkEnabled: input.watermarkEnabled,
      watermarkPosition: input.watermarkPosition,
      featured: input.featured,
      featuredVariant: "a",
      published: input.published,
      printAvailable: input.printAvailable,
      createdAt: now,
      updatedAt: now,
      publishedAt: input.published ? now : null,
    };
    // The seed set is `readonly` to every consumer; this one write path is the
    // deliberate exception, so the cast is narrowed to the array itself rather
    // than widening the exported type.
    (seed.photos as PhotoRecord[]).push(record);
    return record;
  }
}
