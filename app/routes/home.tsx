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
import { developmentNoticesEnabled } from "../data/site";

/**
 * The page description is the production sentence, with the development wording
 * appended ONLY while development notices are enabled (REPAIR-09A). The suffix
 * comes from `homepageMeta`, so the two halves cannot drift apart.
 */
export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  { title: homepageMeta.title },
  {
    name: "description",
    content: loaderData?.showDevelopmentNotices
      ? `${homepageMeta.description}${homepageMeta.previewSuffix}`
      : homepageMeta.description,
  },
];

/**
 * Slice 02/03 homepage: image-first, editorial and restrained. Photography,
 * featured work and collections are loaded through the public query boundary
 * (D1, or the development seed when no binding is present), so unpublished work
 * can never reach this page.
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
    showDevelopmentNotices: developmentNoticesEnabled(env),
  };
}

export default function HomeRoute() {
  const { featured, latest, galleries, showDevelopmentNotices } = useLoaderData<
    typeof loader
  >();

  return (
    <>
      <HeroSection hero={hero} showDevelopmentNotices={showDevelopmentNotices} />
      <FeaturedWorkSection photos={featured} />
      <ExploreGalleriesSection galleries={galleries} showDevelopmentNotices={showDevelopmentNotices} />
      <LatestWorkSection photos={latest} />
      <AboutPreviewSection />
    </>
  );
}
