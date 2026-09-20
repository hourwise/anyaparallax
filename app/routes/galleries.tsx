import type { MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { PlaceholderNotice } from "../components/PlaceholderNotice";
import { appEnvironmentFrom } from "../data/context.server";
import { site } from "../data/site";
import { galleryCover, listPublishedGalleries, publishedPhotoCounts } from "../data/queries";
import { developmentNoticesEnabled } from "../data/site";
import { galleryPath } from "../lib/paths";

/**
 * The page description is the production sentence, with the development wording
 * appended ONLY while development notices are enabled (REPAIR-09A).
 */
const DESCRIPTION =
  "Browse the Anyaparallax photography collections — nightlife, live music, cityscapes, cars, people and monochrome work.";
const DESCRIPTION_PREVIEW_SUFFIX = " Development preview with placeholder imagery.";

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  { title: `Galleries — ${site.name} ${site.secondary}` },
  {
    name: "description",
    content: loaderData?.showDevelopmentNotices
      ? `${DESCRIPTION}${DESCRIPTION_PREVIEW_SUFFIX}`
      : DESCRIPTION,
  },
];

export async function loader({ context }: { context: unknown }) {
  const env = appEnvironmentFrom(context);
  const galleries = await listPublishedGalleries(env);
  const counts = await publishedPhotoCounts(env);
  // Maps are not serialised across the loader boundary, so return plain arrays.
  return {
    galleries,
    counts: galleries.map((gallery) => [gallery.id, counts.get(gallery.id) ?? 0] as const),
    covers: await Promise.all(
      galleries.map(async (gallery) => [gallery.id, await galleryCover(gallery, env)] as const),
    ),
    showDevelopmentNotices: developmentNoticesEnabled(env),
  };
}

/**
 * Published galleries only. The list is driven by the public query boundary, so
 * an unpublished gallery can never appear here.
 */
export default function GalleriesRoute() {
  const { galleries, counts, covers, showDevelopmentNotices } = useLoaderData<typeof loader>();
  const countById = new Map(counts);
  const coverById = new Map(covers);

  return (
    <section className="page container">
      <header className="page__header">
        <p className="eyebrow">Galleries</p>
        <h1>Galleries</h1>
        <p className="lede">
          Collections of street, stage and night work. Photography fills the page; the
          interface stays out of the way.
        </p>
      </header>

      {showDevelopmentNotices ? (
        <PlaceholderNotice>
          Development preview — gallery names and metadata are provisional seed data, not
          approved final content.
        </PlaceholderNotice>
      ) : null}

      <ul className="collections">
        {galleries.map((gallery) => {
          const cover = coverById.get(gallery.id) ?? null;
          const count = countById.get(gallery.id) ?? 0;

          return (
            <li className="collections__item" key={gallery.id}>
              <Link
                className="collection-card"
                to={galleryPath(gallery.slug)}
                title={`${gallery.name} gallery`}
              >
                {cover && cover.thumbnailImagePath ? (
                  <span className="collection-card__media">
                    {/*
                      The cover's alternative text is the cover PHOTOGRAPH's own
                      words (REPAIR-09A): its description, or its title when it has
                      none. The generated "Development placeholder for the …
                      cover photograph." string is gone — every collection cover on
                      the site used to be announced as a placeholder.
                    */}
                    <img
                      className="collection-card__image"
                      src={cover.thumbnailImagePath}
                      alt={cover.description || cover.title}
                      loading="lazy"
                      decoding="async"
                      sizes="(min-width: 56.25rem) 33vw, (min-width: 34rem) 50vw, 100vw"
                      style={{ aspectRatio: "4 / 5" }}
                    />
                  </span>
                ) : (
                  <span className="collection-card__media collection-card__media--empty" />
                )}
                <span className="collection-card__body">
                  <span className="collection-card__title">{gallery.name}</span>
                  <span className="collection-card__meta">
                    {count === 1 ? "1 photograph" : `${count} photographs`}
                  </span>
                  <span className="collection-card__copy">{gallery.description}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="section-actions">
        <Link className="button" to="/prints">
          Print information
        </Link>
      </p>
    </section>
  );
}
