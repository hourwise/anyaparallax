/**
 * `/robots.txt` (REPAIR-09D).
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
 *   * `/media/` serves image bytes rather than pages, so crawling it wastes budget
 *     and reveals nothing worth indexing;
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

/** The crawler policy, as one immutable list so the checks can read the same source. */
export const ROBOTS_DISALLOW: readonly string[] = [
  "/admin",
  "/manager",
  "/dev-verification",
  "/engagement/",
  "/media/",
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
