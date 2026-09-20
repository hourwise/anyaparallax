/**
 * Portfolio domain model — galleries, photographs, tags and their relationships.
 *
 * Slice 03 (portfolio data and public pages). These types are written to map
 * directly onto the D1 schema that Slice 04 creates:
 *
 * - `PhotoRecord` / `GalleryRecord` / `TagRecord` mirror intended table rows
 *   (snake_case scalar fields are kept as camelCase here and mapped in the
 *   storage layer).
 * - `PhotoRecord.published` is the single source of truth for public
 *   visibility. Galleries additionally carry their own `published` flag.
 * - A photograph belongs to one gallery via `galleryId`; multi-gallery
 *   membership is deliberately NOT modelled yet (the `photo_galleries`
 *   junction table in the build sheet is reserved for a later, justified
 *   need). Tags are independent of galleries so one master never needs
 *   duplicating to appear under several classifications.
 * - Like and share data (slices 07) will be separate tables keyed by photo id.
 *
 * Record types (`*Record`) are persistence shapes and must never be returned
 * from public loaders. Public routes receive the explicit projections below
 * (`PublicPhoto`, `PublicGallery`, `PublicTag` and their compositions), which
 * exclude private-master storage keys and other internal fields.
 */

/** Gallery row, as stored. */
export type GalleryRecord = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  /**
   * Cover photograph id, or null when the gallery has no cover yet. When set,
   * the seed check requires the photograph to exist, to be published, and to
   * belong to this gallery.
   */
  readonly coverPhotoId: string | null;
  readonly displayOrder: number;
  readonly published: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** Tag row, as stored. */
export type TagRecord = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
};

/** Photograph row, as stored. */
export type PhotoRecord = {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly description: string;
  /** Primary gallery. Multi-gallery membership is intentionally not modelled. */
  readonly galleryId: string;
  readonly tags: readonly string[];
  readonly location: string | null;
  /** ISO date (YYYY-MM-DD) when known. */
  readonly captureDate: string | null;
  readonly width: number;
  readonly height: number;
  readonly orientation: PhotoOrientation;
  /**
   * Storage keys. `originalStorageKey` locates the PRIVATE archival/print
   * master and must never be exposed publicly — see `PublicPhoto`. The web and
   * thumbnail derivatives are public once their photograph is published.
   * Slices 04/06 replace the development values with real bucket keys.
   */
  readonly originalStorageKey: string;
  readonly webStorageKey: string;
  readonly thumbnailStorageKey: string;
  readonly watermarkEnabled: boolean;
  readonly watermarkPosition: WatermarkPosition;
  readonly featured: boolean;
  /**
   * Editorial grid slot for featured presentation (homepage). Presentation-only:
   * the data layer stores the hint, the component maps it to a CSS class and
   * repeats the pattern when there are more featured photographs than slots.
   */
  readonly featuredVariant: string;
  /** Visibility source of truth: unpublished photos must never appear publicly. */
  readonly published: boolean;
  readonly printAvailable: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
};

export type PhotoOrientation = "landscape" | "portrait" | "square";

export type WatermarkPosition =
  | "bottom-right"
  | "bottom-left"
  | "bottom-center"
  | "center"
  | "none";

/** Computed aspect ratio, e.g. "3 / 2", for reserved layout space. */
export function aspectRatioOf(photo: Pick<PublicPhoto, "width" | "height">): string {
  return `${photo.width} / ${photo.height}`;
}

/**
 * Public photograph projection (`PublicPhoto`).
 *
 * This is the ONLY photograph shape that may leave the query boundary. It is
 * built field by field by `toPublicPhoto()` so persistence-only fields — most
 * importantly `originalStorageKey`, which identifies the private archival/print
 * master in R2 — can never reach a public loader payload or client bundle.
 *
 * Enforced by `scripts/check-data-layer.mjs`, which fails if a forbidden field
 * appears in any public result, and by `scripts/check-served-payload.mjs`,
 * which fails if a private master key appears in served HTML.
 *
 * Fields added to `PhotoRecord` are NOT public by default: add them here only
 * when the public UI genuinely needs them.
 */
export type PublicPhoto = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  /** Gallery id for relationship checks; the display name comes from `PublicGallery`. */
  readonly galleryId: string;
  /** Tag ids resolved through the public tag projection. */
  readonly tags: readonly string[];
  readonly location: string | null;
  readonly captureDate: string | null;
  readonly width: number;
  readonly height: number;
  readonly orientation: PhotoOrientation;
  /** Public derivatives only. The private master key is deliberately absent. */
  readonly webStorageKey: string;
  readonly thumbnailStorageKey: string;
  readonly featured: boolean;
  /** Editorial grid slot for featured presentation; presentation-only. */
  readonly featuredVariant: string;
  readonly printAvailable: boolean;
};

/**
 * Public gallery projection. Excludes persistence-only fields such as
 * timestamps and the `published` flag, and never carries master keys.
 */
export type PublicGallery = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly coverPhotoId: string | null;
  readonly displayOrder: number;
};

/** A public photograph with its publishing gallery resolved. */
export type PublicPhotoWithGallery = PublicPhoto & {
  readonly gallery: PublicGallery;
};

/** A public gallery with its published member photographs, in display order. */
export type PublicGalleryWithPhotos = PublicGallery & {
  readonly photos: readonly PublicPhoto[];
};

/** A public photograph with adjacent navigation inside its gallery. */
export type PublicPhotoDetail = {
  readonly photo: PublicPhoto;
  readonly gallery: PublicGallery;
  readonly previous: PublicPhoto | null;
  readonly next: PublicPhoto | null;
};

/** Tag registry entry as exposed publicly. */
export type PublicTag = {
  readonly name: string;
  readonly slug: string;
};

/**
 * Application roles (Slice 05). The `users` table constrains `role` to these
 * values, and every server-side authorization decision maps a verified identity
 * to exactly one of them. Roles are never accepted from the client: they are
 * read from the database after the identity itself has been verified.
 */
export const APP_ROLES = ["photographer", "manager"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

/**
 * Authorised application user row, as stored in the `users` table.
 *
 * This is a persistence shape and is deliberately NOT a public projection:
 * emails are personal data and must never reach a public page, a public loader
 * payload or the client bundle. Only the `/admin` and `/manager` surfaces —
 * which are authenticated and role-checked — may display an account, and only
 * to the signed-in operator.
 */
export type UserRecord = {
  readonly id: string;
  readonly email: string;
  readonly role: AppRole;
  /**
   * Deactivating a row revokes access without deleting the audit trail. An
   * inactive account authenticates but is denied authorization.
   */
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
};
