/**
 * Enquiry vocabulary and honest copy (Slice 08) — pure, no bindings, no React.
 *
 * This is the ONE definition of what an enquiry may say about itself: the
 * categories a visitor may choose, the print formats this application accepts, the
 * handled states an operator may set, the input bounds, and the sentences the
 * public pages are allowed to show.
 *
 * Two rules live here rather than in whichever component happens to render them:
 *
 *   1. AN ENQUIRY IS NOT AN ORDER. The site has no basket, no checkout, no
 *      payment, no order number, no stock and no shipping. Nothing in this
 *      module may claim otherwise, and `FORBIDDEN_COMMERCE_CLAIMS` below states
 *      that as machine-checkable patterns so a future string cannot quietly
 *      promise a purchase. The disclosure that checkout is NOT available is
 *      allowed, and required — the patterns match positive AFFORDANCES and
 *      claims, not the honest statement that they are absent.
 *
 *   2. THE VALUES ARE EXACTLY THESE. Categories and formats are allow-lists, not
 *      suggestions: a value that is not in the list is refused rather than
 *      coerced, because an unrecognised category silently becoming 'other' would
 *      turn an unexpected input into trusted state.
 *
 * The category values are the build sheet's suggested enquiry categories; the
 * format values are the formats that sheet names for print products. Physical
 * dimensions and prices are explicitly operator decisions there, so this module
 * does NOT invent a size taxonomy: a size preference is bounded free text.
 */

/** Enquiry categories, from the build sheet's suggested list. */
export const ENQUIRY_CATEGORIES = [
  "band-artist-photography",
  "gig-photography",
  "event-photography",
  "car-photography",
  "print-enquiry",
  "other",
] as const;

export type EnquiryCategory = (typeof ENQUIRY_CATEGORIES)[number];

/**
 * The one category that makes an enquiry a PRINT enquiry.
 *
 * A print enquiry may carry a photograph, a format preference and a size
 * preference. A general contact message may carry none of them — the distinction
 * between the two journeys is this value, and it is decided server-side.
 */
export const PRINT_ENQUIRY_CATEGORY: EnquiryCategory = "print-enquiry";

/** Categories a general contact message may use: everything except print. */
export const CONTACT_CATEGORIES: readonly EnquiryCategory[] = ENQUIRY_CATEGORIES.filter(
  (category) => category !== PRINT_ENQUIRY_CATEGORY,
);

/** Print format preferences. These are preferences to discuss, not products on sale. */
export const PRINT_FORMATS = [
  "photographic-print",
  "fine-art-print",
  "framed-print",
  "no-preference",
] as const;

export type PrintFormat = (typeof PRINT_FORMATS)[number];

export const PRINT_FORMAT_LABELS: Record<PrintFormat, string> = {
  "photographic-print": "Photographic print",
  "fine-art-print": "Fine-art print",
  "framed-print": "Framed print",
  "no-preference": "No preference — please advise",
};

export const ENQUIRY_CATEGORY_LABELS: Record<EnquiryCategory, string> = {
  "band-artist-photography": "Band / artist photography",
  "gig-photography": "Gig photography",
  "event-photography": "Event photography",
  "car-photography": "Car photography",
  "print-enquiry": "Print enquiry",
  other: "Something else",
};

/**
 * Handled states an operator may set.
 *
 * These are the values `enquiries.status` has constrained since migration 0001,
 * so this list MIRRORS the table rather than extending it. There is deliberately
 * no 'quoted', 'paid', 'ordered' or 'fulfilled': those would be order states, and
 * V1 has no orders.
 */
export const ENQUIRY_STATUSES = ["new", "read", "archived"] as const;

export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const DEFAULT_ENQUIRY_STATUS: EnquiryStatus = "new";

export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatus, string> = {
  new: "New",
  read: "Read",
  archived: "Archived",
};

/**
 * Input bounds, applied server-side.
 *
 * The database mirrors the two that protect a stored column
 * (`print_format`'s allow-list and `print_size`'s length); the rest exist so an
 * oversized submission is refused before it reaches storage at all.
 */
