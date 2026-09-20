/**
 * Server-side identity verification — the first half of the Slice 05 boundary.
 *
 * Cloudflare Access authenticates a person and forwards a signed JWT on the
 * `cf-access-jwt-assertion` header. This module verifies that assertion against
 * the Access public keys, then returns the proven email. Nothing else is
 * trusted: a bare `cf-access-authenticated-user-email` header, a cookie, a
 * query parameter or a client-supplied role never establishes an identity.
 *
 * Access is not configured yet (no Cloudflare resource exists), so the module
 * also supports a deliberately narrow development mechanism:
 * `DEVELOPMENT_IDENTITY_HEADER` is accepted only when the request is on a
 * loopback host AND `ALLOW_DEVELOPMENT_IDENTITY` is exactly "true". When Access
 * IS configured, the development mechanism is switched off entirely — even on
 * loopback — so a deployment cannot be downgraded to the local path.
 *
 * Server-only: this module fetches network resources and reads secrets-free
 * deployment configuration. Route modules obtain identities only through
 * `authorization.server.ts`.
 */
import {
  ACCESS_ASSERTION_HEADER,
  type AccessConfiguration,
  type IdentityEnvironment,
  type JsonWebKeySet,
  DEVELOPMENT_IDENTITY_HEADER,
  accessConfigurationFrom,
  accessConfigurationIntended,
  isLoopbackHostname,
  normaliseEmail,
  type VerifiedIdentity,
} from "./identity";

/** Tolerated clock skew between this worker and the identity provider. */
const CLOCK_SKEW_SECONDS = 60;

/** How long a fetched Access key set is reused before refetching. */
const JWKS_TTL_MS = 15 * 60 * 1000;

type JwtHeader = {
  readonly alg?: unknown;
  readonly kid?: unknown;
};

type JwtClaims = {
  readonly iss?: unknown;
  readonly aud?: unknown;
  readonly exp?: unknown;
  readonly nbf?: unknown;
  readonly iat?: unknown;
  readonly email?: unknown;
};

export type AccessKeySet = JsonWebKeySet;

/**
 * Where Access public keys come from. Injectable so the checks can verify real
 * RS256 signatures against a locally generated key set without touching the
 * network.
 */
export type AccessKeySetProvider = (teamDomain: string) => Promise<AccessKeySet>;

const keySetCache = new Map<string, { keys: AccessKeySet; expiresAt: number }>();

/** How Access publishes its signing keys for a team domain. */
function accessCertificatesUrl(teamDomain: string): string {
  return `https://${teamDomain}/cdn-cgi/access/certs`;
}

/** Fetch (and briefly cache) the Access key set. A failure denies, never authenticates. */
export async function fetchAccessKeySet(teamDomain: string): Promise<AccessKeySet> {
  const cached = keySetCache.get(teamDomain);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.keys;
  }

  const response = await fetch(accessCertificatesUrl(teamDomain), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Access key set request failed with ${response.status}`);
  }
  const keys = (await response.json()) as AccessKeySet;
  keySetCache.set(teamDomain, { keys, expiresAt: now + JWKS_TTL_MS });
  return keys;
}

/** base64url → bytes. Returns null on malformed input rather than throwing. */
function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

/** Decode one JSON JWT segment. Returns null when the segment is not valid JSON. */
function decodeJwtSegment<T>(segment: string): T | null {
  const bytes = decodeBase64Url(segment);
  if (!bytes) {
    return null;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

/** `aud` may be a single string or a list; both are legal in an Access token. */
function audienceMatches(audience: unknown, expected: string): boolean {
  if (typeof audience === "string") {
    return audience === expected;
  }
  return Array.isArray(audience) && audience.some((entry) => entry === expected);
}

/** `iss` is the team domain as a URL; accept a missing/exact trailing slash. */
function issuerMatches(issuer: unknown, teamDomain: string): boolean {
  if (typeof issuer !== "string") {
    return false;
  }
  const expected = `https://${teamDomain}`;
  return issuer === expected || issuer === `${expected}/`;
}

