/**
 * Enquiry validation (Slice 08) — pure and server-side.
 *
 * A pure module with no bindings and no request access, for two reasons:
 *
 *   1. IT IS THE ONLY SHAPE CHECK. The route hands raw form values here before
 *      anything is resolved or stored, so an overlong, malformed or invented
 *      value is refused at one place rather than defended against in several.
 *
 *   2. IT CANNOT SEE THE REQUEST. There is deliberately no `Request` parameter
 *      anywhere in this file or in the write path that uses it, so an IP
 *      address, a user agent, a referrer or the anonymous engagement cookie
 *      cannot reach a stored enquiry even by accident: the code that writes the
 *      row has no access to them.
 *
 * Shape validation only. Whether a photograph reference is PUBLIC and
 * print-ELIGIBLE is not a shape question — it is authoritative state, and the
 * server resolves it against the database in `store.server.ts`. A well-formed
 * slug here is not an approved photograph, and nothing in this module treats it
 * as one.
 */
import {
  ENQUIRY_LIMITS,
  carriesPrintPreferences,
  isEnquiryCategory,
  isPrintFormat,
  type EnquiryCategory,
  type PrintFormat,
} from "./enquiry";

/** Which field a validation message belongs to. `form` is a whole-submission error. */
export type EnquiryField =
  | "name"
  | "email"
  | "category"
  | "message"
  | "photoSlug"
  | "printFormat"
  | "printSize"
  | "submissionToken"
  | "form";

export type EnquiryFieldErrors = Partial<Record<EnquiryField, string>>;

/** What the form re-renders with when a submission is refused. */
export type EnquiryFormValues = {
  readonly name: string;
  readonly email: string;
  readonly message: string;
  readonly category: string;
  readonly photoSlug: string;
  readonly printFormat: string;
  readonly printSize: string;
  readonly submissionToken: string;
};

/** What a validated enquiry carries into the service. Not yet persisted. */
export type ValidatedEnquiry = {
  readonly name: string;
  readonly email: string;
  readonly category: EnquiryCategory;
  readonly message: string;
  /** A well-formed slug to RESOLVE, or null. Never treated as an approved photograph. */
  readonly photoSlug: string | null;
  readonly printFormat: PrintFormat | null;
  readonly printSize: string | null;
  readonly submissionToken: string;
};

export type EnquiryValidation =
  | { readonly ok: true; readonly value: ValidatedEnquiry }
  | { readonly ok: false; readonly errors: EnquiryFieldErrors };

/** The form the validation reads. Every field is raw and untrusted. */
export type RawEnquiryInput = {
  readonly name: unknown;
  readonly email: unknown;
  readonly category: unknown;
  readonly message: unknown;
  readonly photoSlug?: unknown;
  readonly printFormat?: unknown;
  readonly printSize?: unknown;
  readonly submissionToken: unknown;
};

/** A canonical slug, as `slugify()` in the repository produces. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The token shape the form issues.
 *
 * `crypto.randomUUID()` produces exactly this, so requiring it here means a
 * submission that did not come from a rendered form cannot bypass the duplicate
 * guard by omitting the token.
 */
