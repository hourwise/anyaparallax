/**
 * Development seed data for the Slice 03 portfolio model.
 *
 * IMPORTANT — this is NOT final content and NOT a database. It exists so the
 * public gallery and photo pages, the visibility rules and the homepage data
 * boundary can be built and verified before Slice 04 introduces D1 migrations.
 * Slice 04 replaces this module with the same query functions reading D1 rows;
 * the types in `app/data/model.ts` are already written for that mapping.
 *
 * Deliberate characteristics:
 * - Gallery names follow the build sheet's provisional example list (Nightlife,
 *   Live Music, Cityscapes, Cars, People, Black & White).
 * - Photographs are distributed over the development placeholder SVG assets in
 *   `public/images/dev/`; they are labelled as placeholders in the UI.
 * - Two photographs and one gallery are deliberately UNPUBLISHED so the public
 *   visibility rules can be exercised and verified.
 * - Titles, descriptions, locations and dates are invented placeholder metadata.
 */
import type { GalleryRecord, PhotoOrientation, PhotoRecord, TagRecord } from "./model";

/** Development placeholder asset path. Slice 04/06 replace these with derivatives. */
function devAsset(name: string): string {
  return `/images/dev/${name}.svg`;
}

/**
 * Development stand-in for the PRIVATE archival/print master object key.
 *
 * No real bucket exists yet, so the value is a recognisable placeholder rather
 * than a servable path. This is deliberate: the value must never be reachable
 * from a public loader, and using a distinct private marker makes that a
 * testable property (`scripts/check-data-layer.mjs` asserts the marker cannot
 * appear in any public result). Slices 04/06 replace it with real R2 keys.
 */
const PRIVATE_MASTER_PREFIX = "r2-private://anyaparallax-masters/original/";

function originalMasterKey(slug: string): string {
  return `${PRIVATE_MASTER_PREFIX}${slug}`;
}

const dimensionSets: Record<PhotoOrientation, { width: number; height: number }> = {
  landscape: { width: 1080, height: 720 },
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
};

type PhotoSeed = {
  slug: string;
  title: string;
  galleryId: string;
  asset: string;
  orientation: PhotoOrientation;
  description: string;
  tags: readonly string[];
  location?: string;
  captureDate: string;
  publishedAt: string;
  featured?: boolean;
  /** Editorial grid slot used on the homepage; presentation-only. */
  featuredVariant?: string;
  published?: boolean;
  printAvailable?: boolean;
};

function toPhoto(seed: PhotoSeed): PhotoRecord {
  const { width, height } = dimensionSets[seed.orientation];
  const asset = devAsset(seed.asset);
  return {
    id: seed.slug,
    title: seed.title,
    slug: seed.slug,
    description: seed.description,
    galleryId: seed.galleryId,
    tags: seed.tags,
    location: seed.location ?? null,
    captureDate: seed.captureDate,
    width,
    height,
    orientation: seed.orientation,
    originalStorageKey: originalMasterKey(seed.slug),
    webStorageKey: asset,
    thumbnailStorageKey: asset,
    watermarkEnabled: false,
    watermarkPosition: "bottom-right",
    featured: seed.featured ?? false,
    featuredVariant: seed.featuredVariant ?? "a",
    published: seed.published ?? true,
    printAvailable: seed.printAvailable ?? false,
    createdAt: `${seed.captureDate}T12:00:00.000Z`,
    updatedAt: `${seed.publishedAt}T12:00:00.000Z`,
    publishedAt: seed.published ? `${seed.publishedAt}T20:00:00.000Z` : null,
  };
}

