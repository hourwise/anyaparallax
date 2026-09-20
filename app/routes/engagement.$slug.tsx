/**
 * Engagement endpoint (Slice 07) — `POST /engagement/:slug`.
 *
 * A resource route: registered outside every layout, it returns JSON and exports
 * no component. It is public (likes need no account) but mutating, so it is
 * deliberately narrow:
 *
 *   * POST only — a `GET` cannot change state, and is answered as such;
 *   * same-origin only, via `isSameOriginRequest`, which refuses a request that
 *     carries neither an `Origin` nor a `Referer` because this endpoint is only
 *     ever called by its own page;
 *   * the photograph is resolved through the PUBLISHED-photo query boundary, and
 *     the store re-checks publication before writing, so an unpublished
 *     photograph and an unknown slug are the same bare 404;
 *   * the request body may only name an ACTION and, for a share, a CHANNEL from
 *     the server-side allow-list. A count, a browser identifier or a photo id
 *     from the client is ignored — there is no code path that reads one;
 *   * every failure is a bare status. A database error is never echoed, so
 *     nothing about the schema or a storage key can reach the caller.
 */
import { appEnvironmentFrom } from "../data/context.server";
import { getPublishedPhoto } from "../data/queries";
import { isSecureRequestUrl } from "../engagement/anonymous-browser.server";
import { likePhoto, recordShare, unlikePhoto } from "../engagement/engagement.server";
import { isSameOriginRequest } from "../engagement/share";
import { checkRequestSize } from "../lib/request-bound";

/**
 * The largest body this endpoint will parse (REPAIR-09D).
 *
 * The endpoint's whole vocabulary is a short action name and, for a share, one
 * channel from a fixed list — under a hundred bytes. 1 KiB is far above anything the
 * page sends and far below anything worth buffering, and it is checked from the
 * request HEADERS before `request.formData()` runs.
 */
const MAX_ENGAGEMENT_REQUEST_BYTES = 1024;

/** JSON with the caching and indexing rules an operator endpoint needs. */
function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      ...headers,
    },
  });
}

/** A bare 404: no body, and no hint about which rule refused the request. */
function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

/** 405 with the allowed method, so a wrong verb is not confused with a refusal. */
function methodNotAllowed(): Response {
  return new Response(null, {
    status: 405,
    headers: {
      allow: "POST",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

export async function loader(): Promise<Response> {
  // A read of this endpoint never changes anything, so it is not offered.
  return methodNotAllowed();
}

export async function action({
  request,
  params,
  context,
}: {
  request: Request;
  params: { slug?: string };
  context: unknown;
}): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed();
  }
  if (!isSameOriginRequest(request)) {
    // Cross-origin, or originating from somewhere this application cannot name.
    return json({ error: "cross-origin" }, 403);
  }
  // REPAIR-09D: the body is bounded from its headers before it is parsed. The other
  // controls on this endpoint are unchanged — same-origin, POST-only, an allow-listed
  // action and channel, and an existing UNIQUE (photo_id, browser_token) constraint
  // behind likes — so this adds a ceiling rather than a new identity mechanism.
  if (!checkRequestSize(request, MAX_ENGAGEMENT_REQUEST_BYTES).ok) {
    return json({ error: "malformed" }, 400);
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return json({ error: "malformed" }, 400);
  }
  const action = String(form.get("action") ?? "");

  const env = appEnvironmentFrom(context);
  // Resolved through the PUBLIC query boundary: a draft and an unknown slug are
  // the same absence here, exactly as they are on the photograph page.
  const photo = params.slug ? await getPublishedPhoto(params.slug, env) : null;
  if (!photo) {
    return notFound();
  }
  const target = { id: photo.id, slug: photo.slug };

  switch (action) {
    case "like":
    case "unlike": {
      const outcome =
        action === "like"
          ? await likePhoto(target, request, env, isSecureRequestUrl(request.url))
          : await unlikePhoto(target, request, env, isSecureRequestUrl(request.url));
      switch (outcome.status) {
        case "ok": {
          const headers: Record<string, string> = {};
          if (outcome.setCookie !== null) {
            headers["set-cookie"] = outcome.setCookie;
          }
          // Only the two public facts cross the wire: how many likes there are,
          // and whether THIS browser is one of them.
          return json(
            {
              likeCount: outcome.result.likeCount,
              likedByThisBrowser: outcome.result.likedByThisBrowser,
            },
            200,
            headers,
          );
        }
        case "not-found":
          return notFound();
        case "unavailable":
          // Fail closed and say so: no fabricated count, no optimistic state.
          return json({ error: "engagement-unavailable" }, 503);
        case "bad-request":
          return json({ error: "malformed" }, 400);
      }
      return json({ error: "malformed" }, 400);
    }
    case "share": {
      const outcome = await recordShare(target, form.get("channel"), env);
      if (outcome.status === "bad-request") {
        // The allow-list refused it: an arbitrary channel string is a bad request.
        return json({ error: "unsupported-channel" }, 400);
      }
      if (outcome.status === "not-found") {
        return notFound();
      }
      if (outcome.status === "unavailable") {
        return json({ error: "engagement-unavailable" }, 503);
      }
      // The response says only that the initiation was RECORDED. It makes no
      // claim about where the content went, because the application cannot know.
      return json({ recorded: true, channel: outcome.channel });
    }
    default:
      return json({ error: "unknown-action" }, 400);
  }
}
