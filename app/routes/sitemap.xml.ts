/**
 * `/sitemap.xml` (REPAIR-09D).
 *
 * A resource route outside every layout: it returns XML rather than a document, and
 * exports no component.
 *
 * THE PUBLICATION AUTHORITY IS THE SITE'S OWN. Every URL below comes from the public
 * query boundary — `listPublishedGalleries` and `listPublishedPhotos` — which is the
 * same projection the galleries, the photograph pages and the homepage read. Nothing
 * in this file decides visibility: a draft photograph, and a published photograph
 * sitting in an unpublished gallery, are absent because the query that feeds this
 * route does not return them. That matters more than it looks: a sitemap built from
 * its own SQL would be a second, weaker publication system, and unpublishing through
 * `/admin/photos` would stop withdrawing a photograph from search.
 *
 * `lastmod` is deliberately OMITTED. The public projection carries no modification
 * timestamp — `PublicPhoto` has slugs, geometry and description, and no date that
 * this application is willing to call authoritative for a crawler — and inventing one
 * from, say, `captured` or `published` would claim something the data does not say.
 *
 * Every URL is built from the configured canonical origin and a sanitised slug, and
 * each is XML-escaped before it is written. Private surfaces are absent by
 * construction: this route can only emit the public paths it is given.
 */
import { canonicalUrl, siteOriginFrom } from "../data/canonical-origin";
import { appEnvironmentFrom } from "../data/context.server";
import { listPublishedGalleries, listPublishedPhotos } from "../data/queries";
import { contactPath, galleriesPath, photoPath, printsPath, galleryPath } from "../lib/paths";

/**
 * The stable public pages, in the order a sitemap should present them.
 *
 * Only routes that render content for a visitor: the enquiry form is part of
 * `/prints`, the acknowledgement pages are results rather than content, and the
 * photograph-specific enquiry state lives in a query parameter that must not be
 * published as a separate URL.
 */
export const SITEMAP_STATIC_PATHS: readonly string[] = [
  "/",
  galleriesPath,
  printsPath,
  "/about",
  contactPath,
];

/** Escape the five characters XML treats specially. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** The sitemap document for a set of site-relative paths. */
export function sitemapXml(origin: string, paths: readonly string[]): string {
  const urls = paths
    .map((path) => `  <url>\n    <loc>${escapeXml(canonicalUrl(origin, path))}</loc>\n  </url>`)
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}

export async function loader({ context }: { context: unknown }): Promise<Response> {
  const env = appEnvironmentFrom(context);
  const origin = siteOriginFrom(env);

  // The public query boundary, and the only source of dynamic entries. Both calls
  // apply the publication rules the rest of the site applies.
  const [galleries, photos] = await Promise.all([
    listPublishedGalleries(env),
    listPublishedPhotos(env),
  ]);

  const paths = [
    ...SITEMAP_STATIC_PATHS,
    ...galleries.map((gallery) => galleryPath(gallery.slug)),
    ...photos.map((photo) => photoPath(photo.slug)),
  ];

  return new Response(sitemapXml(origin, paths), {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      // Revalidated on every request, so a publication change is reflected the next
      // time a crawler asks rather than whenever a cache expires.
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
