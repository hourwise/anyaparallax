/**
 * Application request context.
 *
 * React Router loaders receive this once the Worker entry sets it on a
 * `RouterContextProvider`. Keeping it in one module means routes and data
 * access share the same binding types, and routes never reach for globals.
 */
import { createContext } from "react-router";

export type AppBindings = {
  /** D1 database (structured portfolio data). */
  readonly DB?: D1Database;
  /** Private bucket: archival/print originals. Never served to visitors. */
  readonly MASTERS?: R2Bucket;
  /** Public bucket: web derivatives and gallery thumbnails. */
  readonly IMAGES?: R2Bucket;
  /** Development-only: allow the seed repository when no D1 binding exists. */
  readonly ALLOW_DEVELOPMENT_SEED?: string;
};

export type AppRequestContext = {
  readonly env: AppBindings;
  /** Execution context, for future `waitUntil` work (Slice 06 uploads). */
  readonly ctx?: ExecutionContext;
};

export const appContext = createContext<AppRequestContext>();
