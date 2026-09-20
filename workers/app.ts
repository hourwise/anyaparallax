import { createRequestHandler, RouterContextProvider } from "react-router";

import { appContext } from "../app/data/context";

// `virtual:react-router/server-build` is produced by the React Router Vite
// plugin and declared in `vite-env.d.ts` against the installed React Router
// `ServerBuild` type, so it can be passed to `createRequestHandler` unchanged.
const serverBuild = () => import("virtual:react-router/server-build");

const requestHandler = createRequestHandler(serverBuild, import.meta.env.MODE);

/** Paths whose responses belong to a signed-in operator and must never be cached. */
const PROTECTED_PATH = /^\/(?:admin|manager)(?:\/|$)/;

/**
 * Paths whose response carries a single-use enquiry submission token (Slice 08).
 *
 * The print enquiry form and the contact form each render a token that is spent by
 * the first accepted submission, and the duplicate guard collapses a replayed token
 * to one enquiry. A cached copy of the form would therefore hand the SAME token to
 * several visitors, and every visitor after the first would have their enquiry
 * silently treated as a replay — a lost enquiry is worse than a duplicate one, so
 * these responses are never reusable.
 *
 * The acknowledgement paths are included because a submission result must not be
 * shared or cached either. A non-GET response is additionally marked unindexable,
 * because a refused submission echoes what the sender typed; the plain GET of a
 * form stays indexable, since `/contact` is a page worth finding.
 *
 * This lives here rather than in the route modules because the document response
 * headers are decided at this boundary: a `data()` result's own headers are not
 * carried onto a rendered document.
 */
const ENQUIRY_FORM_PATH = /^\/(?:prints\/enquire|contact)(?:\/|$)/;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Bindings reach loaders through React Router's context API. Routes read
    // them with `appEnvironmentFrom(context)`; data access never reaches for
    // globals, which keeps every query testable in isolation.
    const context = new RouterContextProvider();
    context.set(appContext, { env, ctx });
    const response = await requestHandler(request, context);

    // Operator responses carry identity-bound content (account lists, status)
    // and denials. Neither a browser nor an intermediary should ever reuse
    // them, and no crawler should index them even when a status is not 200.
    if (PROTECTED_PATH.test(new URL(request.url).pathname)) {
      const headers = new Headers(response.headers);
      headers.set("cache-control", "no-store");
      headers.set("x-robots-tag", "noindex, nofollow");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    if (ENQUIRY_FORM_PATH.test(new URL(request.url).pathname)) {
      const headers = new Headers(response.headers);
      headers.set("cache-control", "no-store");
      if (request.method !== "GET" && request.method !== "HEAD") {
        headers.set("x-robots-tag", "noindex, nofollow");
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return response;
  },
} satisfies ExportedHandler<Env>;
