/**
 * Canonical and social metadata (Slice 07; static pages added in Slice 08) — pure
 * and server-usable.
 *
 * One module decides what a page claims about itself, so the same values drive the
 * document tags, the OpenGraph block and anything else that needs them. A
 * photograph page and an ordinary content page therefore cannot drift into two
 * metadata systems: they differ only in the OpenGraph type and in whether a public
 * preview image exists.
 *
 * Two rules are baked in here rather than left to a component:
 *
 *   1. THE PREVIEW IMAGE CAN ONLY BE A PUBLIC PATH. The caller passes
 *      `PublicPhoto.webImagePath` — already converted at the public projection by
 *      `publicImagePathFrom()`, which refuses a private master, an unknown storage
 *      domain and an `originals/` path. This module never sees a storage key at
 *      all, so it has no way to reach one; a null means no public preview exists,
 *      and the image tags are then OMITTED rather than substituted. A social card
 *      must never be able to name a print-quality original.
 *
 *   2. THE CANONICAL URL COMES FROM THE CONFIGURED ORIGIN, never from the
 *      request. A `Host` header must not be able to redefine what the site says
 *      its canonical address is, or a draft on a preview host could be published
 *      as a canonical page.
 */
import type { MetaDescriptor } from "react-router";

import { canonicalUrl } from "../data/canonical-origin";
import { photoPath } from "../lib/paths";

/** The document and social metadata for one photograph page. */
export type PhotoMetadata = {
  readonly title: string;
  readonly description: string;
  /** Absolute canonical URL of the photograph page. */
  readonly canonical: string;
  /** Absolute PUBLIC preview image URL, or null when none may be published. */
  readonly image: string | null;
  /** OpenGraph object type for a photograph. */
  readonly type: "article";
};

/**
 * The document and social metadata for an ordinary content page (Slice 08).
 *
 * Deliberately the SAME shape and the SAME tag builder as a photograph page, so
 * `/prints`, `/contact` and `/about` cannot drift into a second metadata system:
 * only the OpenGraph type differs, and `image` is null because a static page has
 * no single public preview derivative of its own. A page that has one may pass it
 * and gets the large-image card.
 */
export type PageMetadata = {
  readonly title: string;
  readonly description: string;
  readonly canonical: string;
  readonly image: string | null;
  readonly type: "article" | "website";
};

/** What a static page's metadata needs to know. */
export type PageMetadataInput = {
  /** Site-relative path, e.g. `/prints`. */
  readonly path: string;
  readonly title: string;
  readonly description: string;
  /** Site name, appended to the document title. */
  readonly siteName: string;
  /**
   * An absolute PUBLIC preview image URL already resolved against the canonical
   * origin, or null. Never a storage key: the conversion happens at the public
   * projection, not here, so this module still has no way to reach a master.
   */
  readonly image?: string | null;
};

/** What the metadata needs to know about a photograph. */
export type PhotoMetadataInput = {
  readonly slug: string;
  readonly title: string;
  /** The photograph's own description, or an empty string. */
  readonly description: string;
  /**
   * The photograph's browser-facing PUBLIC image path, as produced by the public
   * projection (`PublicPhoto.webImagePath`). This is a PATH, not a storage key:
   * the conversion from a stored reference happens once, in the projection, so
   * there is a single definition of how a derivative becomes a URL. A null here
   * means the projection refused the reference, and the preview image is then
   * omitted.
   */
  readonly webImagePath: string | null;
  /** Site description, used when the photograph has none of its own. */
  readonly fallbackDescription: string;
  /** Site name, appended to the document title. */
  readonly siteName: string;
};

/**
 * Build the page's metadata.
 *
 * `image` is null when the projection could not produce a public preview path.
 * Callers must treat null as "publish no preview image", never as "use the
 * original".
 */
export function photoMetadataFor(origin: string, input: PhotoMetadataInput): PhotoMetadata {
  return {
    title: `${input.title} — ${input.siteName}`,
    // A photograph with no description of its own still needs one for a social
    // card, and the site description is the honest thing to use.
    description: input.description.trim().length > 0 ? input.description : input.fallbackDescription,
    canonical: canonicalUrl(origin, photoPath(input.slug)),
    image: input.webImagePath === null ? null : canonicalUrl(origin, input.webImagePath),
    type: "article",
  };
}

/**
 * Build a static page's metadata.
 *
 * The canonical URL is built from the CONFIGURED origin exactly as a photograph's
 * is, so a request's `Host` header cannot redefine what `/prints` says its
 * address is. A page with no public preview image passes none, and the image tags
 * are then omitted rather than pointed at something unrelated.
 */
export function pageMetadataFor(origin: string, input: PageMetadataInput): PageMetadata {
  return {
    title: `${input.title} — ${input.siteName}`,
    description: input.description,
    canonical: canonicalUrl(origin, input.path),
    image: input.image ?? null,
    type: "website",
  };
}

/**
 * The metadata as document tags.
 *
 * Typed as React Router's own descriptor list so a route can return it directly
 * without a cast, and so the shape cannot silently drift from what the framework
 * accepts.
 *
 * `og:image` and `twitter:image` are emitted only when a public preview image
 * exists. Omitting a tag is the correct behaviour here: a card without an image
 * is honest, whereas a card pointing at a private object would be a leak. The
 * Twitter card type follows the same rule — the large-image card is claimed only
 * when there is an image to fill it, so a page is never described as something it
 * is not.
 */
export function metadataTags(metadata: PageMetadata): MetaDescriptor[] {
  const tags: MetaDescriptor[] = [
    { title: metadata.title },
    { name: "description", content: metadata.description },
    { tagName: "link", rel: "canonical", href: metadata.canonical },
    { property: "og:type", content: metadata.type },
    { property: "og:title", content: metadata.title },
    { property: "og:description", content: metadata.description },
    { property: "og:url", content: metadata.canonical },
    {
      name: "twitter:card",
      content: metadata.image === null ? "summary" : "summary_large_image",
    },
    { name: "twitter:title", content: metadata.title },
    { name: "twitter:description", content: metadata.description },
  ];
  if (metadata.image !== null) {
    tags.push({ property: "og:image", content: metadata.image });
    tags.push({ name: "twitter:image", content: metadata.image });
  }
  return tags;
}
