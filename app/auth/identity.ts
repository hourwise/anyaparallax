/**
 * Authentication vocabulary shared by the identity boundary, the authorization
 * guards and the operator interfaces (Slice 05).
 *
 * Pure module: no bindings, no network, no Cloudflare APIs. The verification
 * work lives in `identity.server.ts`; everything here is safe to import from a
 * check script or from a component that only needs the types.
 */

/** Cloudflare Access assertion JWT, injected by Access for an authenticated request. */
export const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";

/**
 * Development-only identity header. Accepted ONLY when
 * `ALLOW_DEVELOPMENT_IDENTITY` is "true" AND the request arrived on a loopback
 * host, so it cannot become an authentication bypass in a deployment.
 */
export const DEVELOPMENT_IDENTITY_HEADER = "x-anyaparallax-development-identity";

/**
 * How an identity was proven. Surfaced in the operator interfaces so a
 * development identity can never be mistaken for a Cloudflare Access one.
 */
export type IdentitySource = "cloudflare-access" | "development";

/** A verified email address, with the mechanism that verified it. */
export type VerifiedIdentity = {
  readonly email: string;
  /** `cloudflare-access` for a verified Access JWT, `development` for the local header. */
  readonly source: IdentitySource;
};

/**
 * Minimal shape of an Access key set (JWKS). The keys themselves are standard
 * JWKs; the checks generate a real RSA key pair to exercise the same
 * verification path production uses.
 */
export type JsonWebKeySet = {
  readonly keys?: readonly (JsonWebKey & { readonly kid?: string })[];
};

/** The request environment this module reads. Structural, so checks can pass plain objects. */
export type IdentityEnvironment = {
  readonly ACCESS_TEAM_DOMAIN?: string;
  readonly ACCESS_AUD?: string;
  readonly ALLOW_DEVELOPMENT_IDENTITY?: string;
};

/**
 * Access configuration is "present" only when BOTH values are set; a partial
 * configuration is treated as absent (the guards then deny, which is safe).
 */
export type AccessConfiguration = {
  /** Normalised team domain, for example `team.cloudflareaccess.com`. */
  readonly teamDomain: string;
  /** Application audience (AUD) tag the JWT must be issued for. */
  readonly audience: string;
};

/** Longest plausible email address (RFC 5321). */
const MAX_EMAIL_LENGTH = 254;

/** Deliberately simple shape check: one `@`, no whitespace, a dot in the domain. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * Normalise an email for storage and lookup: trimmed, lower-cased, shape-checked.
 * Returns null when the value cannot be an address, so callers deny instead of
 * comparing junk.
 */
export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) {
    return null;
  }
  return EMAIL_PATTERN.test(email) ? email : null;
}

/**
 * Loopback hostnames are the only place the development identity header is
 * honoured. WHATWG URL keeps IPv6 hostnames bracketed (`[::1]`); both forms are
 * accepted so the check harness and a browser tab behave the same.
 */
export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/** Strip an optional scheme and any trailing slashes from a configured team domain. */
export function normaliseTeamDomain(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  if (trimmed.length === 0 || /\s/.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

/** Read the Access configuration from the environment, or null when incomplete. */
export function accessConfigurationFrom(
  env: IdentityEnvironment | undefined,
): AccessConfiguration | null {
  const teamDomain = normaliseTeamDomain(env?.ACCESS_TEAM_DOMAIN);
  const audience = typeof env?.ACCESS_AUD === "string" ? env.ACCESS_AUD.trim() : "";
  if (!teamDomain || audience.length === 0) {
    return null;
  }
  return { teamDomain, audience };
}

/**
 * Access logout endpoint, or null when Access is not configured. Signing out is
 * Access' responsibility, not the application's; the operator interfaces only
 * link to it. Pure string construction, so the chrome can use it without
 * importing the verification module.
 */
export function accessLogoutUrl(env: IdentityEnvironment | undefined): string | null {
  const configuration = accessConfigurationFrom(env);
  return configuration ? `https://${configuration.teamDomain}/cdn-cgi/access/logout` : null;
}

/**
 * Which authentication mechanism this deployment will accept. Reported by the
 * Manager diagnostics page; never returns configuration values.
 *
 * - `cloudflare-access` — Access is configured; only verified Access JWTs count.
 * - `development`       — no Access yet, but the local development header is enabled.
 * - `closed`            — neither; every protected route denies.
 */
export type IdentityMode = "cloudflare-access" | "development" | "closed";

export function identityModeFor(env: IdentityEnvironment | undefined): IdentityMode {
  if (accessConfigurationFrom(env)) {
    return "cloudflare-access";
  }
  return env?.ALLOW_DEVELOPMENT_IDENTITY === "true" ? "development" : "closed";
}
