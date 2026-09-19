import { createRequestHandler } from "react-router";

// `virtual:react-router/server-build` is produced by the React Router Vite
// plugin and declared in `vite-env.d.ts` against the installed React Router
// `ServerBuild` type, so it can be passed to `createRequestHandler` unchanged.
const serverBuild = () => import("virtual:react-router/server-build");

const requestHandler = createRequestHandler(serverBuild, import.meta.env.MODE);

export default {
  async fetch(
    request: Request,
    _env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    // Slice 01 has no bindings and no loaders that read Cloudflare context, so
    // the request handler is called without a load context. Later slices can
    // build one from `env`/`ctx` through React Router's `RouterContextProvider`
    // API once D1, R2 and the Cloudflare Access boundary exist.
    return requestHandler(request);
  },
} satisfies ExportedHandler<Env>;