export const ENQUIRY_LIMITS = {
  name: 120,
  /** RFC 5321's maximum forward-path length. */
  email: 254,
  message: 4000,
  printSize: 40,
  /** A canonical UUID's textual length; the form issues exactly this shape. */
  submissionToken: 36,
  /** How many enquiries the operator surface reads in one view. */
  operatorList: 200,
} as const;

export function isEnquiryCategory(value: unknown): value is EnquiryCategory {
  return typeof value === "string" && (ENQUIRY_CATEGORIES as readonly string[]).includes(value);
}

export function isPrintFormat(value: unknown): value is PrintFormat {
  return typeof value === "string" && (PRINT_FORMATS as readonly string[]).includes(value);
}

export function isEnquiryStatus(value: unknown): value is EnquiryStatus {
  return typeof value === "string" && (ENQUIRY_STATUSES as readonly string[]).includes(value);
}

/** Does this category carry the print-only preferences? */
export function carriesPrintPreferences(category: EnquiryCategory): boolean {
  return category === PRINT_ENQUIRY_CATEGORY;
}

/**
 * An enquiry as stored, with its photograph resolved through the public rules.
 *
 * `photoId` is the authoritative `photos.id` this application resolved itself. A
 * client-submitted title, slug, publication state or print-eligibility flag is
 * never stored: the only photograph fact an enquiry records is the id the server
 * verified.
 */
export type EnquiryInput = {
  readonly name: string;
  readonly email: string;
  readonly category: EnquiryCategory;
  readonly message: string;
  /** The verified photograph id, or null for a general enquiry. */
  readonly photoId: string | null;
  readonly printFormat: PrintFormat | null;
  readonly printSize: string | null;
  /** Idempotency key for this form render. Not an identity. */
  readonly submissionToken: string;
};

/** A stored enquiry as the operator surface reads it. */
export type StoredEnquiry = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly category: EnquiryCategory;
  readonly message: string;
  readonly photoId: string | null;
  /** Resolved from the photographs table at read time, or null. */
  readonly photoTitle: string | null;
  readonly photoSlug: string | null;
  readonly printFormat: PrintFormat | null;
  readonly printSize: string | null;
  readonly status: EnquiryStatus;
  readonly createdAt: string;
};

/**
 * The public sentences about print enquiries.
 *
 * Centralised so the checks can prove the site does not promise commerce, and so
 * the acknowledgement cannot drift into claiming an order exists. Every string
 * here is shown to a visitor, and each one is true of this implementation:
 * nothing is ordered, nothing is paid for, and availability is confirmed
 * personally rather than guaranteed by a machine.
 */
export const ENQUIRY_COPY = {
  /** Shown on the acknowledgement page after a successful print enquiry. */
  acknowledgementHeading: "Thanks — your enquiry has been received.",
  acknowledgementBody:
    "Anya will reply to the email address you gave to confirm availability, format, size and price. " +
    "Nothing has been ordered and no payment has been taken: this site has no basket and no checkout.",
  /** The same page for a general contact message, which is a different journey. */
  acknowledgementHeadingContact: "Thanks — your message has been received.",
  acknowledgementBodyContact:
    "Anya will reply to the email address you gave. Nothing further has been created by sending it, " +
    "and no payment is involved.",
  /** The honest boundary, stated wherever print interest is invited. */
  noCheckoutNotice:
    "Print enquiries are handled personally by email. This site has no basket, no checkout and no " +
    "payment: no price is charged here, and no availability is guaranteed until Anya replies.",
  /** What happens after an enquiry, stated without promising an outcome. */
  responseExpectation:
    "Availability, dimensions, format and price are confirmed in that reply — they are not shown as " +
    "a fixed offer on this page.",
  /** Shown when an enquiry cannot be stored, so a failure never looks like a success. */
  unavailable:
    "Enquiries cannot be recorded in this environment, so nothing has been saved. Please try again " +
    "later.",
  /** Shown when a photograph is not currently offered for print enquiries. */
  photoNotOffered:
    "That photograph is not currently offered for print enquiries. You can still register interest " +
    "below and Anya will let you know if that changes.",
  /**
   * Shown when a submission is refused by the abuse guard (REPAIR-09D).
   *
   * Deliberately general. A message that named the rule would let a script tune
   * against it, and there is nothing a legitimate visitor needs to change: reloading
   * the page and sending again is the fix for every refusal this wording covers.
   */
  submissionNotAccepted:
    "That message could not be accepted. Please reload the page and send it again.",
  /**
   * Shown when the link count is the reason.
   *
   * This one IS specific, because it is the only refusal a real visitor can cause
   * by accident: being told to remove the links is the difference between a
   * retryable form and a dead end. It reveals a content rule, not the trap.
   */
  linksNotAccepted:
    "Please send the message without links in it — Anya will ask if she needs to see one.",
} as const;

