import type { MetaFunction } from "react-router";

import {
  AboutPreviewSection,
  ExploreGalleriesSection,
  FeaturedWorkSection,
  HeroSection,
  LatestWorkSection,
} from "../components/home-sections";
import { hero, homepageMeta } from "../data/home";

export const meta: MetaFunction = () => [
  { title: homepageMeta.title },
  { name: "description", content: homepageMeta.description },
];

/**
 * Slice 02 homepage: image-first, editorial and restrained. All content is
 * provisional development material; the gallery and photograph data becomes
 * database-driven in later slices.
 */
export default function HomeRoute() {
  return (
    <>
      <HeroSection hero={hero} />
      <FeaturedWorkSection />
      <ExploreGalleriesSection />
      <LatestWorkSection />
      <AboutPreviewSection />
    </>
  );
}
