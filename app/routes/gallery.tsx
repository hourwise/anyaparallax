import type { MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { PhotoFigure } from "../components/PhotoFigure";
import { PlaceholderNotice } from "../components/PlaceholderNotice";
import { site } from "../data/site";
import { getPublishedGallery } from "../data/queries";
import type { GalleryWithPhotos } from "../data/model";
import { galleriesPath, photoPath } from "../lib/paths";

export function loader({ params }: { params: { slug?: string } }) {
  const gallery = params.slug ? getPublishedGallery(params.slug) : null;
  if (!gallery) {
    // Unknown and unpublished galleries are indistinguishable publicly.
    throw new Response("Gallery not found", { status: 404, statusText: "Not Found" });
  }
  return { gallery };
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
  const { gallery } = useLoaderData() as { gallery: GalleryWithPhotos };
  const count = gallery.photos.length;
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

      <PlaceholderNotice>
        Development preview — photographs are placeholder assets and metadata is
        provisional seed data.
      </PlaceholderNotice>

      {count === 0 ? (
        <p className="muted">No photographs are published in this gallery yet.</p>
      ) : (
        <div className="gallery-grid">
          {gallery.photos.map((photo) => (
            <PhotoFigure
              className="gallery-grid__item"
              key={photo.id}
              src={photo.thumbnailStorageKey}
              alt={`Development placeholder for “${photo.title}”.`}
              ratio={`${photo.width} / ${photo.height}`}
              sizes="(min-width: 56.25rem) 33vw, (min-width: 34rem) 50vw, 100vw"
              titleLink={{
                to: photoPath(photo.slug),
                label: photo.title,
                title: `${photo.title} — photograph page`,
              }}
            />
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