const gallerySeeds: readonly GalleryRecord[] = [
  {
    id: "gallery-nightlife",
    name: "Nightlife",
    slug: "nightlife",
    description:
      "Clubs, crowds and colour after midnight — the energy of the city when everything else has closed.",
    coverPhotoId: "closing-time",
    displayOrder: 1,
    published: true,
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
  },
  {
    id: "gallery-live-music",
    name: "Live Music",
    slug: "live-music",
    description:
      "Bands, stages and the moment the lights hit — gigs shot from the front row to the back of the room.",
    coverPhotoId: "stage-haze",
    displayOrder: 2,
    published: true,
    createdAt: "2026-08-01T09:05:00.000Z",
    updatedAt: "2026-08-01T09:05:00.000Z",
  },
  {
    id: "gallery-cityscapes",
    name: "Cityscapes",
    slug: "cityscapes",
    description:
      "Skylines, rivers and blue-hour quiet — the city seen from bridges, rooftops and the last train home.",
    coverPhotoId: "blue-hour-reach",
    displayOrder: 3,
    published: true,
    createdAt: "2026-08-01T09:10:00.000Z",
    updatedAt: "2026-08-01T09:10:00.000Z",
  },
  {
    id: "gallery-cars",
    name: "Cars",
    slug: "cars",
    description:
      "Shows, streets and long-exposure light — chrome, tail lights and the detail work in between.",
    coverPhotoId: "tail-lights",
    displayOrder: 4,
    published: true,
    createdAt: "2026-08-01T09:15:00.000Z",
    updatedAt: "2026-08-01T09:15:00.000Z",
  },
  {
    id: "gallery-people",
    name: "People",
    slug: "people",
    description:
      "Candid portraits and street encounters — strangers, crowds and the faces that carry the night.",
    coverPhotoId: "neon-crowd",
    displayOrder: 5,
    published: true,
    createdAt: "2026-08-01T09:20:00.000Z",
    updatedAt: "2026-08-01T09:20:00.000Z",
  },
  {
    id: "gallery-black-white",
    name: "Black & White",
    slug: "black-white",
    description:
      "Monochrome streets, shadows and structure — the city reduced to light and form.",
    coverPhotoId: "blue-hour",
    displayOrder: 6,
    published: true,
    createdAt: "2026-08-01T09:25:00.000Z",
    updatedAt: "2026-08-01T09:25:00.000Z",
  },
  {
    // Deliberately unpublished: exercises the gallery visibility rule.
    id: "gallery-studio",
    name: "Studio Work",
    slug: "studio-work",
    description: "Provisional studio work — not published.",
    // No cover configured; the gallery has no published members yet.
    coverPhotoId: null,
    displayOrder: 7,
    published: false,
    createdAt: "2026-08-01T09:30:00.000Z",
    updatedAt: "2026-08-01T09:30:00.000Z",
  },
];

