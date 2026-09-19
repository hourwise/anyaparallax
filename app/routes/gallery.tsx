import type { MetaFunction } from "react-router";
import { Link, useParams } from "react-router";

import { PlaceholderFrame } from "../components/PlaceholderFrame";
import { PlaceholderNotice } from "../components/PlaceholderNotice";

export const meta: MetaFunction = () => [
  { title: "Gallery — Anyaparallax Photography" },
  {
    name: "description",
    content:
      "Placeholder gallery page for the Anyaparallax development preview. Photograph data arrives in a later slice.",
  },
];

export default function GalleryRoute() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <section className="page container">
      <header className="page__header">
        <p className="eyebrow">Gallery</p>
        <h1>{slug ? `Gallery: ${slug}` : "Gallery"}</h1>
        <p className="lede">
          Placeholder collection page. Photographs, ordering, covers and metadata arrive
          in Slice 03.
        </p>
      </header>

      <PlaceholderNotice>
        Provisional. Nothing is loaded from a database, and unpublished work cannot be
        exposed here because no data source exists yet.
      </PlaceholderNotice>

      <div className="placeholder-grid">
        <PlaceholderFrame label="Photograph slot" ratio="3 / 2" />
        <PlaceholderFrame label="Photograph slot" ratio="2 / 3" />
        <PlaceholderFrame label="Photograph slot" ratio="3 / 2" />
      </div>

      <p className="section-actions">
        <Link className="button" to="/galleries">
          Back to galleries
        </Link>
      </p>
    </section>
  );
}
