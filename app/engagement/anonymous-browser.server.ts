/**
 * Anonymous like identity (Slice 07) — privacy first.
 *
 * A like needs to be attributable to "this browser, roughly" so that pressing
 * Like twice does not count twice. It does NOT need to know who anyone is, and
 * this module is written so that it cannot find out.
 *
 * WHAT THE IDENTIFIER IS
 *
 * One randomly generated opaque token, created from the platform CSPRNG, stored
 * in a first-party HttpOnly cookie. That is the whole input.
 *
 * WHAT IT IS NOT
 *
 * The token is not derived from, seeded by, salted with, or combined with any
 * request characteristic. There is deliberately no function in this module that
 * takes a request, a header, an address or a user agent. The checks assert that
 * changing User-Agent, forwarding headers, Accept-Language and arbitrary custom
 * headers leaves the token identical — which is true by construction, because
 * nothing here can see those values.
 *
 * No fingerprinting of any kind is used: no canvas, no audio, no fonts, no
 * screen metrics, no timezone, no plugin list, no hardware hints. The only
 * dependency is the platform's random number generator.
 *
 * WHAT IT IS CALLED
 *
 * The cookie value is a browser identifier. It is lightweight duplicate
 * mitigation, not a person, not an account, and not authentication. Nothing in
 * this module or its callers may describe it as an identity of a person.
 *
 * WHAT IS STORED
 *
 * The database stores a SHA-256 DIGEST of the token, never the token itself, so a
 * database disclosure does not hand over a value that a browser would present as
 * its own. The digest is one-way and unkeyed; because the token is 122 bits of
 * randomness there is nothing to guess, and no per-site secret has to be managed.
 */
import { isEngagementIdentifier } from "./identifier";

/** Cookie carrying the anonymous browser identifier. */
export const BROWSER_ID_COOKIE = "anyaparallax_browser";

/**
 * How long a browser keeps its identifier: 400 days.
 *
 * Long enough that duplicate mitigation survives a year of ordinary browsing,
 * and within the lifetime browsers actually honour for cookies. The value is a
 * fresh identifier each time it is set, so its age carries no information.
 */
export const BROWSER_ID_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** A generated identifier: 122 bits of randomness from `crypto.randomUUID`. */
export function newBrowserToken(): string {
  return crypto.randomUUID();
}

/**
 * SHA-256 of a token, as lowercase hex.
 *
 * This is the only value that reaches the database. The cookie token never does.
 */
export async function digestBrowserToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Read one cookie value from a Cookie header, or null. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/**
 * The browser's identifier from a Cookie header value, or null.
 *
 * Takes the header STRING rather than a `Request`, and that is the point: read
 * the module top to bottom and you will find no `.headers`, no `request`, and no
 * mention of a user agent, an address, a language or a referrer. An identifier
 * that cannot see a request cannot be derived from one — there is no code path
 * here that could fingerprint even if someone wanted it to.
 *
 * A malformed cookie is ignored rather than repaired: a value this application
 * did not issue must not be treated as a browser's identifier.
 */
export function browserTokenFromCookieHeader(cookieHeader: string | null): string | null {
  const value = readCookie(cookieHeader, BROWSER_ID_COOKIE);
  return value !== null && isEngagementIdentifier(value) ? value : null;
}

/**
 * The `Set-Cookie` value for a browser identifier.
 *
 * Attributes, and why each one is there:
 *
 *   HttpOnly  — script cannot read it, so a cross-site scripting bug cannot
 *               exfiltrate the identifier or forge a like history with it.
 *   SameSite=Lax — the cookie is not attached to cross-site subrequests, which is
 *               what stops another site from making a visitor's browser cast
 *               likes on their behalf. Lax (not Strict) keeps ordinary inbound
 *               navigation working, and the mutation endpoint has its own
 *               same-origin check as well.
 *   Path=/    — one identifier for the whole site, so a like on one photograph
 *               and a like on another are recognisably the same browser.
 *   Max-Age   — long-lived duplicate mitigation, see above.
 *   Secure    — set only on an HTTPS request. A browser rejects a Secure cookie
 *               delivered over plain HTTP, so setting it unconditionally would
 *               silently break local development. It is therefore conditional on
 *               the actual scheme rather than on configuration.
 *
 * There is no `Domain` attribute, so the cookie is host-only and is not shared
 * with subdomains.
 */
export function buildBrowserIdCookie(token: string, secureRequest: boolean): string {
  const attributes = [
    `${BROWSER_ID_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${BROWSER_ID_MAX_AGE_SECONDS}`,
  ];
  if (secureRequest) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

/**
 * True when a page was served over HTTPS, which is what `Secure` depends on.
 *
 * Takes the request's URL STRING rather than the request, for the same reason the
 * token parser takes a header rather than a request: this module reads no request
 * properties at all, so there is nothing here that could observe a visitor.
 *
 * The scheme is taken from the request's own URL rather than from configuration,
 * because a `Secure` cookie delivered over plain HTTP is rejected by the browser —
 * setting it on the strength of a config value would silently break local
 * development, and omitting it in production would silently weaken the cookie.
 */
export function isSecureRequestUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
