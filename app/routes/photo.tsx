import type { MetaFunction } from "react-router";
import { Link, useParams } from "react-router";

import { PlaceholderFrame } from "../components/PlaceholderFrame";
import { PlaceholderNotice } from "../components/PlaceholderNotice";

export const meta: MetaFunction = () => [
  { title: "Photograph — Anyaparallax Photography" },
  {
    name: "description",
    content:
      "Placeholder photograph page for the Anyaparallax development preview. Photograph data arrives in a later slice.",
  },
];

export default function PhotoRoute() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <section className="page container">
      <header className="page__header">
        <p className="eyebrow">Photograph</p>
        <h1>{slug ? `Photograph: ${slug}` : "Photograph"}</h1>
        <p className="lede">
          Placeholder page for a single photograph's permanent public URL.
        </p>
      </header>

      <PlaceholderNotice>
        Provisional. Title, description, gallery, tags, location, capture date, likes,
        sharing and print enquiry state arrive in later slices (03, 07 and 08).
      </PlaceholderNotice>

      <PlaceholderFrame label="Full photograph placeholder" ratio="3 / 2" />

      <p className="section-actions">
        <Link className="button" to="/galleries">
          Back to galleries
        </Link>
      </p>
    </section>
  );
}
