/**
 * Shared projection mappers (Slice 03; public-image delivery repaired in Slice 07A).
 *
 * These turn persistence records into the public view types. They are the ONLY
 * place where persistence fields are chosen for public consumption, and they
 * are reused by every repository implementation so the public shape cannot
 * diverge between D1 and the development seed.
 *
 * `originalStorageKey` is deliberately never copied: it locates the private
 * archival/print master and must not reach a loader payload.
 *
 * PUBLIC IMAGE DELIVERY (Slice 07A). Stored image references are converted HERE,
 * at the single boundary every public read passes through, rather than at each
 * render site. That is the repair for a defect where `toPublicPhoto` copied the
 * raw `r2://images/...` key into the public projection and components emitted it
 * as an `src`, which a browser cannot load. Converting here means a public
 * loader payload cannot carry an internal storage reference at all, and a
 * component that tries to render one no longer compiles, because the public
 * fields are named `webImagePath` / `thumbnailImagePath`.
 *
 * The conversion is not a formatting step: `publicImagePathFrom()` refuses a
 * private master, an unknown storage domain and an `originals/` path, returning
 * null. A null is meant to be omitted, never replaced with a guess.
 */
import type {
  GalleryRecord,
  PhotoOrientation,
  PhotoRecord,
  PublicGallery,
  PublicPhoto,
  WatermarkPosition,
} from "./model";
import { publicImagePathFrom } from "./storage";

const watermarkPositions: readonly WatermarkPosition[] = [
  "bottom-right",
  "bottom-left",
  "bottom-center",
  "center",
  "none",
];

/** Validate a stored watermark position, falling back to the safe default. */
export function normaliseWatermarkPosition(value: string): WatermarkPosition {
  return (watermarkPositions as readonly string[]).includes(value)
    ? (value as WatermarkPosition)
    : "bottom-right";
}

/** Orientation is derived from dimensions rather than stored, so it cannot drift. */
export function orientationOf(width: number, height: number): PhotoOrientation {
  if (width === height) {
    return "square";
  }
  return width > height ? "landscape" : "portrait";
}

/**
 * Persistence photograph → public projection.
 *
 * The stored derivative references are converted to browser-facing public paths
 * here, so no public loader payload can carry an internal storage reference. The
 * master is neither converted nor copied.
 */
export function toPublicPhoto(photo: PhotoRecord): PublicPhoto {
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
    webImagePath: publicImagePathFrom(photo.webStorageKey),
    thumbnailImagePath: publicImagePathFrom(photo.thumbnailStorageKey),
    featured: photo.featured,
    featuredVariant: photo.featuredVariant,
    printAvailable: photo.printAvailable,
  };
}

/** Persistence gallery → public projection. */
export function toPublicGallery(gallery: GalleryRecord): PublicGallery {
  return {
    id: gallery.id,
    name: gallery.name,
    slug: gallery.slug,
    description: gallery.description,
    coverPhotoId: gallery.coverPhotoId,
    displayOrder: gallery.displayOrder,
  };
}

/** Public photograph with its publishing gallery attached. */
export function toPublicPhotoWithGallery(
  photo: PhotoRecord,
  gallery: GalleryRecord,
): PublicPhoto & { readonly gallery: PublicGallery } {
  return { ...toPublicPhoto(photo), gallery: toPublicGallery(gallery) };
}

/**
 * Editorial grid slots for the homepage. The slot is presentation-only and is
 * derived from position so the database does not carry layout concerns; the
 * pattern repeats once there are more featured photographs than slots.
 */
const editorialSlots = ["a", "b", "c", "d", "e"] as const;

export function editorialSlotForIndex(index: number): string {
  return editorialSlots[index % editorialSlots.length] ?? "a";
}
