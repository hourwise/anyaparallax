import { Link } from "react-router";

import { PhotoFigure } from "./PhotoFigure";
import { PlaceholderNotice } from "./PlaceholderNotice";
import {
  aboutPreview,
  featuredWork,
  galleryCollections,
  latestWork,
} from "../data/home";

/**
 * Homepage sections for Slice 02. Composition only: all content comes from the
 * provisional data module, which the Slice 03 gallery/photo model replaces.
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

export function FeaturedWorkSection() {
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
        {featuredWork.map((photo) => (
          <div className={`featured-grid__item is-${photo.variant}`} key={photo.id}>
            <PhotoFigure
              src={photo.photo}
              alt={photo.alt}
              ratio={photo.ratio}
              featured
              sizes="(min-width: 56.25rem) 60vw, 100vw"
              titleLink={{
                to: `/photo/${photo.id}`,
                label: photo.title,
                title: `${photo.title} (placeholder photograph page)`,
              }}
              galleryLink={{
                to: `/gallery/${photo.gallerySlug}`,
                label: photo.galleryLabel,
                title: `${photo.galleryLabel} gallery (placeholder)`,
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function ExploreGalleriesSection() {
  return (
    <section className="section container" aria-labelledby="galleries-heading">
      <header className="section-header">
        <p className="eyebrow">Explore galleries</p>
        <h2 id="galleries-heading">Find your way in</h2>
        <p className="lede">
          Six provisional collections — street, stage and the hours in between.
        </p>
      </header>

      <PlaceholderNotice>
        Provisional collections and image counts. Galleries become database-driven and
        administrator-managed in Slice 03, so nothing here is approved final structure.
      </PlaceholderNotice>

      <ul className="collections">
        {galleryCollections.map((gallery) => (
          <li className="collections__item" key={gallery.slug}>
            <Link
              className="collection-card"
              to={`/gallery/${gallery.slug}`}
              title={`${gallery.name} gallery (placeholder)`}
            >
              <span className="collection-card__media">
                <img
                  className="collection-card__image"
                  src={gallery.cover.photo}
                  alt={gallery.cover.alt}
                  loading="lazy"
                  decoding="async"
                  sizes="(min-width: 56.25rem) 33vw, (min-width: 34rem) 50vw, 100vw"
                  style={{ aspectRatio: gallery.cover.ratio }}
                />
              </span>
              <span className="collection-card__body">
                <span className="collection-card__title">{gallery.name}</span>
                <span className="collection-card__meta">
                  {gallery.provisionalCount} provisional images
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

export function LatestWorkSection() {
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
        {latestWork.map((photo) => (
          <PhotoFigure
            className="latest-grid__item"
            key={photo.id}
            src={photo.photo}
            alt={photo.alt}
            ratio={photo.ratio}
            sizes="(min-width: 62rem) 25vw, (min-width: 40rem) 50vw, 100vw"
            titleLink={{
              to: `/photo/${photo.id}`,
              label: photo.title,
              title: `${photo.title} (placeholder photograph page)`,
            }}
            galleryLink={{
              to: `/gallery/${photo.gallerySlug}`,
              label: photo.galleryLabel,
              title: `${photo.galleryLabel} gallery (placeholder)`,
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
