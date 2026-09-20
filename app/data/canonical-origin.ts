/**
 * Canonical public origin (Slice 07).
 *
 * ONE server-side boundary decides what the site's public origin is. Canonical
 * links, OpenGraph URLs and social preview images are built from it, so the
 * domain never appears in a component and can never drift between pages.
 *
 * Why a configured value rather than the request:
 *
 *   * `PUBLIC_SITE_ORIGIN` is the operator's statement of the canonical origin;
 *   * a request's `Host` header is attacker-controlled, and deriving canonical
 *     URLs from it would let anyone mint social metadata pointing at their own
 *     domain, and publish duplicate canonicals for the same photograph. The
 *     request is therefore only ever a DEVELOPMENT fallback, never the authority.
 *
 * Validation is deliberately strict about the scheme: production is HTTPS, and a
 * configured `http://` origin would silently emit insecure canonical URLs. The
 * only exception is a loopback origin, which exists so local development and the
 * checks can run without a certificate.
 */

/** The operator-supplied production origin. */
export const DEFAULT_PUBLIC_SITE_ORIGIN = "https://anyaparallax.co.uk";

/** The environment value this module reads. */
export type CanonicalOriginEnvironment = {
  readonly PUBLIC_SITE_ORIGIN?: string;
};

/** True for the loopback hosts this project treats as local everywhere else. */
function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/**
 * Normalise and validate a configured origin.
 *
 * Returns null when the value cannot be a usable origin, so the caller can fall
 * back loudly rather than emitting a malformed canonical URL. A path, query,
 * fragment, credentials or a non-HTTP scheme all disqualify it: an origin is a
 * scheme, a host and an optional port, and nothing else.
 */
export function normaliseSiteOrigin(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  // A configured origin must be a bare origin: anything else is a configuration
  // mistake that would produce URLs like https://host/path/photo/slug.
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    return null;
  }
  if (url.username !== "" || url.password !== "") {
    return null;
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    // Plain HTTP is only tolerable on a loopback development origin.
    return null;
  }
  return url.origin;
}

/**
 * The canonical origin for this deployment.
 *
 * An invalid configured value falls back to {@link DEFAULT_PUBLIC_SITE_ORIGIN}
 * rather than to the request: a typo in configuration must not silently change
 * what the site claims its canonical address is, and the default is the
 * operator-supplied production origin.
 */
export function siteOriginFrom(env: CanonicalOriginEnvironment | undefined): string {
  return normaliseSiteOrigin(env?.PUBLIC_SITE_ORIGIN) ?? DEFAULT_PUBLIC_SITE_ORIGIN;
}

/**
 * An absolute URL on the canonical origin.
 *
 * The path must be site-relative. A path that is itself absolute (`https://…`)
 * would escape the canonical origin, which is exactly the confusion this module
 * exists to prevent, so it is reduced to its path and query.
 */
export function canonicalUrl(origin: string, path: string): string {
  const relative = /^[a-z][a-z0-9+.-]*:/i.test(path) ? new URL(path).pathname : path;
  const base = origin.endsWith("/") ? origin : `${origin}/`;
  return new URL(relative.replace(/^\/+/, ""), base).toString();
}
