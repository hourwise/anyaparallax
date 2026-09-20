/**
 * Portfolio repository contract.
 *
 * Public loaders depend on this interface, never on a storage technology.
 * Implementations:
 *
 *   app/data/repository.d1.server.ts    Cloudflare D1 (the real store)
 *   app/data/repository.seed.server.ts  development seed set (local only)
 *
 * Every method returns PUBLIC projections only — `PublicPhoto`, `PublicGallery`,
 * `PublicTag` and their compositions. Persistence records (and therefore
 * private-master storage keys) must not leave a repository implementation.
 *
 * Visibility rules belong to the implementation but must be identical:
 * unpublished galleries and photographs never appear, and unknown slugs are
 * indistinguishable from unpublished ones.
 */
import type {
  PhotoRecord,
  PublicGallery,
  PublicGalleryWithPhotos,
  PublicPhoto,
  PublicPhotoWithGallery,
  PublicTag,
  WatermarkPosition,
} from "./model";

/** A photograph page's data: the photograph, its gallery and its neighbours. */
export type PublicPhotoDetail = {
  readonly photo: PublicPhoto;
  readonly gallery: PublicGallery;
  readonly previous: PublicPhoto | null;
  readonly next: PublicPhoto | null;
};

/**
 * A new photograph recorded from an accepted upload (Slice 06).
 *
 * Storage keys are already resolved by the upload pipeline before this is
 * called, so the repository stores decisions rather than making them. Geometry
 * is the ORIGINAL's, because that is what the archival record must state.
 */
export type NewPhotoInput = {
  /** Application-generated photo id; also the storage-key segment for its objects. */
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly description: string;
  readonly galleryId: string;
  readonly tags: readonly string[];
  readonly location: string | null;
  readonly captureDate: string | null;
  readonly width: number;
  readonly height: number;
  readonly originalStorageKey: string;
  readonly webStorageKey: string;
  readonly thumbnailStorageKey: string;
  readonly watermarkEnabled: boolean;
  readonly watermarkPosition: WatermarkPosition;
  readonly published: boolean;
  readonly featured: boolean;
  readonly printAvailable: boolean;
};

/** Turn an operator's title into a slug candidate, or null when nothing usable remains. */
export function slugify(value: string): string | null {
  const slug = value
    .normalize("NFKD")
    // Drop combining marks so an accented title still yields an ASCII slug.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug.slice(0, 80) : null;
}

/** Append a numeric suffix to a slug candidate: `slug`, `slug-2`, `slug-3`, … */
export function suffixedSlug(base: string, attempt: number): string {
  return attempt <= 1 ? base : `${base}-${attempt}`;
}

export interface PortfolioRepository {
  /** Published galleries, configured display order. */
  listGalleries(): Promise<readonly PublicGallery[]>;

  /** A published gallery with its published photographs, or null. */
  getGallery(slug: string): Promise<PublicGalleryWithPhotos | null>;

  /** How many photographs the gallery publishes, keyed by gallery id. */
  photoCounts(): Promise<ReadonlyMap<string, number>>;

  /** Every published photograph across published galleries, newest first. */
  listPhotos(): Promise<readonly PublicPhoto[]>;

  /**
   * A published photograph with its publishing gallery, or null when the slug
   * is unknown, unpublished, or sits in an unpublished gallery.
   */
  getPhoto(slug: string): Promise<PublicPhotoWithGallery | null>;

  /** A published photograph with previous/next navigation inside its gallery. */
  getPhotoDetail(slug: string): Promise<PublicPhotoDetail | null>;

  /** Featured published photographs with gallery context, newest first. */
  listFeatured(limit?: number): Promise<readonly PublicPhotoWithGallery[]>;

  /** Recent published photographs with gallery context, newest first. */
  listRecent(limit: number): Promise<readonly PublicPhotoWithGallery[]>;

  /** Tag ids resolved to public entries, preserving input order. */
  resolveTags(tagIds: readonly string[]): Promise<readonly PublicTag[]>;

  /** Every tag used by at least one published photograph, A–Z. */
  listTags(): Promise<readonly PublicTag[]>;

  /** The cover photograph for a gallery: the configured cover when published, otherwise the newest member. */
  getGalleryCover(gallery: PublicGallery): Promise<PublicPhoto | null>;

  /**
   * A slug not yet taken by any photograph, derived from the preferred base.
   *
   * Lives on the repository because only the store knows what is taken; the two
   * implementations must agree on the shape (`base`, `base-2`, `base-3`, …) so a
   * local upload and a production upload name the same photograph the same way.
   */
  availablePhotoSlug(preferred: string): Promise<string>;

  /**
   * Record a photograph from an accepted upload.
   *
   * The stored record is returned so the caller can report the real slug. The
   * row is created unpublished only when asked; nothing here decides visibility
   * beyond what the operator requested.
   */
  createPhoto(input: NewPhotoInput): Promise<PhotoRecord>;
}
