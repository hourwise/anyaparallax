import type { MetaFunction } from "react-router";
import { Link } from "react-router";

import { PlaceholderFrame } from "../components/PlaceholderFrame";
import { PlaceholderNotice } from "../components/PlaceholderNotice";
import { site } from "../data/site";

export const meta: MetaFunction = () => [
  { title: `${site.name} — ${site.secondary}` },
  { name: "description", content: site.description },
];

export default function HomeRoute() {
  return (
    <>
      <section className="hero container">
        <div className="hero__intro">
          <p className="eyebrow">Development preview</p>
          <h1 className="hero__title">
            {site.name}
            <span className="hero__title-sub">{site.secondary}</span>
          </h1>
          <p className="lede">
            Night cities, live music and the moments after dark. Final photography,
            galleries and copy are not in the repository yet, so every image slot on
            this site is a labelled placeholder.
          </p>
          <p className="hero__actions">
            <Link className="button button--accent" to="/galleries">
              Explore galleries
            </Link>
          </p>
        </div>
        <div className="hero__media">
          <PlaceholderFrame label="Hero photograph placeholder" ratio="4 / 5" />
        </div>
      </section>

      <section className="section container">
        <header className="page__header">
          <h2>What this shell already provides</h2>
        </header>
        <PlaceholderNotice>
          Slice 01 delivers the project shell, routes and visual foundation only. The
          full image-first homepage is Slice 02.
        </PlaceholderNotice>
        <ul className="plain-list">
          <li>Cloudflare Workers + React Router server rendering with Vite.</li>
          <li>Public route skeleton: home, galleries, gallery, photo, about, prints, contact.</li>
          <li>Shared header, responsive mobile navigation, footer and layout primitives.</li>
          <li>A dark, restrained photographic palette with keyboard-visible focus states.</li>
        </ul>
      </section>
    </>
  );
}
