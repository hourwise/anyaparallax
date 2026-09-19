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
   * Storage keys. They are R2-style object keys; Slice 03 development seed data
   * points them at placeholder assets on the public origin. Slices 04/06 replace
   * them with real bucket keys and generated derivatives.
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
export function aspectRatioOf(photo: Pick<PhotoRecord, "width" | "height">): string {
  return `${photo.width} / ${photo.height}`;
}

/**
 * A photograph that has passed the public visibility rules.
 *
 * Visibility is expressed through the query boundary's types (these aliases are
 * produced only by narrowing on `published`), not by a literal-`true` property.
 * That keeps records easy to spread and to map from database rows.
 */
export type PublishedPhoto = PhotoRecord;

/** A gallery that has passed the public visibility rules. */
export type PublishedGallery = GalleryRecord;

/** A gallery's published member photographs, in display order. */
export type GalleryWithPhotos = PublishedGallery & {
  readonly photos: readonly PublishedPhoto[];
};
