import type { MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { PlaceholderFrame } from "../components/PlaceholderFrame";
import { PlaceholderNotice } from "../components/PlaceholderNotice";
import { siteOriginFrom } from "../data/canonical-origin";
import { appEnvironmentFrom } from "../data/context.server";
import { listPublishedGalleries } from "../data/queries";
import { site } from "../data/site";
import { metadataTags, pageMetadataFor } from "../engagement/metadata";
import { contactPath, galleriesPath } from "../lib/paths";

const SITE_NAME = `${site.name} ${site.secondary}`;

/**
 * About (Slice 08).
 *
 * NO BIOGRAPHY IS INVENTED HERE. The operator has not supplied approved copy,
 * portrait or supporting photographs, so the page is deliberately SCAFFOLDING:
 * it states plainly that the words and images are provisional, keeps the build
 * sheet's own provisional introduction rather than writing a new one, and claims
 * nothing about Anya's history, training, awards, clients, exhibitions or
 * locations.
 *
 * The one factual, non-invented section is the list of the site's own published
 * collections, read through the public query boundary. Those names are the site's
 * data rather than a claim about a person, and they give the page a real purpose
 * until approved copy arrives.
 */
export async function loader({ context }: { context: unknown }) {
  const env = appEnvironmentFrom(context);
  const origin = siteOriginFrom(env);
  const galleries = await listPublishedGalleries(env);

  return {
    galleries,
    metadata: pageMetadataFor(origin, {
      path: "/about",
      title: "About",
      description:
        "About Anyaparallax: night cities, live music, cars and the moments after dark. " +
        "Provisional introduction and development preview — final biography and photography are " +
        "supplied by the photographer before publication.",
      siteName: SITE_NAME,
    }),
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) {
    return [{ title: `About — ${SITE_NAME}` }];
  }
  return metadataTags(loaderData.metadata);
};

export default function AboutRoute() {
  const { galleries } = useLoaderData<typeof loader>();

  return (
    <section className="page container">
      <header className="page__header">
        <p className="eyebrow">About</p>
        <h1>About</h1>
      </header>

      <PlaceholderNotice>
        Provisional wording. The biography below is the placeholder from the build sheet, not
        approved final copy, and the portrait is reserved space rather than a photograph. Nothing
        about Anya&rsquo;s history, training, clients or credentials is stated here because none has
        been supplied.
      </PlaceholderNotice>

      <div className="split">
        <div className="split__copy prose">
          <p className="lede">
            I&rsquo;m Anya — a photographer drawn to the energy of cities, live music, cars and the
            moments that happen after dark.
          </p>
          <p>
            The final biography, portrait and selected supporting photographs are supplied by the
            photographer before publication. Nothing on this page is final content.
          </p>
          <p>
            The work on this site is arranged into collections rather than a single stream, so it
            can be read the way it was photographed — a night out, a set, a skyline, a car park at
            dusk.
          </p>
        </div>
        <div className="split__media">
          <PlaceholderFrame label="Portrait placeholder" ratio="4 / 5" />
        </div>
      </div>

      {galleries.length > 0 ? (
        <section className="section" aria-labelledby="about-collections">
          <header className="section-header">
            <p className="eyebrow">Collections</p>
            <h2 id="about-collections">What is on the site</h2>
          </header>
          <ul className="plain-list">
            {galleries.map((gallery) => (
              <li key={gallery.id}>
                <Link className="text-link" to={`/gallery/${gallery.slug}`}>
                  {gallery.name}
                </Link>{" "}
                <span className="muted">— {gallery.description}</span>
              </li>
            ))}
          </ul>
          <p className="muted">
            Copyright in every photograph remains with the photographer. Nothing here may be
            reproduced without permission — ask first and the answer is usually yes.
          </p>
        </section>
      ) : null}

      <section className="section" aria-labelledby="about-working">
        <header className="section-header">
          <p className="eyebrow">Working together</p>
          <h2 id="about-working">Enquiries</h2>
        </header>
        <div className="prose">
          <p>
            Shoots, licensing and print interest all start the same way: a message describing what
            you have in mind. There is no booking system and no checkout on this site — every
            enquiry is answered personally.
          </p>
        </div>
        <p className="section-actions">
          <Link className="button button--accent" to={contactPath}>
            Send an enquiry
          </Link>
          <Link className="button" to={galleriesPath}>
            Explore galleries
          </Link>
        </p>
      </section>
    </section>
  );
}
