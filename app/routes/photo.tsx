import type { MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { PhotoFigure } from "../components/PhotoFigure";
import { site } from "../data/site";
import { getPhotoDetail, getPublishedGallery, resolveTags } from "../data/queries";
import { absoluteUrl, galleriesPath, galleryPath, photoPath } from "../lib/paths";

export function loader({ request, params }: { request: Request; params: { slug?: string } }) {
  const detail = params.slug ? getPhotoDetail(params.slug) : null;
  if (!detail) {
    // Unknown and unpublished photographs are indistinguishable publicly, so
    // publication state cannot be inferred from a 404.
    throw new Response("Photograph not found", { status: 404, statusText: "Not Found" });
  }

  const origin = new URL(request.url).origin;
  const photo = detail.photo;
  const description = photo.description || site.description;

  return {
    detail,
    tags: resolveTags(photo.tags),
    related: getPublishedGallery(detail.gallery.slug)?.photos.filter(
      (candidate) => candidate.id !== photo.id,
    ).slice(0, 4) ?? [],
    social: {
      canonical: absoluteUrl(origin, photoPath(photo.slug)),
      image: absoluteUrl(origin, photo.webStorageKey),
      description,
    },
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) {
    return [{ title: `Photograph not found — ${site.name} ${site.secondary}` }];
  }
  const { photo } = loaderData.detail;

  return [
    { title: `${photo.title} — ${site.name} ${site.secondary}` },
    { name: "description", content: loaderData.social.description },
    { tagName: "link", rel: "canonical", href: loaderData.social.canonical },
    { property: "og:type", content: "article" },
    { property: "og:title", content: photo.title },
    { property: "og:description", content: loaderData.social.description },
    { property: "og:image", content: loaderData.social.image },
    { property: "og:url", content: loaderData.social.canonical },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: photo.title },
    { name: "twitter:description", content: loaderData.social.description },
    { name: "twitter:image", content: loaderData.social.image },
  ];
};

function displayDate(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) {
    return iso;
  }
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Photograph page: one large image, restrained metadata, gallery context and
 * previous/next navigation inside the gallery. Likes and sharing are modelled
 * in the data layer but not yet interactive; their controls arrive in Slice 07.
 */
export default function PhotoRoute() {
  const data = useLoaderData<typeof loader>();
  const { detail, tags, related } = data;
  const { photo, gallery, previous, next } = detail;
  const captureDate = displayDate(photo.captureDate);

  return (
    <section className="page container">
      <p className="eyebrow">
        <Link to={galleriesPath}>Galleries</Link>
        <span aria-hidden="true"> / </span>
        <Link to={galleryPath(gallery.slug)}>{gallery.name}</Link>
      </p>

      <figure className="photo-detail">
        <div
          className={`photo-detail__media photo-detail__media--${photo.orientation}`}
        >
          <img
            className="photo-detail__image"
            src={photo.webStorageKey}
            alt={`Development placeholder for “${photo.title}”.`}
            loading="eager"
            decoding="async"
            sizes="(min-width: 75rem) 55vw, 100vw"
            width={photo.width}
            height={photo.height}
          />
        </div>
        <figcaption className="photo-detail__caption">
          <h1>{photo.title}</h1>
          {photo.description ? <p className="lede">{photo.description}</p> : null}
        </figcaption>
      </figure>

      <div className="photo-detail__meta">
        <dl className="photo-meta">
          <div className="photo-meta__row">
            <dt>Gallery</dt>
            <dd>
              <Link to={galleryPath(gallery.slug)}>{gallery.name}</Link>
            </dd>
          </div>
          {photo.location ? (
            <div className="photo-meta__row">
              <dt>Location</dt>
              <dd>{photo.location}</dd>
            </div>
          ) : null}
          {captureDate ? (
            <div className="photo-meta__row">
              <dt>Captured</dt>
              <dd>{captureDate}</dd>
            </div>
          ) : null}
          {tags.length > 0 ? (
            <div className="photo-meta__row">
              <dt>Tags</dt>
              <dd className="tag-list">
                {tags.map((tag) => (
                  <span className="tag" key={tag.slug}>
                    {tag.name}
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="photo-actions" aria-label="Photograph interactions">
          <button type="button" className="button" disabled aria-disabled="true">
            Like
          </button>
          <button type="button" className="button" disabled aria-disabled="true">
            Share
          </button>
          <p className="photo-actions__note">
            Likes and sharing arrive in a later slice. Nothing is recorded yet.
          </p>
        </div>
      </div>

      <nav className="photo-nav" aria-label="Photograph navigation">
        {previous ? (
          <Link className="photo-nav__link photo-nav__link--previous" to={photoPath(previous.slug)}>
            <span className="photo-nav__direction">Previous</span>
            <span className="photo-nav__title">{previous.title}</span>
          </Link>
        ) : (
          <span className="photo-nav__link photo-nav__link--empty" aria-hidden="true" />
        )}
        {next ? (
          <Link className="photo-nav__link photo-nav__link--next" to={photoPath(next.slug)}>
            <span className="photo-nav__direction">Next</span>
            <span className="photo-nav__title">{next.title}</span>
          </Link>
        ) : (
          <span className="photo-nav__link photo-nav__link--empty" aria-hidden="true" />
        )}
      </nav>

      {related.length > 0 ? (
        <section className="section" aria-labelledby="more-heading">
          <header className="section-header section-header--row">
            <div>
              <p className="eyebrow">More from this collection</p>
              <h2 id="more-heading">{gallery.name}</h2>
            </div>
            <p className="section-header__action">
              <Link className="text-link" to={galleryPath(gallery.slug)}>
                View the gallery
              </Link>
            </p>
          </header>
          <div className="latest-grid">
            {related.map((item) => (
              <PhotoFigure
                className="latest-grid__item"
                key={item.id}
                src={item.thumbnailStorageKey}
                alt={`Development placeholder for “${item.title}”.`}
                ratio={`${item.width} / ${item.height}`}
                sizes="(min-width: 62rem) 25vw, (min-width: 40rem) 50vw, 100vw"
                titleLink={{
                  to: photoPath(item.slug),
                  label: item.title,
                  title: `${item.title} — photograph page`,
                }}
              />
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

