import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import {
  AboutPreviewSection,
  ExploreGalleriesSection,
  FeaturedWorkSection,
  HeroSection,
  LatestWorkSection,
} from "../components/home-sections";
import {
  hero,
  homepageMeta,
  publishedPhotoCounts,
  toGalleryCard,
  toPhotoCard,
} from "../data/home";
import {
  getPublishedGallery,
  listFeaturedWithGallery,
  listPublishedGalleries,
  listRecentWithGallery,
} from "../data/queries";

export const meta: MetaFunction = () => [
  { title: homepageMeta.title },
  { name: "description", content: homepageMeta.description },
];

/**
 * Slice 02/03 homepage: image-first, editorial and restrained. Photography,
 * featured work and collections are loaded from the public query boundary, so
 * unpublished work can never reach this page. Page copy remains provisional.
 */
export function loader() {
  const counts = publishedPhotoCounts();
  const galleries = listPublishedGalleries().map((gallery) =>
    toGalleryCard(getPublishedGallery(gallery.slug) ?? { ...gallery, photos: [] }, counts),
  );

  return {
    featured: listFeaturedWithGallery(5).map(toPhotoCard),
    latest: listRecentWithGallery(4).map(toPhotoCard),
    galleries,
  };
}

export default function HomeRoute() {
  const { featured, latest, galleries } = useLoaderData() as Awaited<
    ReturnType<typeof loader>
  >;

  return (
    <>
      <HeroSection hero={hero} />
      <FeaturedWorkSection photos={featured} />
      <ExploreGalleriesSection galleries={galleries} />
      <LatestWorkSection photos={latest} />
      <AboutPreviewSection />
    </>
  );
}