const photoSeeds: readonly PhotoRecord[] = [
  // Nightlife
  toPhoto({
    slug: "neon-crowd",
    title: "Neon crowd",
    galleryId: "gallery-people",
    asset: "stage-figure",
    orientation: "portrait",
    description:
      "A crowd held in the wash of stage light, faces half-lit and half-guessed. Development placeholder.",
    tags: ["tag-club", "tag-crowd", "tag-night"],
    location: "Liverpool",
    captureDate: "2026-07-11",
    publishedAt: "2026-07-14",
    featured: true,
    featuredVariant: "b",
  }),
  toPhoto({
    slug: "night-neon-rain",
    title: "Neon in the rain",
    galleryId: "gallery-nightlife",
    asset: "neon-alley",
    orientation: "portrait",
    description:
      "Rain turning signage into colour on the pavement. Development placeholder.",
    tags: ["tag-neon", "tag-night", "tag-rain"],
    location: "Manchester",
    captureDate: "2026-07-18",
    publishedAt: "2026-07-21",
    featured: true,
    featuredVariant: "c",
  }),
  toPhoto({
    slug: "closing-time",
    title: "Closing time",
    galleryId: "gallery-nightlife",
    asset: "red-glow",
    orientation: "landscape",
    description:
      "The last few minutes of a night, picked out in red. Development placeholder.",
    tags: ["tag-club", "tag-night", "tag-red"],
    location: "Manchester",
    captureDate: "2026-08-02",
    publishedAt: "2026-08-05",
  }),
  toPhoto({
    slug: "last-train-home",
    title: "Last train home",
    galleryId: "gallery-nightlife",
    asset: "rain-street",
    orientation: "landscape",
    description: "An empty platform and the sound of rain on the canopy.",
    tags: ["tag-night", "tag-rain", "tag-street"],
    location: "Liverpool",
    captureDate: "2026-08-09",
    publishedAt: "2026-08-12",
  }),
  // Live Music
  toPhoto({
    slug: "stage-haze",
    title: "Under the stage haze",
    galleryId: "gallery-live-music",
    asset: "stage-figure",
    orientation: "portrait",
    description:
      "Stage haze and magenta light swallowing a performer mid-set. Development placeholder.",
    tags: ["tag-band", "tag-gig", "tag-stage"],
    location: "Liverpool",
    captureDate: "2026-08-14",
    publishedAt: "2026-08-16",
    featuredVariant: "d",
    featured: true,
    printAvailable: true,
  }),
  toPhoto({
    slug: "feedback-loop",
    title: "Feedback loop",
    galleryId: "gallery-live-music",
    asset: "amber-traffic",
    orientation: "landscape",
    description: "Sweat, cable loops and a wall of amps at stage left.",
    tags: ["tag-band", "tag-gig"],
    location: "Leeds",
    captureDate: "2026-08-23",
    publishedAt: "2026-08-25",
  }),
  toPhoto({
    slug: "first-three-songs",
    title: "First three songs",
    galleryId: "gallery-live-music",
    asset: "neon-alley",
    orientation: "portrait",
    description: "The window photographers get: first three songs, no flash.",
    tags: ["tag-gig", "tag-stage"],
    location: "Manchester",
    captureDate: "2026-09-03",
    publishedAt: "2026-09-05",
  }),
  toPhoto({
    slug: "setlist-floor",
    title: "Setlist on the floor",
    galleryId: "gallery-live-music",
    asset: "tunnel-evening",
    orientation: "landscape",
    description: "Taped to the floor beside a monitor, half in shadow.",
    tags: ["tag-gig", "tag-detail"],
    captureDate: "2026-09-11",
    publishedAt: "2026-09-13",
  }),
  // Cityscapes
  toPhoto({
    slug: "blue-hour-reach",
    title: "Blue hour over the reach",
    galleryId: "gallery-cityscapes",
    asset: "blue-hour",
    orientation: "landscape",
    description:
      "The fifteen minutes when the sky and the streetlights agree. Development placeholder.",
    tags: ["tag-architecture", "tag-night", "tag-river"],
    location: "Liverpool",
    captureDate: "2026-07-05",
    publishedAt: "2026-07-08",
    featuredVariant: "e",
    featured: true,
  }),
  toPhoto({
    slug: "wet-rooftops",
    title: "Wet rooftops",
    galleryId: "gallery-cityscapes",
    asset: "rain-street",
    orientation: "landscape",
    description: "Rain on flat roofs, chimney pots and a grey evening.",
    tags: ["tag-architecture", "tag-rain"],
    location: "Manchester",
    captureDate: "2026-07-28",
    publishedAt: "2026-08-01",
  }),
  toPhoto({
    slug: "tunnel-evening",
    title: "Tunnel in the evening",
    galleryId: "gallery-cityscapes",
    asset: "tunnel-evening",
    orientation: "portrait",
    description: "A pedestrian tunnel, lit end to end, empty.",
    tags: ["tag-architecture", "tag-street"],
    location: "Liverpool",
    captureDate: "2026-08-19",
    publishedAt: "2026-08-22",
  }),
  toPhoto({
    slug: "warehouse-dusk",
    title: "Warehouse dusk",
    galleryId: "gallery-cityscapes",
    asset: "amber-traffic",
    orientation: "landscape",
    description: "Brick, sodium light and the end of a working day.",
    tags: ["tag-architecture", "tag-night"],
    location: "Leeds",
    captureDate: "2026-09-07",
    publishedAt: "2026-09-09",
  }),
  // Cars
  toPhoto({
    slug: "tail-lights",
    title: "Tail lights on wet asphalt",
    galleryId: "gallery-cars",
    asset: "night-boulevard",
    orientation: "landscape",
    description:
      "Long exposure, red streaks and a boulevard that never quite empties. Development placeholder.",
    tags: ["tag-cars", "tag-night", "tag-rain"],
    location: "Manchester",
    captureDate: "2026-07-02",
    publishedAt: "2026-07-04",
    featuredVariant: "a",
    featured: true,
  }),
  toPhoto({
    slug: "chrome-and-rain",
    title: "Chrome and rain",
    galleryId: "gallery-cars",
    asset: "rain-street",
    orientation: "landscape",
    description: "A show car under a streetlight, water beading on the bonnet.",
    tags: ["tag-cars", "tag-rain"],
    location: "Liverpool",
    captureDate: "2026-08-06",
    publishedAt: "2026-08-09",
  }),
  toPhoto({
    slug: "amber-traffic",
    title: "Amber traffic, long exposure",
    galleryId: "gallery-cars",
    asset: "amber-traffic",
    orientation: "landscape",
    description: "Sodium light and movement, held open for four seconds.",
    tags: ["tag-cars", "tag-night"],
    location: "Leeds",
    captureDate: "2026-08-27",
    publishedAt: "2026-08-30",
  }),
  // People
  toPhoto({
    slug: "portrait-after-midnight",
    title: "Portrait after midnight",
    galleryId: "gallery-people",
    asset: "street-portrait",
    orientation: "portrait",
    description:
      "A stranger on a doorstep, lit by the phone in her hand. Development placeholder.",
    tags: ["tag-portrait", "tag-night", "tag-street"],
    location: "Liverpool",
    captureDate: "2026-07-22",
    publishedAt: "2026-07-25",
  }),
  toPhoto({
    slug: "crossing-in-the-rain",
    title: "Crossing in the rain",
    galleryId: "gallery-people",
    asset: "rain-street",
    orientation: "landscape",
    description: "One figure, one umbrella, one green light.",
    tags: ["tag-street", "tag-rain"],
    location: "Manchester",
    captureDate: "2026-08-15",
    publishedAt: "2026-08-18",
  }),
  toPhoto({
    slug: "waiting-on-the-platform",
    title: "Waiting on the platform",
    galleryId: "gallery-people",
    asset: "tunnel-evening",
    orientation: "landscape",
    description: "Commuters in a line, each somewhere else already.",
    tags: ["tag-street", "tag-portrait"],
    location: "Leeds",
    captureDate: "2026-09-01",
    publishedAt: "2026-09-04",
  }),
  // Black & White
  toPhoto({
    slug: "blue-hour",
    title: "Blue hour, monochrome",
    galleryId: "gallery-black-white",
    asset: "blue-hour",
    orientation: "landscape",
    description:
      "The skyline held in greys, the river holding the last light. Development placeholder.",
    tags: ["tag-black-white", "tag-architecture", "tag-river"],
    location: "Liverpool",
    captureDate: "2026-07-08",
    publishedAt: "2026-07-10",
  }),
  toPhoto({
    slug: "hard-shadow",
    title: "Hard shadow",
    galleryId: "gallery-black-white",
    asset: "rain-street",
    orientation: "landscape",
    description: "Midday sun on a wet street, the shadow doing the drawing.",
    tags: ["tag-black-white", "tag-street"],
    location: "Manchester",
    captureDate: "2026-08-11",
    publishedAt: "2026-08-14",
  }),
  toPhoto({
    slug: "mono-platform",
    title: "Mono platform",
    galleryId: "gallery-black-white",
    asset: "tunnel-evening",
    orientation: "portrait",
    description: "Platform edge, kerb line and the geometry of waiting.",
    tags: ["tag-black-white", "tag-architecture"],
    location: "Leeds",
    captureDate: "2026-08-31",
    publishedAt: "2026-09-02",
  }),
  // Deliberately unpublished: exercises the photo visibility rule.
  toPhoto({
    slug: "studio-trial",
    title: "Studio trial — not published",
    galleryId: "gallery-studio",
    asset: "street-portrait",
    orientation: "portrait",
    description: "Provisional studio test. Not approved.",
    tags: ["tag-portrait"],
    captureDate: "2026-09-14",
    publishedAt: "2026-09-15",
    published: false,
  }),
  toPhoto({
    slug: "unreleased-edit",
    title: "Unreleased edit",
    galleryId: "gallery-nightlife",
    asset: "red-glow",
    orientation: "landscape",
    description: "A second pass held back for review.",
    tags: ["tag-night", "tag-club"],
    captureDate: "2026-09-15",
    publishedAt: "2026-09-16",
    published: false,
  }),
];

