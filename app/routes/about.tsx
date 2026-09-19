import type { MetaFunction } from "react-router";
import { Link } from "react-router";

import { PlaceholderFrame } from "../components/PlaceholderFrame";
import { PlaceholderNotice } from "../components/PlaceholderNotice";

export const meta: MetaFunction = () => [
  { title: "About — Anyaparallax Photography" },
  {
    name: "description",
    content:
      "Placeholder introduction to Anya, the photographer behind Anyaparallax. Final copy and images are still to be approved.",
  },
];

export default function AboutRoute() {
  return (
    <section className="page container">
      <header className="page__header">
        <p className="eyebrow">About</p>
        <h1>About</h1>
      </header>

      <PlaceholderNotice>
        Provisional wording. This biography is a placeholder from the build sheet and is
        not approved final copy.
      </PlaceholderNotice>

      <div className="split">
        <div className="prose">
          <p className="lede">
            I&rsquo;m Anya — a photographer drawn to the energy of cities, live music, cars
            and the moments that happen after dark.
          </p>
          <p>
            The final biography, portrait and selected supporting photographs are supplied
            by the operator before publication. Nothing on this page is final content.
          </p>
        </div>
        <div className="split__media">
          <PlaceholderFrame label="Portrait placeholder" ratio="4 / 5" />
        </div>
      </div>

      <p className="section-actions">
        <Link className="button" to="/galleries">
          Explore galleries
        </Link>
      </p>
    </section>
  );
}
