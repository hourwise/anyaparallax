import type { MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { PhotoFigure } from "../components/PhotoFigure";
import { PlaceholderNotice } from "../components/PlaceholderNotice";
import { site, developmentNoticesEnabled } from "../data/site";
import { getPublishedGallery } from "../data/queries";
import { appEnvironmentFrom } from "../data/context.server";
import { groupGalleryPhotos } from "../data/gallery-series";
import { galleriesPath, photoPath } from "../lib/paths";

export async function loader({ context, params }: { context: unknown; params: { slug?: string } }) {
  const env = appEnvironmentFrom(context);
  const gallery = params.slug ? await getPublishedGallery(params.slug, env) : null;
  if (!gallery) {
    // Unknown and unpublished galleries are indistinguishable publicly.
    throw new Response("Gallery not found", { status: 404, statusText: "Not Found" });
  }
  return { gallery, showDevelopmentNotices: developmentNoticesEnabled(env) };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const gallery = loaderData?.gallery;
  if (!gallery) {
    return [{ title: `Gallery not found — ${site.name} ${site.secondary}` }];
  }
  return [
    { title: `${gallery.name} — ${site.name} ${site.secondary}` },
    { name: "description", content: gallery.description },
  ];
};

/**
 * Gallery detail. Published member photographs only, presented as an editorial
 * column grid that lets portrait and landscape work keep their own proportions.
 */
export default function GalleryRoute() {
  const { gallery, showDevelopmentNotices } = useLoaderData<typeof loader>();
  const count = gallery.photos.length;
  const visiblePhotos = gallery.photos.filter(
    (photo): photo is typeof photo & { thumbnailImagePath: string } => photo.thumbnailImagePath !== null,
  );
  const groups = groupGalleryPhotos(gallery.series, visiblePhotos);
  return (
    <section className="page container">
      <header className="page__header">
        <p className="eyebrow">
          <Link to={galleriesPath}>Galleries</Link>
        </p>
        <h1>{gallery.name}</h1>
        <p className="lede">{gallery.description}</p>
        <p className="gallery-meta">
          {count === 1 ? "1 photograph" : `${count} photographs`}
        </p>
      </header>

      {showDevelopmentNotices ? (
        <PlaceholderNotice>
          Development preview — photographs are placeholder assets and metadata is
          provisional seed data.
        </PlaceholderNotice>
      ) : null}

      {count === 0 ? (
        <p className="muted">No photographs are published in this gallery yet.</p>
      ) : (
        <div className="gallery-series-list">
          {groups.map((group) => (
            <section key={group.id} className="gallery-series" aria-labelledby={group.title ? `series-${group.id}` : undefined}>
              {group.title ? <h2 id={`series-${group.id}`} className="gallery-series__heading">{group.title}</h2> : null}
              <div className="gallery-grid">
                {group.photos.map((photo) => (
                  <PhotoFigure
                    className="gallery-grid__item"
                    key={photo.id}
                    src={photo.thumbnailImagePath}
                    alt={photo.description || photo.title}
                    ratio={`${photo.width} / ${photo.height}`}
                    sizes="(min-width: 56.25rem) 33vw, (min-width: 34rem) 50vw, 100vw"
                    mediaLink={{ to: photoPath(photo.slug), label: `View ${photo.title}`, title: `${photo.title} — photograph page` }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="section-actions">
        <Link className="button" to={galleriesPath}>
          All galleries
        </Link>
      </p>
    </section>
  );
}
