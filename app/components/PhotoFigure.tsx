import type { ReactNode } from "react";
import { Link } from "react-router";

export type PhotoFigureLink = {
  /** Route target, e.g. `/photo/red-glow`. */
  to: string;
  label: string;
  /** Accessible name for the link; falls back to `label`. */
  title?: string;
};

type PhotoFigureProps = {
  /** Image URL. Slice 02 points at development placeholders; later slices pass real derivatives. */
  src: string;
  /** Accessible name for the photograph. */
  alt: string;
  /** Intrinsic aspect ratio, e.g. "4 / 5". Reserved space avoids layout shift. */
  ratio: string;
  /** Caption block: either structured text/links or custom nodes. */
  caption?: ReactNode;
  /** Larger type scale for the editorial featured grid. */
  featured?: boolean;
  /** Optional gallery link rendered in the caption. */
  galleryLink?: PhotoFigureLink;
  /** Optional link from the caption title to the photograph page. */
  titleLink?: PhotoFigureLink;
  /** Lazy-load by default; the hero and other above-the-fold images load eagerly. */
  loading?: "lazy" | "eager";
  /** Responsive sizes hint; layout is governed by CSS grid. */
  sizes?: string;
  /** Optional class for grid placement. */
  className?: string;
};

/**
 * A photograph presented editorially: reserved-ratio image, optional caption and
 * optional links supplied by the caller. Composition only — data stays in
 * `app/data/home.ts` and, from Slice 03, in the database.
 */
export function PhotoFigure({
  src,
  alt,
  ratio,
  caption,
  featured = false,
  galleryLink,
  titleLink,
  loading = "lazy",
  sizes = "(min-width: 56.25rem) 33vw, 100vw",
  className,
}: PhotoFigureProps) {
  const hasCaption = Boolean(caption || galleryLink || titleLink);

  return (
    <figure className={className ? `photo-figure ${className}` : "photo-figure"}>
      <div className="photo-figure__media" style={{ aspectRatio: ratio }}>
        <img
          className="photo-figure__image"
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
          sizes={sizes}
        />
      </div>
      {hasCaption ? (
        <figcaption
          className={featured ? "photo-figure__caption is-featured" : "photo-figure__caption"}
        >
          {titleLink ? (
            <Link className="photo-figure__title-link" to={titleLink.to} title={titleLink.title}>
              {titleLink.label}
            </Link>
          ) : null}
          {caption}
          {galleryLink ? (
            <Link
              className="photo-figure__gallery-link"
              to={galleryLink.to}
              title={galleryLink.title}
            >
              {galleryLink.label}
            </Link>
          ) : null}
          <span className="photo-figure__credit">Development placeholder image</span>
        </figcaption>
      ) : (
        <p className="photo-figure__credit photo-figure__credit--outside">
          Development placeholder image
        </p>
      )}
    </figure>
  );
}

