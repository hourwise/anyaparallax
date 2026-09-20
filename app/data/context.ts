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
  /**
   * The canonical public origin of the site, for example
   * `https://anyaparallax.co.uk`. Canonical links and social preview URLs are
   * built from it, so the domain lives in configuration rather than in markup,
   * and a request's `Host` header can never redefine it. Absent locally, where
   * the documented production origin is used.
   */
  readonly PUBLIC_SITE_ORIGIN?: string;
  /**
   * REPAIR-09A: render the site's development/preview notices. Defaults to OFF —
   * only the exact string "true" enables them — so a deployment that forgets the
   * value publishes no placeholder chrome. It is deliberately separate from the
   * two development flags above: those enable local FACILITIES, this one labels
   * content as provisional, and a site can need either without the other.
   */
  readonly SHOW_DEVELOPMENT_NOTICES?: string;
};

export type AppRequestContext = {
  readonly env: AppBindings;
  /** Execution context, for future `waitUntil` work (Slice 06 uploads). */
  readonly ctx?: ExecutionContext;
};

export const appContext = createContext<AppRequestContext>();
