import { Link } from "react-router";

import { PhotoFigure } from "./PhotoFigure";
import { PlaceholderNotice } from "./PlaceholderNotice";
import { aboutPreview } from "../data/home";
import type { HomepageGalleryCard, HomepagePhotoCard } from "../data/home";

/**
 * Homepage sections (slices 02-03). Presentational only: photographs and
 * galleries arrive as view objects mapped from the public query boundary, so
 * the same records back the homepage, gallery pages and photo pages.
 */

export function HeroSection({
  hero,
}: {
  hero: {
    headline: readonly string[];
    supporting: string;
    action: { label: string; to: string };
    photo: { photo: string; alt: string; ratio: string };
    note: string;
  };
}) {
  return (
    <section className="hero">
      <h1 className="visually-hidden">{hero.headline.join(" · ")}</h1>
      <div className="hero__media">
        <img
          className="hero__image"
          src={hero.photo.photo}
          alt={hero.photo.alt}
          loading="eager"
          decoding="async"
          sizes="100vw"
          style={{ aspectRatio: hero.photo.ratio }}
        />
      </div>
      <div className="hero__scrim" aria-hidden="true" />
      <div className="container hero__content">
        <p className="eyebrow hero__note">{hero.note}</p>
        <p className="hero__headline" aria-hidden="true">
          {hero.headline.map((word) => (
            <span key={word} className="hero__headline-word">
              {word}
            </span>
          ))}
        </p>
        <p className="hero__supporting">{hero.supporting}</p>
        <p className="hero__actions">
          <Link className="button button--accent" to={hero.action.to}>
            {hero.action.label}
          </Link>
        </p>
      </div>
    </section>
  );
}

export function FeaturedWorkSection({ photos }: { photos: readonly HomepagePhotoCard[] }) {
  if (photos.length === 0) {
    return null;
  }

  return (
    <section className="section container" aria-labelledby="featured-heading">
      <header className="section-header">
        <p className="eyebrow">Featured work</p>
        <h2 id="featured-heading">Selected photographs</h2>
        <p className="lede">
          A working edit, arranged editorially rather than as a uniform grid.
        </p>
      </header>

      <div className="featured-grid">
        {photos.map((photo) => (
          <div className={`featured-grid__item is-${photo.variant}`} key={photo.id}>
            <PhotoFigure
              src={photo.photo}
              alt={photo.alt}
              ratio={photo.ratio}
              featured
              sizes="(min-width: 56.25rem) 60vw, 100vw"
              titleLink={{
                to: photo.to,
                label: photo.title,
                title: `${photo.title} — photograph page`,
              }}
              galleryLink={{
                to: photo.galleryTo,
                label: photo.galleryLabel,
                title: `${photo.galleryLabel} gallery`,
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function ExploreGalleriesSection({
  galleries,
}: {
  galleries: readonly HomepageGalleryCard[];
}) {
  if (galleries.length === 0) {
    return null;
  }

  return (
    <section className="section container" aria-labelledby="galleries-heading">
      <header className="section-header">
        <p className="eyebrow">Explore galleries</p>
        <h2 id="galleries-heading">Find your way in</h2>
        <p className="lede">
          Street, stage and the hours in between — every collection is drawn from the
          published portfolio.
        </p>
      </header>

      <PlaceholderNotice>
        Provisional collections, counts and imagery. Galleries are administrator-managed
        once the storage slices land, and no name or count here is approved final content.
      </PlaceholderNotice>

      <ul className="collections">
        {galleries.map((gallery) => (
          <li className="collections__item" key={gallery.id}>
            <Link className="collection-card" to={gallery.to} title={`${gallery.name} gallery`}>
              {gallery.cover?.photo ? (
                <span className="collection-card__media">
                  <img
                    className="collection-card__image"
                    src={gallery.cover.photo}
                    alt={gallery.cover.alt}
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
                  {gallery.count === 1 ? "1 photograph" : `${gallery.count} photographs`}
                </span>
                <span className="collection-card__copy">{gallery.description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LatestWorkSection({ photos }: { photos: readonly HomepagePhotoCard[] }) {
  if (photos.length === 0) {
    return null;
  }

  return (
    <section className="section container" aria-labelledby="latest-heading">
      <header className="section-header section-header--row">
        <div>
          <p className="eyebrow">Latest</p>
          <h2 id="latest-heading">Recently added</h2>
        </div>
        <p className="section-header__action">
          <Link className="text-link" to="/galleries">
            Browse all galleries
          </Link>
        </p>
      </header>

      <div className="latest-grid">
        {photos.map((photo) => (
          <PhotoFigure
            className="latest-grid__item"
            key={photo.id}
            src={photo.photo}
            alt={photo.alt}
            ratio={photo.ratio}
            sizes="(min-width: 62rem) 25vw, (min-width: 40rem) 50vw, 100vw"
            titleLink={{
              to: photo.to,
              label: photo.title,
              title: `${photo.title} — photograph page`,
            }}
            galleryLink={{
              to: photo.galleryTo,
              label: photo.galleryLabel,
              title: `${photo.galleryLabel} gallery`,
            }}
          />
        ))}
      </div>
    </section>
  );
}

export function AboutPreviewSection() {
  return (
    <section className="section container" aria-labelledby="about-heading">
      <div className="split split--about">
        <div className="split__copy">
          <p className="eyebrow">About</p>
          <h2 id="about-heading">{aboutPreview.title}</h2>
          <p className="lede">{aboutPreview.body}</p>
          <p>
            <Link className="text-link" to={aboutPreview.to}>
              {aboutPreview.linkLabel}
            </Link>
          </p>
        </div>
        <div className="split__media split__media--portrait">
          <PhotoFigure
            src={aboutPreview.photo.photo}
            alt={aboutPreview.photo.alt}
            ratio={aboutPreview.photo.ratio}
            sizes="(min-width: 56.25rem) 30vw, 100vw"
          />
        </div>
      </div>
    </section>
  );
}
