/**
 * `/robots.txt` (REPAIR-09D; the `/media/` policy corrected in the crawlability
 * follow-up, because a published derivative a crawler may not fetch is a published
 * photograph nobody can find).
 *
 * A resource route outside every layout: it returns a text document rather than an
 * HTML page, and it exports no component, so nothing here reaches the client bundle.
 *
 * The policy is stated in terms of what this application actually serves:
 *
 *   * the public site is crawlable;
 *   * the operator surfaces are not — `/admin` and `/manager` are guarded by
 *     authentication, and telling crawlers to stay out is a courtesy that keeps
 *     useless requests away, NOT a security control. Every one of those routes
 *     denies an unauthorised request on its own;
 *   * `/dev-verification` is a development-only surface and must never be indexed;
 *   * `/media/...` is deliberately NOT disallowed. Those URLs are the published
 *     photographs themselves, served only while their photograph and their gallery
 *     are both published, so a prefix-wide `Disallow` would withhold nothing the
 *     publication gate does not already withhold — while keeping the site's own
 *     images out of image search, because a crawler that may not fetch an image may
 *     not index it either. What must never come back through that prefix is a
 *     private master, and `refFromPublicUrl` refuses a non-public key before any
 *     bucket or database is read;
 *   * the acknowledgement pages are the result of a submission, are marked
 *     `noindex` and carry no content — they are excluded here as well;
 *   * `/engagement/` is POST-only and answers JSON.
 *
 * The sitemap URL is built from the CONFIGURED canonical origin, never from the
 * request, so a forged `Host` or `X-Forwarded-Host` header cannot make this file
 * advertise a different site. Nothing here is a secret: the paths listed are the same
 * paths any visitor can attempt, and no storage key, bucket or internal identifier
 * appears.
 */
import { siteOriginFrom } from "../data/canonical-origin";
import { appEnvironmentFrom } from "../data/context.server";

/**
 * The crawler policy, as one immutable list so the checks can read the same source.
 *
 * `/media/` is absent on purpose and must stay absent: it is the one prefix whose
 * URLs ARE the published photographs. Keeping a draft, a withdrawn image or a
 * private master away from a visitor is the job of `serveMedia`'s publication gate,
 * which answers every request it cannot prove is published with the same bare 404.
 * A `Disallow` line here would add no protection to that and would suppress the
 * images the site exists to show.
 */
export const ROBOTS_DISALLOW: readonly string[] = [
  "/admin",
  "/manager",
  "/dev-verification",
  "/engagement/",
  "/contact/received",
  "/prints/enquire/received",
];

/** The file's text, given the canonical origin. */
export function robotsText(origin: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    ...ROBOTS_DISALLOW.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

export async function loader({ context }: { context: unknown }): Promise<Response> {
  const origin = siteOriginFrom(appEnvironmentFrom(context));
  return new Response(robotsText(origin), {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Always revalidated, so a change to this policy is visible on the next request.
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
