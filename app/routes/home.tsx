import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import {
  AboutPreviewSection,
  ExploreGalleriesSection,
  FeaturedWorkSection,
  HeroSection,
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
  publishedPhotoCounts,
} from "../data/queries";
import { developmentNoticesEnabled } from "../data/site";
import { readPublicSiteSettings } from "../data/site-settings.server";

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

  const settings = await readPublicSiteSettings(env);
  return {
    featured: (await listFeaturedWithGallery(5, env)).map(toPhotoCard),
    galleries,
    settings,
    showDevelopmentNotices: developmentNoticesEnabled(env),
  };
}

export default function HomeRoute() {
  const { featured, galleries, settings, showDevelopmentNotices } = useLoaderData<
    typeof loader
  >();

  return (
    <>
      <HeroSection hero={{ ...hero, headline: [settings.strapline], supporting: `${settings.publicRole} · ${settings.location}` }} showDevelopmentNotices={showDevelopmentNotices} />
      <FeaturedWorkSection photos={featured} />
      <ExploreGalleriesSection galleries={galleries} showDevelopmentNotices={showDevelopmentNotices} />
      <AboutPreviewSection name="Anya" role={settings.publicRole} location={settings.location} photo={settings.aboutPhotoPath} photoAlt={settings.aboutPhotoAlt} />
    </>
  );
}
