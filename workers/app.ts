import { createRequestHandler, RouterContextProvider } from "react-router";

import { appContext } from "../app/data/context";

// `virtual:react-router/server-build` is produced by the React Router Vite
// plugin and declared in `vite-env.d.ts` against the installed React Router
// `ServerBuild` type, so it can be passed to `createRequestHandler` unchanged.
const serverBuild = () => import("virtual:react-router/server-build");

const requestHandler = createRequestHandler(serverBuild, import.meta.env.MODE);

/** Paths whose responses belong to a signed-in operator and must never be cached. */
const PROTECTED_PATH = /^\/(?:admin|manager)(?:\/|$)/;

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

    return response;
  },
} satisfies ExportedHandler<Env>;