function numericClaim(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Verify an Access assertion. Returns the proven identity, or null for any
 * problem at all — an unverifiable token is simply not an identity.
 *
 * The checks call this with a locally generated RSA key set, which exercises
 * the same signature path production uses.
 */
export async function verifyAccessToken(
  token: string,
  configuration: AccessConfiguration,
  provideKeySet: AccessKeySetProvider = fetchAccessKeySet,
): Promise<VerifiedIdentity | null> {
  const segments = token.split(".");
  if (segments.length !== 3) {
    return null;
  }
  const [headerSegment = "", claimsSegment = "", signatureSegment = ""] = segments;

  const header = decodeJwtSegment<JwtHeader>(headerSegment);
  const claims = decodeJwtSegment<JwtClaims>(claimsSegment);
  if (!header || !claims) {
    return null;
  }

  // Only RS256 is accepted: `none` and HMAC algorithms are not Access tokens.
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    return null;
  }

  const signature = decodeBase64Url(signatureSegment);
  if (!signature) {
    return null;
  }

  let keySet: AccessKeySet;
  try {
    keySet = await provideKeySet(configuration.teamDomain);
  } catch {
    // No keys means no verification, and no verification means no identity.
    return null;
  }

  const jwk = (keySet.keys ?? []).find(
    (candidate) => candidate.kid === header.kid && candidate.kty === "RSA",
  );
  if (!jwk) {
    return null;
  }

  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { ...jwk, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature,
      new TextEncoder().encode(`${headerSegment}.${claimsSegment}`),
    );
  } catch {
    return null;
  }
  if (!verified) {
    return null;
  }

  // Signature is genuine; now the claims must apply to THIS application and be current.
  if (!issuerMatches(claims.iss, configuration.teamDomain)) {
    return null;
  }
  if (!audienceMatches(claims.aud, configuration.audience)) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = numericClaim(claims.exp);
  if (expiresAt === null || expiresAt + CLOCK_SKEW_SECONDS <= nowSeconds) {
    return null;
  }
  const notBefore = numericClaim(claims.nbf);
  if (notBefore !== null && notBefore - CLOCK_SKEW_SECONDS > nowSeconds) {
    return null;
  }

  const email = normaliseEmail(claims.email);
  if (email === null) {
    return null;
  }
  return { email, source: "cloudflare-access" };
}

/**
 * Resolve the identity of a request, or null when the request proves none.
 *
 * Order matters: a configured Access deployment is verified through Access
 * ONLY. The development header is considered only when Access is absent, the
 * development flag is on, and the request is on loopback.
 */
export async function resolveIdentity(
  request: Request,
  env: IdentityEnvironment | undefined,
): Promise<VerifiedIdentity | null> {
  try {
    const configuration = accessConfigurationFrom(env);
    if (configuration) {
      const assertion = request.headers.get(ACCESS_ASSERTION_HEADER);
      if (!assertion) {
        return null;
      }
      return await verifyAccessToken(assertion, configuration);
    }

    // Fail closed on a HALF-configured Access deployment. If either Access variable
    // is set but the pair is incomplete, the operator is standing up an Access
    // deployment and has a configuration mistake — the development identity path must
    // not rescue it, even with `ALLOW_DEVELOPMENT_IDENTITY=true` and a loopback-looking
    // host, because that would downgrade a broken Access deployment to header
    // authentication. The development path is considered ONLY when no Access variable
    // is present at all.
    if (accessConfigurationIntended(env)) {
      return null;
    }

    if (env?.ALLOW_DEVELOPMENT_IDENTITY !== "true") {
      return null;
    }
    let hostname: string;
    try {
      hostname = new URL(request.url).hostname;
    } catch {
      return null;
    }
    if (!isLoopbackHostname(hostname)) {
      return null;
    }
    const email = normaliseEmail(request.headers.get(DEVELOPMENT_IDENTITY_HEADER));
    return email === null ? null : { email, source: "development" };
  } catch {
    return null;
  }
}
