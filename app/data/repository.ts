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
  PublicGallery,
  PublicGalleryWithPhotos,
  PublicPhoto,
  PublicPhotoWithGallery,
  PublicTag,
} from "./model";

/** A photograph page's data: the photograph, its gallery and its neighbours. */
export type PublicPhotoDetail = {
  readonly photo: PublicPhoto;
  readonly gallery: PublicGallery;
  readonly previous: PublicPhoto | null;
  readonly next: PublicPhoto | null;
};

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
}
