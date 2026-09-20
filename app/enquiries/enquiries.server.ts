/**
 * Enquiry service (Slice 08) — server only.
 *
 * The single place that answers "may this enquiry be recorded, and what does it
 * contain". Routes stay thin; the checks drive this directly.
 *
 * THE WRITE PATH TAKES NO `Request`. That is the privacy design, not an
 * oversight. An enquiry is a direct customer submission rather than a tracking
 * event, so the code that validates and stores one is given the form's values and
 * nothing else: it cannot read an address from `cf-connecting-ip`, a user agent, a
 * referrer or the anonymous engagement cookie, because it never sees a request.
 * The same separation keeps the Slice 07 browser identifier out of this feature
 * entirely — it exists for like duplicate-mitigation and does not become a
 * general customer identifier here.
 *
 * WHAT THIS MODULE WILL NOT DO:
 *
 *   * it never trusts a client-supplied photograph title, slug, publication
 *     state or print-eligibility flag — the slug is RESOLVED against the
 *     database, and only the resolved id is stored;
 *   * it never treats a draft as eligible however it is marked, and never treats
 *     an ineligible photograph as available;
 *   * it never fabricates a success. With no database, or on a storage error, it
 *     reports the enquiry as NOT recorded.
 */
import {
  ENQUIRY_LIMITS,
  isEnquiryStatus,
  type EnquiryInput,
  type EnquiryStatus,
  type StoredEnquiry,
} from "./enquiry";
import { enquiryStoreFor, type EnquiryEnvironment, type EnquiryStore } from "./store.server";
import {
  formValuesFrom,
  validateEnquiry,
  type EnquiryFieldErrors,
  type EnquiryFormValues,
  type RawEnquiryInput,
} from "./validation";

/** The outcome of a submission attempt. Each failure is its own variant. */
export type EnquirySubmissionResult =
  | { readonly status: "recorded"; readonly id: string }
  | {
      readonly status: "invalid";
      readonly errors: EnquiryFieldErrors;
      readonly values: EnquiryFormValues;
    }
  | { readonly status: "unavailable" };

/** The operator's view of the enquiry list, with an explicit availability answer. */
export type EnquiryListView =
  | { readonly available: true; readonly enquiries: readonly StoredEnquiry[] }
  | { readonly available: false; readonly reason: string };

/** The outcome of a handled-state change. */
export type EnquiryStatusResult =
  | { readonly status: "ok"; readonly enquiryStatus: EnquiryStatus }
  | { readonly status: "bad-request" }
  | { readonly status: "not-found" }
  | { readonly status: "unavailable" };

/** The store, or null when this environment cannot persist an enquiry. */
function storeFor(env: EnquiryEnvironment | undefined): EnquiryStore | null {
  return enquiryStoreFor(env);
}

/**
 * Validate, resolve and store one enquiry.
 *
 * Order matters and is deliberate:
 *
 *   1. SHAPE. Required values, bounds, allow-lists and the submission token. An
 *      obviously bad submission never reaches the database.
 *   2. AUTHORITY. A print enquiry naming a photograph resolves it against the
 *      database through `eligiblePhotoFor()`. If the photograph is unknown,
 *      unpublished, in an unpublished gallery or not print-eligible, the
 *      submission is REFUSED — not silently stored without the photograph, which
 *      would leave a visitor believing they had enquired about a specific print.
 *   3. PERSISTENCE. One row, idempotent on the token.
 */
export async function submitEnquiry(
  raw: RawEnquiryInput,
  env: EnquiryEnvironment | undefined,
): Promise<EnquirySubmissionResult> {
  const validation = validateEnquiry(raw);
  if (!validation.ok) {
    return {
      status: "invalid",
      errors: validation.errors,
      values: formValuesFrom(raw),
    };
  }
  const value = validation.value;

  const store = storeFor(env);
  if (!store) {
    return { status: "unavailable" };
  }

  let photoId: string | null = null;
  if (value.photoSlug !== null) {
    let target;
    try {
      target = await store.eligiblePhotoFor(value.photoSlug);
    } catch {
      return { status: "unavailable" };
    }
    if (!target) {
      // Refused as a validation error on that field, so the visitor is told
      // which photograph could not be attached rather than losing the message.
      return {
        status: "invalid",
        errors: {
          photoSlug: "That photograph is not currently available for print enquiries.",
        },
        values: formValuesFrom(raw),
      };
    }
    photoId = target.id;
  }

  const input: EnquiryInput = {
    name: value.name,
    email: value.email,
    category: value.category,
    message: value.message,
    photoId,
    printFormat: value.printFormat,
    printSize: value.printSize,
    submissionToken: value.submissionToken,
  };

  try {
    const stored = await store.recordEnquiry(input);
    return { status: "recorded", id: stored.id };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * The enquiry list for the operator.
 *
 * Guarded by the route, not here: this module is a data service and makes no
 * authorization decision. It is nevertheless unreachable from a public route —
 * no public loader imports it — and every field it returns is one Anya needs in
 * order to reply.
 */
export async function readEnquiries(
  env: EnquiryEnvironment | undefined,
  limit: number = ENQUIRY_LIMITS.operatorList,
): Promise<EnquiryListView> {
  const store = storeFor(env);
  if (!store) {
    return {
      available: false,
      reason: "No database is configured in this environment, so enquiries cannot be read.",
    };
  }
  try {
    return { available: true, enquiries: await store.listEnquiries(limit) };
  } catch {
    return { available: false, reason: "The enquiry list could not be read." };
  }
}

/** Change an enquiry's handled state. The value is allow-listed before anything else. */
export async function updateEnquiryStatus(
  id: string,
  status: unknown,
  env: EnquiryEnvironment | undefined,
): Promise<EnquiryStatusResult> {
  if (!isEnquiryStatus(status) || typeof id !== "string" || id.length === 0 || id.length > 128) {
    return { status: "bad-request" };
  }
  const store = storeFor(env);
  if (!store) {
    return { status: "unavailable" };
  }
  try {
    const changed = await store.setEnquiryStatus(id, status);
    return changed ? { status: "ok", enquiryStatus: status } : { status: "not-found" };
  } catch {
    return { status: "unavailable" };
  }
}

/** How many enquiries sit in each handled state, for the operator dashboard. */
export async function readEnquiryCounts(
  env: EnquiryEnvironment | undefined,
): Promise<ReadonlyMap<string, number> | null> {
  const store = storeFor(env);
  if (!store) {
    return null;
  }
  try {
    return await store.statusCounts();
  } catch {
    return null;
  }
}
