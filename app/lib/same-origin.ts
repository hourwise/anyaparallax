/**
 * Same-origin screening for mutating requests (REPAIR-09E) — pure.
 *
 * Moved here from `app/engagement/share.ts`, where it began as that endpoint's
 * guard. An operator route importing a share-link module to obtain a CSRF check
 * states the wrong thing about both, and the check is about requests rather than
 * about sharing, so it lives beside the other request-shape helper. The behaviour
 * is unchanged, and the public callers import it from here too: there is ONE
 * definition and no second, weaker one anywhere.
 *
 * WHAT IT IS. A cheap, non-invasive CSRF guard for a mutating endpoint. It
 * compares the `Origin` header — which a browser sets and a page's script cannot
 * forge across origins — against the request's own origin, and accepts a
 * same-origin `Referer` when `Origin` is absent. A request carrying neither is
 * refused: every form this application serves is same-origin, so a missing origin
 * means the request did not come from one of its pages.
 *
 * WHAT IT IS NOT. It is not authentication, and authentication is not this. A
 * proven identity says WHO is asking; this says WHERE the request came from, and an
 * operator action needs both. Cloudflare Access in front of `/admin` and
 * `/manager` is defence in depth rather than the CSRF boundary: a browser that is
 * already authenticated to Access will send a cross-site POST with its credentials
 * attached, and this is the check that refuses it.
 *
 * It also complements, rather than replaces, `SameSite=Lax` on the browser
 * identifier cookie: the cookie stops another site's page from being recognised as
 * this browser, and this check stops the request from being accepted at all.
 */

/**
 * Is this request same-origin?
 *
 * `Origin` decides when it is present, whatever `Referer` says, because `Origin`
 * is the header a browser will not let another site set. `Referer` is consulted
 * only when `Origin` is absent, which is the case for a form post from one of this
 * site's own pages in older browsers. A malformed `Referer` or no header at all is
 * a refusal, never a benefit of the doubt.
 */
export function isSameOriginRequest(request: Request): boolean {
  let expected: string;
  try {
    expected = new URL(request.url).origin;
  } catch {
    return false;
  }
  const origin = request.headers.get("origin");
  if (origin !== null) {
    return origin === expected;
  }
  const referer = request.headers.get("referer");
  if (referer !== null) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * The refusal for a request that did not come from this site.
 *
 * THROWN by the caller, not returned as action data. An action that returns
 * normally answers 200 and renders an ordinary outcome, and a cross-site request
 * must not be answered as though something had happened — nor with a redirect that
 * implies it did. The body is one short sentence: no header values, no identity,
 * no hint about what the endpoint would have accepted, nothing that helps a
 * hostile page learn anything. The request body is never parsed on this path, so a
 * refused upload is refused before any multipart, image or storage work begins.
 */
export function refuseCrossOriginRequest(): Response {
  return new Response("Cross-origin request refused.", {
    status: 403,
    statusText: "Forbidden",
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
