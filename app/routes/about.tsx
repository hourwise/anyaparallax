import type { MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { siteOriginFrom } from "../data/canonical-origin";
import { appEnvironmentFrom } from "../data/context.server";
import { listPublishedGalleries } from "../data/queries";
import { site } from "../data/site";
import { readPublicSiteSettings } from "../data/site-settings.server";
import { metadataTags, pageMetadataFor } from "../engagement/metadata";
import { contactPath, galleriesPath } from "../lib/paths";

const SITE_NAME = `${site.name} ${site.secondary}`;

/**
 * Launch About page. The approved biography and public identity are read from
 * workspace settings, while published collection names continue to come from
 * the public repository boundary. A portrait is optional: no asset means no
 * placeholder or empty media frame.
 */
export async function loader({ context }: { context: unknown }) {
  const env = appEnvironmentFrom(context);
  const origin = siteOriginFrom(env);
  const galleries = await listPublishedGalleries(env);
  const settings = await readPublicSiteSettings(env);

  return {
    galleries,
    settings,
    metadata: pageMetadataFor(origin, {
      path: "/about",
      title: "About",
      description: `${settings.publicRole} based in ${settings.location}.`,
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
  const { galleries, settings } = useLoaderData<typeof loader>();

  return (
    <section className="page container">
      <header className="page__header">
        <p className="eyebrow">About</p>
        <h1>Hi, I&rsquo;m Anya.</h1>
        <p className="lede">{settings.publicRole} · {settings.location}</p>
      </header>

      <div className="split">
        <div className="split__copy prose">
          {settings.biography.split(/\n\s*\n/).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
        {settings.aboutPhotoPath ? <div className="split__media"><img className="about-photo" src={settings.aboutPhotoPath} alt={settings.aboutPhotoAlt} /></div> : null}
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
            All photographs are copyright © anyaparallax unless otherwise stated.
          </p>
        </section>
      ) : null}

      <section className="section" aria-labelledby="about-working">
        <header className="section-header">
          <p className="eyebrow">Working together</p>
          <h2 id="about-working">Work with me</h2>
        </header>
        <div className="prose">
          <p>
            I&rsquo;m available for live music and band shoots, events, car shows and automotive photography,
            acting headshots, pet photography and other projects. If you&rsquo;ve got something in mind,
            get in touch and tell me a little about it.
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
