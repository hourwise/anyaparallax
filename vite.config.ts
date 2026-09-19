import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // The Worker/SSR environment is the default one for this project; the
    // React Router plugin drives the client and server route builds.
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    reactRouter(),
  ],
});