/**
 * Positive commercial claims and affordances this site must never make.
 *
 * These are AFFORDANCES and ASSERTIONS, not vocabulary. A page that says "this
 * site has no checkout" is telling the truth and must pass; a page offering
 * "Proceed to checkout" or "Add to basket" is claiming a capability that does not
 * exist and must fail. `forbiddenCommerceClaimIn()` below is what tells those two
 * apart, and `NO_COMMERCE_NEGATORS` is the list of words it accepts as a denial.
 */
export const FORBIDDEN_COMMERCE_CLAIMS: readonly (readonly [string, RegExp])[] = [
  ["an add-to-basket action", /\badd\s+to\s+(basket|cart|bag)\b/i],
  ["a basket or cart link", /\b(view|go to|open|your)\s+(basket|cart|bag)\b/i],
  ["a checkout action", /\b(proceed to|go to|continue to|start)\s+checkout\b/i],
  ["a buy-now action", /\bbuy\s+now\b/i],
  ["a pay-now action", /\bpay\s+now\b/i],
  ["an order action", /\bplace\s+(your\s+)?order\b/i],
  ["a claim that an order exists", /\b(your|the)\s+order\s+(has been|is|was|number)\b/i],
  ["a claim that an order is confirmed", /\border\s+(confirmed|complete|completed|placed|shipped)\b/i],
  ["a claimed order number", /\border\s+(number|reference|id)\b/i],
  ["a claim that payment was taken", /\bpayment\s+(has been|was)\s+(taken|received|processed)\b/i],
  ["a claim that payment was received", /\b(payment|deposit)\s+(received|confirmed|cleared)\b/i],
  ["a stock or reservation claim", /\b(reserve|reserved|in stock|out of stock|stock level)\b/i],
  ["a shipping or delivery promise", /\b(shipping|delivery)\s+(options|rates|cost|is included|within)\b/i],
  ["a tax or VAT calculation", /\b(vat|tax)\s+(calculated|added|included at)\b/i],
  ["an automated fulfilment claim", /\b(automatically|we will)\s+(dispatch|ship|fulfil|fulfill)\b/i],
] as const;

/**
 * Words that make a sentence a DENIAL rather than a claim.
 *
 * This exists because the honest disclosure and the dishonest claim share their
 * vocabulary: "no payment has been taken" and "payment has been taken" contain the
 * same four words. A scan that rejected both would force the site to stop telling
 * visitors that payment is not taken, which would be worse than the risk it guards
 * against. So a match is only reported when NO negator appears in the clause
 * leading up to it.
 */
const NO_COMMERCE_NEGATORS = /\b(no|not|never|nothing|none|cannot|can't|without|neither|nor)\b/i;

/**
 * Find a forbidden claim in a string, or null.
 *
 * A match counts only when the clause it sits in does not deny it. The clause is
 * everything after the last sentence, colon, semicolon or dash boundary before the
 * match, so a negator has to be in the SAME clause to excuse it: "there is no
 * reason to wait — add to basket" is still a claim.
 */
export function forbiddenCommerceClaimIn(
  text: string,
): { readonly label: string; readonly pattern: string } | null {
  for (const [label, pattern] of FORBIDDEN_COMMERCE_CLAIMS) {
    const match = pattern.exec(text);
    if (!match) {
      continue;
    }
    const boundary = Math.max(
      text.lastIndexOf(".", match.index),
      text.lastIndexOf(":", match.index),
      text.lastIndexOf(";", match.index),
      text.lastIndexOf("—", match.index),
      text.lastIndexOf("–", match.index),
    );
    const clause = text.slice(boundary + 1, match.index);
    if (NO_COMMERCE_NEGATORS.test(clause)) {
      continue;
    }
    return { label, pattern: pattern.source };
  }
  return null;
}
