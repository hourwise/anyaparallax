/**
 * Print eligibility vocabulary (Slice 08) — pure.
 *
 * `photos.print_available` has existed since migration 0001, and the public
 * projection has carried `printAvailable` since Slice 03. What Slice 08 adds is
 * the EDITORIAL DECISION: an operator surface that can set the flag on a
 * photograph that is already stored, rather than only while uploading it.
 *
 * Two invariants are stated here because both are easy to get wrong and both are
 * checked:
 *
 *   1. ELIGIBILITY IS NEVER PUBLICATION. Setting the flag changes one column and
 *      nothing else. A draft with the flag set stays a draft, publicly invisible
 *      and unreachable through the enquiry form.
 *   2. ELIGIBILITY IS NEVER INFERRED. It is not derived from the presence of an
 *      original, from a master key, from publication, or from any default: it is
 *      a stored decision that defaults to false.
 */

/** One photograph as the eligibility surface shows it. */
export type PhotoPrintOption = {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  /** Publication state, shown so eligibility cannot be mistaken for visibility. */
  readonly published: boolean;
  readonly printAvailable: boolean;
};

/** The eligibility list, with an explicit availability answer. */
export type PrintEligibilityView =
  | { readonly available: true; readonly photos: readonly PhotoPrintOption[] }
  | { readonly available: false; readonly reason: string };

/** The outcome of a print-eligibility change. */
export type PrintEligibilityResult =
  | { readonly status: "ok"; readonly printAvailable: boolean }
  | { readonly status: "bad-request" }
  | { readonly status: "not-found" }
  | { readonly status: "unavailable" };

/** How many photographs the operator surface reads in one view. */
export const PRINT_ELIGIBILITY_LIST_LIMIT = 500;
