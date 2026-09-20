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
 * The accepted operator-identity character set: printable ASCII only.
 *
 * This is an explicit V1 IDENTITY CONTRACT, not a general email validator. Real
 * operator addresses are conventional ASCII mailboxes, and restricting them is
 * what lets the two authority rules in this boundary agree exactly:
 *
 *   * the application normalises an accepted identity with `toLowerCase()`;
 *   * the database enforces uniqueness with `COLLATE NOCASE`;
 *   * JavaScript lower-casing is Unicode-aware, while SQLite's NOCASE folds
 *     ASCII A-Z only, so outside ASCII the two rules can disagree — an address
 *     could be one identity to the application and two rows to the database.
 *
 * Rejecting non-ASCII outright removes that class of disagreement instead of
 * approximating it: for every accepted identity both rules are the same ASCII
 * fold. The range is written explicitly (`\x20-\x7E`, compared per code unit) so
 * "ASCII" stays visibly ASCII and cannot be read as a Unicode property escape.
 * An internationalised address is therefore refused and the operator must use
 * its ASCII form — a deliberate V1 limitation.
 */
// The first printable ASCII code point, written as an escape so the class reads
// as an explicit range rather than as a literal space.
const ASCII_IDENTITY_PATTERN = /^[\x20-\x7E]*$/;

/**
 * Normalise an email for storage and lookup: trimmed, lower-cased, ASCII-only,
 * length- and shape-checked.
 *
 * Returns null when the value cannot be an accepted identity — including ANY
 * non-ASCII code point — so callers deny instead of comparing junk, and the
 * database's NOCASE uniqueness rule always agrees with this function's result.
 */
export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_EMAIL_LENGTH ||
    !ASCII_IDENTITY_PATTERN.test(trimmed)
  ) {
    return null;
  }
  const email = trimmed.toLowerCase();
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
 * Has the operator BEGUN configuring Cloudflare Access?
 *
 * True when either Access variable carries any non-blank value, whether or not the
 * pair is complete. This distinguishes two very different deployments that
 * {@link accessConfigurationFrom} otherwise reports identically as "no Access":
 *
 *   * a deployment with no Access variables at all (local development, or a
 *     deliberately closed deployment), and
 *   * a deployment where Access is HALF-configured or mistyped — one variable set,
 *     the other missing or blank.
 *
 * The second is a production deployment that is trying to be an Access deployment
 * and has a configuration mistake. It must NEVER fall back to the development
 * identity path (see `resolveIdentity`): the presence of a stray
 * `ALLOW_DEVELOPMENT_IDENTITY=true` must not silently downgrade a broken Access
 * deployment to header authentication. Failing closed is the safe reading of a
 * half-finished Access configuration.
 */
export function accessConfigurationIntended(env: IdentityEnvironment | undefined): boolean {
  const teamDomain = typeof env?.ACCESS_TEAM_DOMAIN === "string" ? env.ACCESS_TEAM_DOMAIN.trim() : "";
  const audience = typeof env?.ACCESS_AUD === "string" ? env.ACCESS_AUD.trim() : "";
  return teamDomain.length > 0 || audience.length > 0;
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
  // A HALF-configured Access deployment fails closed in `resolveIdentity`: the
  // development header is refused when either Access variable is set. Report that
  // truthfully as `closed` rather than `development`, so the diagnostics never claim a
  // header path is live while the boundary is actually denying every request.
  if (accessConfigurationIntended(env)) {
    return "closed";
  }
  return env?.ALLOW_DEVELOPMENT_IDENTITY === "true" ? "development" : "closed";
}