const SUBMISSION_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Control characters, excluding tab and newline which a message may legitimately hold. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/** Read a form value as a trimmed string. Anything absent becomes an empty string. */
export function fieldText(value: unknown): string {
  if (typeof value === "string") {
    return value.replace(CONTROL_CHARACTERS, "").trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/**
 * A reasonable, deliberately conservative email check.
 *
 * It is not an RFC 5322 parser, and it does not claim to be: it requires one
 * `@`, a bounded local part, a dotted domain whose labels are legal, and an
 * alphabetic (or punycode) top-level domain. Characters that would let an
 * address smuggle a second recipient or a header break — whitespace, `,`, `;`,
 * angle brackets, quotes and backslashes — are refused outright, so a stored
 * address can never be read as more than one address.
 */
export function isValidEmailAddress(value: string): boolean {
  if (value.length === 0 || value.length > ENQUIRY_LIMITS.email) {
    return false;
  }
  if (/[\s,;<>()[\]\\"]/.test(value)) {
    return false;
  }
  const parts = value.split("@");
  if (parts.length !== 2) {
    return false;
  }
  const local = parts[0] ?? "";
  const domain = parts[1] ?? "";
  if (local.length === 0 || local.length > 64) {
    return false;
  }
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return false;
  }
  if (domain.length === 0 || domain.length > 253) {
    return false;
  }
  const labels = domain.split(".");
  if (labels.length < 2) {
    return false;
  }
  const labelPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
  if (!labels.every((label) => labelPattern.test(label))) {
    return false;
  }
  const topLevel = labels[labels.length - 1] ?? "";
  // An alphabetic TLD, or its punycode form: an internationalised domain must be
  // supplied in its ASCII encoding, which is what a mail system stores anyway.
  return /^[A-Za-z]{2,}$/.test(topLevel) || /^xn--[A-Za-z0-9-]+$/.test(topLevel);
}

/**
 * Validate a raw submission.
 *
 * Errors accumulate rather than short-circuiting, so a visitor is told everything
 * that needs fixing at once. Nothing is defaulted: an unrecognised category is an
 * error, not 'other'; an unrecognised format is an error, not 'no-preference'.
 *
 * The print-only fields are asymmetric on purpose. A PRINT enquiry may carry a
 * photograph, a format and a size. A GENERAL contact message may carry none of
 * them, and supplying one is an error rather than being silently dropped —
 * otherwise the two journeys would be distinguishable only by which fields a
 * caller happened to send.
 */
export function validateEnquiry(raw: RawEnquiryInput): EnquiryValidation {
  const errors: EnquiryFieldErrors = {};

  const name = fieldText(raw.name);
  if (name.length === 0) {
    errors.name = "Please give a name so Anya knows who is asking.";
  } else if (name.length > ENQUIRY_LIMITS.name) {
    errors.name = `Please keep the name to ${ENQUIRY_LIMITS.name} characters or fewer.`;
  }

  const email = fieldText(raw.email);
  if (email.length === 0) {
    errors.email = "Please give an email address so Anya can reply.";
  } else if (!isValidEmailAddress(email)) {
    errors.email = "That does not look like an email address. Please check it and try again.";
  }

  const message = fieldText(raw.message);
  if (message.length === 0) {
    errors.message = "Please add a short message.";
  } else if (message.length > ENQUIRY_LIMITS.message) {
    errors.message = `Please keep the message to ${ENQUIRY_LIMITS.message} characters or fewer.`;
  }

  const categoryText = fieldText(raw.category);
  const category = isEnquiryCategory(categoryText) ? categoryText : null;
  if (category === null) {
    errors.category = "Please choose what the enquiry is about.";
  }

  const token = fieldText(raw.submissionToken);
  if (!SUBMISSION_TOKEN_PATTERN.test(token)) {
    // A submission with no usable token cannot be deduplicated, so it is refused
    // rather than stored without one. Reloading the form issues a fresh token.
    errors.submissionToken = "This form has expired. Please reload the page and send it again.";
  }

  const photoSlugText = fieldText(raw.photoSlug);
  const printFormatText = fieldText(raw.printFormat);
  const printSizeText = fieldText(raw.printSize);

  let photoSlug: string | null = null;
  let printFormat: PrintFormat | null = null;
  let printSize: string | null = null;

  if (category !== null && carriesPrintPreferences(category)) {
    if (photoSlugText.length > 0) {
      if (photoSlugText.length > 120 || !SLUG_PATTERN.test(photoSlugText)) {
        errors.photoSlug = "That photograph reference is not valid.";
      } else {
        photoSlug = photoSlugText;
      }
    }
    if (printFormatText.length > 0) {
      if (!isPrintFormat(printFormatText)) {
        errors.printFormat = "Please choose one of the listed formats.";
      } else {
        printFormat = printFormatText;
      }
    }
    if (printSizeText.length > 0) {
      if (printSizeText.length > ENQUIRY_LIMITS.printSize) {
        errors.printSize = `Please keep the size preference to ${ENQUIRY_LIMITS.printSize} characters or fewer.`;
      } else {
        printSize = printSizeText;
      }
    }
  } else {
    // A general contact message must not carry print preferences. This is what
    // keeps "a print enquiry" and "a general message" distinguishable from the
    // stored row alone.
    if (photoSlugText.length > 0) {
      errors.photoSlug = "A photograph cannot be attached to this kind of enquiry.";
    }
    if (printFormatText.length > 0) {
      errors.printFormat = "A print format cannot be attached to this kind of enquiry.";
    }
    if (printSizeText.length > 0) {
      errors.printSize = "A print size cannot be attached to this kind of enquiry.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  if (category === null) {
    // Unreachable: a null category always records an error above. Stated so the
    // return type does not depend on that reasoning being remembered.
    return { ok: false, errors: { category: "Please choose what the enquiry is about." } };
  }

  return {
    ok: true,
    value: {
      name,
      email,
      category,
      message,
      photoSlug,
      printFormat,
      printSize,
      submissionToken: token.toLowerCase(),
    },
  };
}

/** The values a refused submission is re-rendered with, so nothing is retyped. */
export function formValuesFrom(raw: RawEnquiryInput): EnquiryFormValues {
  return {
    name: fieldText(raw.name),
    email: fieldText(raw.email),
    message: fieldText(raw.message),
    category: fieldText(raw.category),
    photoSlug: fieldText(raw.photoSlug),
    printFormat: fieldText(raw.printFormat),
    printSize: fieldText(raw.printSize),
    submissionToken: fieldText(raw.submissionToken),
  };
}
