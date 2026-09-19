/**
 * Provisional homepage content for Slice 02 (homepage and editorial presentation).
 *
 * Everything in this file is development placeholder material derived from the V1
 * build sheet. None of it is approved final content:
 *
 * - The gallery collections mirror the build sheet's initial example list. They are
 *   held here as a replaceable data structure, NOT as permanent markup, and Slice 03
 *   replaces them with the database-driven gallery model.
 * - `photo` values point at development-only SVG stand-ins in `public/images/dev/`.
 *   Real photographs arrive through the upload pipeline in Slice 06.
 * - Titles, descriptions and counts are invented only to exercise the editorial
 *   layout and are labelled as provisional wherever they are rendered.
 * - Social account URLs are deliberately absent until the operator supplies them.
 */

export type PhotoSlot = {
  /** Development placeholder asset; replaced by real photography later. */
  readonly photo: string;
  /** Description of the intended photograph, used as the accessible name. */
  readonly alt: string;
  /** Intrinsic aspect ratio of the asset, e.g. "3 / 2". */
  readonly ratio: string;
};

export type HomepagePhoto = PhotoSlot & {
  readonly id: string;
  /** Provisional photograph title for editorial presentation only. */
  readonly title: string;
  /**
   * Target gallery collection. Slice 03 replaces this slug with the real
   * gallery relationship from the data model.
   */
  readonly gallerySlug: string;
  readonly galleryLabel: string;
};

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

/**
 * Featured work. The five entries are placed on a deliberately irregular grid
 * (`variant` names map to layout classes in `app.css`) rather than a uniform
 * social-media grid. Order and composition are provisional.
 */
export const featuredWork: readonly (HomepagePhoto & { readonly variant: string })[] = [
  {
    id: "featured-night-boulevard",
    variant: "a",
    photo: "/images/dev/night-boulevard.svg",
    alt: "Development placeholder for a city at night with red tail lights streaking along a wet boulevard.",
    ratio: "3 / 2",
    title: "Tail lights on wet asphalt",
    gallerySlug: "cityscapes",
    galleryLabel: "Cityscapes",
  },
  {
    id: "featured-stage-figure",
    variant: "b",
    photo: "/images/dev/stage-figure.svg",
    alt: "Development placeholder for a musician silhouetted against stage haze and magenta lighting.",
    ratio: "4 / 5",
    title: "Under the stage haze",
    gallerySlug: "live-music",
    galleryLabel: "Live Music",
  },
  {
    id: "featured-neon-alley",
    variant: "c",
    photo: "/images/dev/neon-alley.svg",
    alt: "Development placeholder for a narrow alley glowing with red neon signage.",
    ratio: "4 / 5",
    title: "Neon on the narrow street",
    gallerySlug: "nightlife",
    galleryLabel: "Nightlife",
  },
  {
    id: "featured-night-traffic",
    variant: "d",
    photo: "/images/dev/night-traffic.svg",
    alt: "Development placeholder for amber city traffic at night with long light trails.",
    ratio: "3 / 2",
    title: "Amber traffic, long exposure",
    gallerySlug: "cars",
    galleryLabel: "Cars",
  },
  {
    id: "featured-blue-hour",
    variant: "e",
    photo: "/images/dev/blue-hour.svg",
    alt: "Development placeholder for a monochrome blue-hour skyline across the water.",
    ratio: "16 / 9",
    title: "Blue hour, monochrome",
    gallerySlug: "black-white",
    galleryLabel: "Black & White",
  },
] as const;

export type GalleryCollection = {
  readonly slug: string;
  readonly name: string;
  /** Provisional image count. Real counts arrive with the Slice 03 data model. */
  readonly provisionalCount: number;
  readonly description: string;
  readonly cover: PhotoSlot;
};

/**
 * Explore-galleries content. These names come from the build sheet's initial
 * example list; they are NOT permanently hard-coded site structure. Slice 03
 * creates the gallery model and admin-managed galleries, after which this list
 * is replaced by database rows.
 */
export const galleryCollections: readonly GalleryCollection[] = [
  {
    slug: "nightlife",
    name: "Nightlife",
    provisionalCount: 24,
    description: "Clubs, crowds and colour after midnight.",
    cover: {
      photo: "/images/dev/neon-alley.svg",
      alt: "Development placeholder for a rain-slicked alley under red neon signage.",
      ratio: "4 / 5",
    },
  },
  {
    slug: "live-music",
    name: "Live Music",
    provisionalCount: 18,
    description: "Bands, stages and the moment the lights hit.",
    cover: {
      photo: "/images/dev/stage-figure.svg",
      alt: "Development placeholder for a performer silhouetted in stage haze.",
      ratio: "4 / 5",
    },
  },
  {
    slug: "cityscapes",
    name: "Cityscapes",
    provisionalCount: 31,
    description: "Skylines, rivers and blue-hour quiet.",
    cover: {
      photo: "/images/dev/blue-hour.svg",
      alt: "Development placeholder for a monochrome skyline at blue hour.",
      ratio: "4 / 5",
    },
  },
  {
    slug: "cars",
    name: "Cars",
    provisionalCount: 12,
    description: "Shows, streets and long-exposure light.",
    cover: {
      photo: "/images/dev/night-traffic.svg",
      alt: "Development placeholder for amber traffic light trails at night.",
      ratio: "4 / 5",
    },
  },
  {
    slug: "people",
    name: "People",
    provisionalCount: 22,
    description: "Candid portraits and street encounters.",
    cover: {
      photo: "/images/dev/street-portrait.svg",
      alt: "Development placeholder for a candid street portrait under falling rain.",
      ratio: "4 / 5",
    },
  },
  {
    slug: "black-white",
    name: "Black & White",
    provisionalCount: 16,
    description: "Monochrome streets, shadows and structure.",
    cover: {
      photo: "/images/dev/rain-street.svg",
      alt: "Development placeholder for a monochrome street with hard shadows and wet pavement.",
      ratio: "4 / 5",
    },
  },
] as const;

/** Latest published work. Provisional composition for the latest-work area. */
export const latestWork: readonly HomepagePhoto[] = [
  {
    id: "latest-rain-street",
    photo: "/images/dev/rain-street.svg",
    alt: "Development placeholder for a monochrome street with rain-washed pavement.",
    ratio: "4 / 3",
    title: "Rain on the pavement",
    gallerySlug: "black-white",
    galleryLabel: "Black & White",
  },
  {
    id: "latest-red-glow",
    photo: "/images/dev/red-glow.svg",
    alt: "Development placeholder for a red glow spilling across a dark street.",
    ratio: "4 / 3",
    title: "Red glow intersection",
    gallerySlug: "nightlife",
    galleryLabel: "Nightlife",
  },
  {
    id: "latest-neon-alley",
    photo: "/images/dev/neon-alley.svg",
    alt: "Development placeholder for a narrow alley lit by red neon signage.",
    ratio: "4 / 3",
    title: "Signage and rain",
    gallerySlug: "nightlife",
    galleryLabel: "Nightlife",
  },
  {
    id: "latest-blue-hour",
    photo: "/images/dev/blue-hour.svg",
    alt: "Development placeholder for a monochrome blue-hour skyline.",
    ratio: "4 / 3",
    title: "Blue hour across the water",
    gallerySlug: "cityscapes",
    galleryLabel: "Cityscapes",
  },
] as const;

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
