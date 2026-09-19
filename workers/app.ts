import { createRequestHandler, RouterContextProvider } from "react-router";

import { appContext } from "../app/data/context";

// `virtual:react-router/server-build` is produced by the React Router Vite
// plugin and declared in `vite-env.d.ts` against the installed React Router
// `ServerBuild` type, so it can be passed to `createRequestHandler` unchanged.
const serverBuild = () => import("virtual:react-router/server-build");

const requestHandler = createRequestHandler(serverBuild, import.meta.env.MODE);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Bindings reach loaders through React Router's context API. Routes read
    // them with `appEnvironmentFrom(context)`; data access never reaches for
    // globals, which keeps every query testable in isolation.
    const context = new RouterContextProvider();
    context.set(appContext, { env, ctx });
    return requestHandler(request, context);
  },
} satisfies ExportedHandler<Env>;
