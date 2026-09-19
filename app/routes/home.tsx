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
  toGalleryCard,
  toPhotoCard,
} from "../data/home";
import { appEnvironmentFrom } from "../data/context.server";
import {
  galleryCover,
  listFeaturedWithGallery,
  listPublishedGalleries,
  listRecentWithGallery,
  publishedPhotoCounts,
} from "../data/queries";

export const meta: MetaFunction = () => [
  { title: homepageMeta.title },
  { name: "description", content: homepageMeta.description },
];

/**
 * Slice 02/03 homepage: image-first, editorial and restrained. Photography,
 * featured work and collections are loaded through the public query boundary
 * (D1, or the development seed when no binding is present), so unpublished work
 * can never reach this page. Page copy remains provisional.
 */
export async function loader({ context }: { context: unknown }) {
  const env = appEnvironmentFrom(context);
  const counts = await publishedPhotoCounts(env);
  const galleries = await Promise.all(
    (await listPublishedGalleries(env)).map(async (gallery) =>
      toGalleryCard(gallery, counts.get(gallery.id) ?? 0, await galleryCover(gallery, env)),
    ),
  );

  return {
    featured: (await listFeaturedWithGallery(5, env)).map(toPhotoCard),
    latest: (await listRecentWithGallery(4, env)).map(toPhotoCard),
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
