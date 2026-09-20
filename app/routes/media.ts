/**
 * `GET /media/*` — the public derivative route (Slice 06).
 *
 * A resource route: registered outside every layout, it returns bytes rather
 * than an HTML document and exports no component.
 *
 * This module exports the loader and NOTHING else. React Router strips server
 * code from `loader`/`action` exports; any additional export would be treated as
 * client code and would drag the storage module into the browser bundle, which
 * the build refuses outright. The serving logic therefore lives in
 * `app/images/media.server.ts`.
 */
import { appEnvironmentFrom } from "../data/context.server";

export async function loader({
  params,
  context,
}: {
  params: Record<string, string | undefined>;
  context: unknown;
}): Promise<Response> {
  const { serveMedia } = await import("../images/media.server");
  return serveMedia(params["*"] ?? "", appEnvironmentFrom(context));
}
