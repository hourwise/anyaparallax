/**
 * Homepage editorial content and view mappings (slices 02–03).
 *
 * Page copy (hero, about preview) is provisional development wording and lives
 * here. Photography content is NOT duplicated here: the homepage route loads
 * published photographs, featured work, galleries and recent additions from the
 * public query boundary (`app/data/queries.ts`) and maps records to view objects
 * with the helpers below. Gallery names, covers and photo metadata therefore
 * come from the same source as the public gallery and photo pages.
 */
import type {
  PublicGalleryWithPhotos,
  PublicPhoto,
  PublicPhotoWithGallery,
} from "./model";
import { aspectRatioOf } from "./model";
import { galleryCover, publishedPhotoCounts } from "./queries";
import { galleryPath, photoPath } from "../lib/paths";

export const homepageMeta = {
  title: "Anyaparallax Photography — Night cities, live music, the moments after dark",
  description:
    "Street photography, live music and the energy of the night. A development preview of the Anyaparallax photography portfolio.",
} as const;

export const hero = {
  headline: ["Cities", "People", "Music", "Moments"],
  supporting: "Street photography, live music and the energy of the night.",
  action: { label: "Explore galleries", to: "/galleries" },
  photo: {
    photo: "/images/dev/hero-night-boulevard.svg",
    alt: "Development placeholder for the opening hero photograph: a wet night boulevard with tail lights and neon reflections.",
    ratio: "3 / 2",
  },
  /** Honest, visible label for the development stand-in used in the hero. */
  note: "Development preview — photography, copy and galleries are placeholders.",
} as const;

/** Short About preview. Final biography and wording await operator approval. */
export const aboutPreview = {
  title: "About Anya",
  body: "I'm Anya — a photographer drawn to the energy of cities, live music, cars and the moments that happen after dark. Anyaparallax is where that work gathers.",
  to: "/about",
  linkLabel: "More about Anya",
  photo: {
    photo: "/images/dev/street-portrait.svg",
    alt: "Development placeholder for a portrait of Anya, the photographer.",
    ratio: "4 / 5",
  },
} as const;

export type HomepagePhotoCard = {
  readonly id: string;
  readonly slug: string;
  readonly photo: string;
  readonly alt: string;
  readonly ratio: string;
  readonly title: string;
  readonly galleryTo: string;
  readonly galleryLabel: string;
  readonly to: string;
  /** Editorial grid slot for the featured presentation; presentation-only. */
  readonly variant: string;
};

export type HomepageGalleryCard = {
  readonly id: string;
  readonly name: string;
  readonly to: string;
  readonly cover: { photo: string; alt: string } | null;
  readonly count: number;
  readonly description: string;
};

/**
 * Featured work uses the editorial grid slots stored on the photographs
 * (`featuredVariant`), so the composition is data-driven and stable per photo.
 */
function photoAlt(photo: PublicPhoto): string {
  return photo.description
    ? `Development placeholder: ${photo.description}`
    : `Development placeholder photograph — ${photo.title}.`;
}

/** Public photograph with gallery context → homepage card view object. */
export function toPhotoCard(photo: PublicPhotoWithGallery): HomepagePhotoCard {
  return {
    id: photo.id,
    slug: photo.slug,
    photo: photo.webStorageKey,
    alt: photoAlt(photo),
    ratio: aspectRatioOf(photo),
    title: photo.title,
    galleryTo: galleryPath(photo.gallery.slug),
    galleryLabel: photo.gallery.name,
    to: photoPath(photo.slug),
    variant: photo.featuredVariant,
  };
}

/** Published gallery → homepage collection card view object. */
export function toGalleryCard(
  gallery: PublicGalleryWithPhotos,
  counts: ReadonlyMap<string, number>,
): HomepageGalleryCard {
  const cover = galleryCover(gallery);
  return {
    id: gallery.id,
    name: gallery.name,
    to: galleryPath(gallery.slug),
    cover: cover
      ? {
          photo: cover.thumbnailStorageKey,
          alt: `Development placeholder for the ${gallery.name} cover photograph.`,
        }
      : null,
    count: counts.get(gallery.id) ?? 0,
    description: gallery.description,
  };
}

export { publishedPhotoCounts };
