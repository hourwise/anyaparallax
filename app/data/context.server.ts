/**
 * Access to Cloudflare bindings from React Router loaders.
 *
 * The Worker entry sets `appContext` on the request's context provider; loaders
 * read it back here. Keeping this in one helper means routes do not re-derive
 * the cast, and it never touches the database itself — callers pass the
 * environment to `app/data/queries.ts`.
 */
import { appContext } from "./context";
import type { AppBindings } from "./context";
import type { RouterContextProvider } from "react-router";
/**
 * Extract the application environment from a loader's `context`.
 *
 * Returns undefined when the runtime provides no Cloudflare context (for
 * example a plain Node build), which lets the query layer apply its documented
 * fallback rules instead of failing here.
 */
export function appEnvironmentFrom(context: unknown): AppBindings | undefined {
  if (!context || typeof context !== "object") {
    return undefined;
  }
  try {
    return (context as RouterContextProvider).get(appContext)?.env;
  } catch {
    // No context was set (for example during route module unit checks).
    return undefined;
  }
}
