import type { MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { EngagementControls } from "../components/EngagementControls";
import { PhotoFigure } from "../components/PhotoFigure";
import { siteOriginFrom } from "../data/canonical-origin";
import { appEnvironmentFrom } from "../data/context.server";
import { site } from "../data/site";
import { getPhotoDetail, getPublishedGallery, resolveTags } from "../data/queries";
import { readEngagement } from "../engagement/engagement.server";
import { metadataTags, photoMetadataFor } from "../engagement/metadata";
import { galleriesPath, galleryPath, photoPath } from "../lib/paths";

export async function loader({
  request,
  params,
  context,
}: {
  request: Request;
  params: { slug?: string };
  context: unknown;
}) {
  const env = appEnvironmentFrom(context);
  const detail = params.slug ? await getPhotoDetail(params.slug, env) : null;
  if (!detail) {
    // Unknown and unpublished photographs are indistinguishable publicly, so
    // publication state cannot be inferred from a 404. No social metadata is
    // produced for a draft: there is no loader data to produce it from.
    throw new Response("Photograph not found", { status: 404, statusText: "Not Found" });
  }

  const photo = detail.photo;
  const gallery = await getPublishedGallery(detail.gallery.slug, env);

  // The canonical origin is CONFIGURED, never taken from the request: a `Host`
  // header must not be able to change what the site says its address is.
  const origin = siteOriginFrom(env);
  const metadata = photoMetadataFor(origin, {
    slug: photo.slug,
    title: photo.title,
    description: photo.description,
    // A PUBLIC path from the projection, not a storage key: the conversion
    // happens once, in `toPublicPhoto`, so the metadata cannot disagree with the
    // image the page renders.
    webImagePath: photo.webImagePath,
    fallbackDescription: site.description,
    siteName: `${site.name} ${site.secondary}`,
  });

  // Engagement is read for THIS browser only. The count comes from storage, and
  // when storage is unreachable it reports itself unavailable rather than
  // inventing a number.
  const view = await readEngagement({ id: photo.id, slug: photo.slug }, request, env);

  return {
    detail,
    tags: await resolveTags(photo.tags, env),
    related: gallery?.photos.filter((candidate) => candidate.id !== photo.id).slice(0, 4) ?? [],
    // Loader data carries only public facts: the count, whether this browser is
    // one of them, and safe share information. No cookie value, no digest, no
    // storage key beyond the public path already rendered.
    engagement: view.engagement,
    engagementUnavailableReason: view.availability.available ? null : view.availability.reason,
    // The document tags are built from THESE values rather than recomputed, so a
    // tag can never disagree with the data the page was rendered from.
    metadata,
    share: {
      canonical: metadata.canonical,
      title: photo.title,
      description: metadata.description,
      image: metadata.image,
    },
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) {
    return [{ title: `Photograph not found — ${site.name} ${site.secondary}` }];
  }
  return metadataTags(loaderData.metadata);
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
          {/*
            `photo.webImagePath` is a PUBLIC path produced by the projection. When
            it is null the stored reference could not safely be converted, so no
            image is rendered: an unloadable `src` would be worse than an empty
            frame, and substituting the original would be worse still.
          */}
          {photo.webImagePath ? (
            <img
              className="photo-detail__image"
              src={photo.webImagePath}
              alt={`Development placeholder for “${photo.title}”.`}
              loading="eager"
              decoding="async"
              sizes="(min-width: 75rem) 55vw, 100vw"
              width={photo.width}
              height={photo.height}
            />
          ) : (
            <span className="photo-detail__image photo-detail__image--unavailable">
              This photograph’s display image is unavailable.
            </span>
          )}
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

        <EngagementControls
          slug={photo.slug}
          engagement={data.engagement}
          availabilityReason={data.engagementUnavailableReason}
          canonicalUrl={data.share.canonical}
          shareTarget={{
            url: data.share.canonical,
            title: data.share.title,
            description: data.share.description,
            // A photograph with no public preview image passes an empty string,
            // which the Pinterest link simply omits rather than substituting a
            // private URL.
            imageUrl: data.share.image ?? "",
          }}
        />
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
            {related
              .filter(
                (item): item is typeof item & { thumbnailImagePath: string } =>
                  item.thumbnailImagePath !== null,
              )
              .map((item) => (
              <PhotoFigure
                className="latest-grid__item"
                key={item.id}
                src={item.thumbnailImagePath}
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

