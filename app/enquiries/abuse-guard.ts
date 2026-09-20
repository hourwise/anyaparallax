/**
 * Non-identifying abuse guard for the public enquiry forms (REPAIR-09D) — pure.
 *
 * The audit found that the public write endpoints had no abuse protection at all.
 * The preferred infrastructure answer — a Cloudflare WAF rate-limiting rule — needs
 * remote Cloudflare configuration, which this repair is not authorised to make. What
 * is implemented here is therefore an APPLICATION-LAYER guard, and it is deliberately
 * built from evidence about the SUBMISSION rather than about the SUBMITTER:
 *
 *   1. A honeypot field a person never fills and a form-filling robot usually does.
 *   2. A minimum completion interval: a form returned and submitted faster than a
 *      person can read it was not filled in by a person.
 *   3. A maximum age, so a captured form cannot be replayed indefinitely.
 *   4. A link count, because unsolicited link insertion is what most enquiry-form
 *      spam is actually for.
 *   5. The existing strict field validation, submission token and idempotency rules,
 *      which are unchanged and still run afterwards.
 *
 * WHAT THIS MODULE CANNOT SEE, BY CONSTRUCTION. It takes form VALUES, never a
 * `Request`. There is no address, user agent, referrer, cookie or browser
 * characteristic anywhere in its input, so none of them can be stored, hashed,
 * compared or remembered — and nothing is persisted: not a rejection, not a counter,
 * not a history. Each submission is judged on its own and then forgotten.
 *
 * HONEST LIMITATIONS, stated because they matter more than the controls:
 *
 *   * THE TIMING EVIDENCE IS CLIENT-SUPPLIED. A signed token would prove when this
 *     application issued the form, but signing needs a production secret, and this
 *     repair may not create one. An attacker who edits the hidden timestamp can
 *     therefore defeat the interval and age checks.
 *   * A DETERMINED ATTACKER CAN SOLVE ALL OF IT. A distributed, low-rate, human-paced
 *     campaign that fills no honeypot and includes no links passes every check here.
 *     This raises the cost of opportunistic automation; it is not rate limiting and
 *     must not be described as equivalent to it.
 *   * IT IS NOT A SECURITY BOUNDARY. Nothing protected by authorisation is affected:
 *     the print enquiry still resolves its photograph against the database, and the
 *     admin surfaces are still guarded independently.
 */

/**
 * The honeypot field's name.
 *
 * Chosen to look like an ordinary optional form field, because a trap whose name
 * announces itself is a trap only the most naive robot walks into. It is NOT a
 * `type="hidden"` input: many robots skip hidden inputs precisely because they are
 * the classic trap, and a field that is merely invisible to people is the pattern
 * that actually catches form-filling automation.
 */
export const FORM_TRAP_FIELD = "website";

/** The hidden field carrying the time this application rendered the form. */
export const FORM_ISSUED_AT_FIELD = "formIssuedAt";

/**
 * The shortest interval a real submission can plausibly take.
 *
 * A person has to see the form and write a message, so one second is comfortably
 * below any human interaction while comfortably above the fetch-and-post-immediately
 * pattern that automated submissions use.
 */
export const MIN_FORM_FILL_MS = 1_000;

/**
 * The longest a rendered form stays acceptable.
 *
 * Twelve hours keeps a form usable across a long break without leaving a captured
 * one reusable for ever. Both bounds are operator-tunable constants, not policy.
 */
export const MAX_FORM_AGE_MS = 12 * 60 * 60 * 1000;

/** How many links a message may contain before it looks like link insertion. */
export const MAX_LINKS_IN_MESSAGE = 2;

/** Why a submission was refused. Internal only: the response never names it. */
export type AbuseRefusal = "trap" | "untimed" | "too-fast" | "stale" | "links";

export type AbuseVerdict =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly refusal: AbuseRefusal };

/** The form evidence this guard reads. Every field is raw and untrusted. */
export type AbuseEvidence = {
  readonly trap: unknown;
  readonly issuedAt: unknown;
  readonly name: unknown;
  readonly message: unknown;
};

/** Control characters, excluding tab and newline. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(CONTROL_CHARACTERS, "").trim() : "";
}

/**
 * Count link-like sequences.
 *
 * Deliberately shape-based rather than a URL parser: anything that looks like a
 * scheme or a `www.` host counts, which is what link insertion relies on.
 */
export function countLinks(value: string): number {
  return (value.match(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi) ?? []).length;
}

/** The current time as an integer millisecond timestamp. */
function epoch(value: unknown): number | null {
  const raw = text(value);
  if (!/^\d{10,16}$/.test(raw)) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Screen one submission.
 *
 * `now` is injected so the caller decides what "now" means (and so the rules are
 * testable without waiting). The checks run cheapest-first and stop at the first
 * refusal, so a submission is never inspected further than it needs to be.
 */
export function screenEnquirySubmission(
  evidence: AbuseEvidence,
  now: number,
): AbuseVerdict {
  // 1. The trap. A person leaves it empty; the value is never read beyond this test
  //    and never stored.
  if (text(evidence.trap).length > 0) {
    return { accepted: false, refusal: "trap" };
  }

  // 2. Timing. Missing or malformed evidence is refused rather than treated as
  //    "just submitted", so a client cannot omit its way past the interval.
  const issuedAt = epoch(evidence.issuedAt);
  if (issuedAt === null) {
    return { accepted: false, refusal: "untimed" };
  }
  const elapsed = now - issuedAt;
  if (elapsed < MIN_FORM_FILL_MS) {
    return { accepted: false, refusal: "too-fast" };
  }
  if (elapsed > MAX_FORM_AGE_MS) {
    return { accepted: false, refusal: "stale" };
  }

  // 3. Link insertion. A link in the name field is never legitimate; a few in the
  //    message are (a band sending its own page), so only the excess is refused.
  if (countLinks(text(evidence.name)) > 0 || countLinks(text(evidence.message)) > MAX_LINKS_IN_MESSAGE) {
    return { accepted: false, refusal: "links" };
  }

  return { accepted: true };
}

/**
 * Read the guard's evidence through a form reader.
 *
 * Kept beside the guard so both enquiry routes extract exactly the same fields, and
 * so the complete list of what the guard may see is in one place.
 */
export function abuseEvidenceFrom(read: (name: string) => unknown): AbuseEvidence {
  return {
    trap: read(FORM_TRAP_FIELD),
    issuedAt: read(FORM_ISSUED_AT_FIELD),
    name: read("name"),
    message: read("message"),
  };
}
