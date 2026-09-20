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
  /**
   * Cloudflare Access team domain, for example `team.cloudflareaccess.com`.
   * Absent until the operator creates the Access application (see README).
   */
  readonly ACCESS_TEAM_DOMAIN?: string;
  /**
   * Cloudflare Access application audience (AUD) tag. Not a secret, but it is
   * deployment configuration: it pairs a request's Access JWT with this
   * application. Absent until the operator configures Access.
   */
  readonly ACCESS_AUD?: string;
  /**
   * Development-only: accept the local development identity header
   * (`x-anyaparallax-development-identity`) so the auth boundary can be
   * exercised without Cloudflare Access. Ignored unless the request is also on
   * a loopback host; must never be "true" in a real deployment.
   */
  readonly ALLOW_DEVELOPMENT_IDENTITY?: string;
};

export type AppRequestContext = {
  readonly env: AppBindings;
  /** Execution context, for future `waitUntil` work (Slice 06 uploads). */
  readonly ctx?: ExecutionContext;
};

export const appContext = createContext<AppRequestContext>();
