/**
 * Canonical and social metadata (Slice 07) — pure and server-usable.
 *
 * One function decides what a photograph page claims about itself, so the same
 * values drive the document tags, the OpenGraph block and anything else that
 * needs them. Two rules are baked in here rather than left to a component:
 *
 *   1. THE PREVIEW IMAGE COMES FROM THE PUBLIC MEDIA BOUNDARY. The caller passes
 *      the stored derivative key, and it is converted with `publicRefUrl`, which
 *      returns a path ONLY for an `r2://images/` key. A private master key yields
 *      null, and when that happens the preview image is OMITTED rather than
 *      falling back to the private object. A social card must never be able to
 *      name a print-quality original.
 *
 *   2. THE CANONICAL URL COMES FROM THE CONFIGURED ORIGIN, never from the
 *      request. A `Host` header must not be able to redefine what the site says
 *      its canonical address is, or a draft on a preview host could be published
 *      as a canonical page.
 */
import type { MetaDescriptor } from "react-router";

import { canonicalUrl } from "../data/canonical-origin";
import { publicRefUrl } from "../data/storage";
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

/** What the metadata needs to know about a photograph. */
export type PhotoMetadataInput = {
  readonly slug: string;
  readonly title: string;
  /** The photograph's own description, or an empty string. */
  readonly description: string;
  /**
   * The stored public derivative reference. Accepts either a storage key
   * (`r2://images/...`, the shape production rows hold) or a site-relative
   * public path (the shape the development seed set holds, `/images/dev/...`).
   * A private reference is refused rather than converted.
   */
  readonly webStorageKey: string;
  /** Site description, used when the photograph has none of its own. */
  readonly fallbackDescription: string;
  /** Site name, appended to the document title. */
  readonly siteName: string;
};

/**
 * The PUBLIC, site-relative path for a stored derivative reference, or null.
 *
 * Two reference shapes reach this function and both are legitimate:
 *
 *   `r2://images/web/<id>/web.webp`  a production row, converted through the
 *                                    public media boundary (`/media/...`)
 *   `/images/dev/<name>.svg`         a development seed photograph, which is
 *                                    already a public site path
 *
 * Anything else yields null, and a null preview image is OMITTED rather than
 * substituted. That matters most for the private shapes: `r2://masters/...` and
 * a path under `/originals/` are refused here, so a social card can never be
 * built from a print-quality master. The check for the private prefix is
 * deliberately explicit rather than relying on "it did not match the public
 * rules", because a leak is the failure that would escape the site entirely.
 */
export function publicPreviewPath(storedRef: string): string | null {
  const publicPath = publicRefUrl(storedRef);
  if (publicPath !== null) {
    return publicPath;
  }
  if (/^r2:/i.test(storedRef)) {
    // A storage reference that is not a public image: a private master, or an
    // unknown domain. Never converted.
    return null;
  }
  if (!storedRef.startsWith("/") || storedRef.startsWith("//")) {
    return null;
  }
  if (storedRef.toLowerCase().includes("masters") || storedRef.toLowerCase().includes("originals")) {
    return null;
  }
  return storedRef;
}

/**
 * Build the page's metadata.
 *
 * `image` is null when no public preview may be published. Callers must treat
 * null as "publish no preview image", never as "use the original".
 */
export function photoMetadataFor(origin: string, input: PhotoMetadataInput): PhotoMetadata {
  const publicPath = publicPreviewPath(input.webStorageKey);
  return {
    title: `${input.title} — ${input.siteName}`,
    // A photograph with no description of its own still needs one for a social
    // card, and the site description is the honest thing to use.
    description: input.description.trim().length > 0 ? input.description : input.fallbackDescription,
    canonical: canonicalUrl(origin, photoPath(input.slug)),
    image: publicPath === null ? null : canonicalUrl(origin, publicPath),
    type: "article",
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
 * is honest, whereas a card pointing at a private object would be a leak.
 */
export function metadataTags(metadata: PhotoMetadata): MetaDescriptor[] {
  const tags: MetaDescriptor[] = [
    { title: metadata.title },
    { name: "description", content: metadata.description },
    { tagName: "link", rel: "canonical", href: metadata.canonical },
    { property: "og:type", content: metadata.type },
    { property: "og:title", content: metadata.title },
    { property: "og:description", content: metadata.description },
    { property: "og:url", content: metadata.canonical },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: metadata.title },
    { name: "twitter:description", content: metadata.description },
  ];
  if (metadata.image !== null) {
    tags.push({ property: "og:image", content: metadata.image });
    tags.push({ name: "twitter:image", content: metadata.image });
  }
  return tags;
}
