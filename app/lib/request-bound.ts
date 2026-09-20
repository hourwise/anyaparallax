/**
 * Request-size boundary for public form endpoints (REPAIR-09D) — pure.
 *
 * The upload pipeline has enforced a header-only size gate since Slice 06 repair 02,
 * but the PUBLIC WRITE endpoints did not: `/contact`, `/prints/enquire` and the
 * engagement endpoint all called `request.formData()` directly, so any client could
 * hand the isolate an arbitrarily large body and have it buffered before a single
 * rule was applied.
 *
 * This module is the same idea at the smallest useful size: read `Content-Length`
 * from the HEADERS, before the body is parsed, and refuse a request that is either
 * too large or of unknown size. A request whose size cannot be established has no
 * ceiling this application can promise, so it is refused rather than parsed.
 *
 * It deliberately knows nothing about what the body contains: no address, no user
 * agent, no header other than the declared length is read, so this is a bound rather
 * than a tracker.
 */

/** The declared length of a request body, or null when there is no usable one. */
export function declaredContentLength(request: Request): number | null {
  const header = request.headers.get("content-length");
  if (header === null) {
    return null;
  }
  const value = Number(header.trim());
  // Reject NaN, negatives, fractions and infinities: anything that is not a plain
  // non-negative integer length cannot bound the request.
  if (!Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

/** Why a request's size could not be accepted. */
export type RequestSizeVerdict =
  | { readonly ok: true; readonly length: number }
  | { readonly ok: false; readonly reason: "undeclared" | "too-large"; readonly length: number | null };

/**
 * Is this request's body within `maxBytes`, judged from its headers alone?
 *
 * Callers apply this BEFORE `request.formData()`, which is the only step that
 * materialises the body.
 */
export function checkRequestSize(request: Request, maxBytes: number): RequestSizeVerdict {
  const length = declaredContentLength(request);
  if (length === null) {
    return { ok: false, reason: "undeclared", length: null };
  }
  if (length > maxBytes) {
    return { ok: false, reason: "too-large", length };
  }
  return { ok: true, length };
}