const tagSeeds: readonly TagRecord[] = [
  { id: "tag-architecture", name: "Architecture", slug: "architecture" },
  { id: "tag-band", name: "Band", slug: "band" },
  { id: "tag-black-white", name: "Black & White", slug: "black-white" },
  { id: "tag-cars", name: "Cars", slug: "cars" },
  { id: "tag-club", name: "Club", slug: "club" },
  { id: "tag-crowd", name: "Crowd", slug: "crowd" },
  { id: "tag-detail", name: "Detail", slug: "detail" },
  { id: "tag-gig", name: "Gig", slug: "gig" },
  { id: "tag-neon", name: "Neon", slug: "neon" },
  { id: "tag-night", name: "Night", slug: "night" },
  { id: "tag-portrait", name: "Portrait", slug: "portrait" },
  { id: "tag-rain", name: "Rain", slug: "rain" },
  { id: "tag-red", name: "Red", slug: "red" },
  { id: "tag-river", name: "River", slug: "river" },
  { id: "tag-stage", name: "Stage", slug: "stage" },
  { id: "tag-street", name: "Street", slug: "street" },
];

/** Raw rows. Query and visibility logic lives in `app/data/queries.ts`. */
export const seed: {
  readonly galleries: readonly GalleryRecord[];
  readonly photos: readonly PhotoRecord[];
  readonly tags: readonly TagRecord[];
} = {
  galleries: gallerySeeds,
  photos: photoSeeds,
  tags: tagSeeds,
};
