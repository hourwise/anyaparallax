/// <reference types="vite/client" />

// The React Router Vite plugin injects this virtual module at dev/build time in
// place of the route modules. Nothing shipped today declares it, so it is
// declared here: the build is exposed as named exports whose shape is the
// installed React Router `ServerBuild`. Typing it this way keeps the module and
// `workers/app.ts` in sync with the installed framework version, so the
// dynamic `import()` can be handed to `createRequestHandler` without a cast.
declare module "virtual:react-router/server-build" {
  type ServerBuild = import("react-router").ServerBuild;

  export const entry: ServerBuild["entry"];
  export const routes: ServerBuild["routes"];
  export const assets: ServerBuild["assets"];
  export const basename: ServerBuild["basename"];
  export const publicPath: ServerBuild["publicPath"];
  export const assetsBuildDirectory: ServerBuild["assetsBuildDirectory"];
  export const future: ServerBuild["future"];
  export const ssr: ServerBuild["ssr"];
  export const isSpaMode: ServerBuild["isSpaMode"];
  export const prerender: ServerBuild["prerender"];
  export const routeDiscovery: ServerBuild["routeDiscovery"];
  export const allowedActionOrigins: ServerBuild["allowedActionOrigins"];
}
