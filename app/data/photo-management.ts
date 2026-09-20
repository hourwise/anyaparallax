/**
 * Photograph management vocabulary and validation (REPAIR-09B) — pure.
 *
 * Split from `photo-management.server.ts` for the reason the print-eligibility and
 * enquiry features are split the same way: the operator SCREENS need the field
 * bounds, the two state vocabularies and their labels, and those are client code. A
 * route that imported them from a `.server` module would drag the database layer
 * into the browser bundle, which React Router refuses to build — correctly.
 *
 * So this module holds everything that can be decided WITHOUT a database, and the
 * server module holds the reads and the mutations. In particular:
 *
 *   * `validatePhotoMetadata` is given the authoritative gallery and tag id sets
 *     rather than reading them, so "this gallery exists" is decided from data the
 *     caller resolved and never from submitted text;
 *   * `storageFieldsIn` names the storage-identity fields the editor must refuse;
 *   * the two state vocabularies are STRING ALLOW-LISTS. A submitted value is parsed
 *     through them or refused — never coerced, never defaulted.
 */

/**
 * Field bounds, matching the admin upload form's own limits so a value accepted at
 * upload time can always be re-saved from the editor without being refused for a
 * different reason than it was created under.
 */
export const PHOTO_FIELD_LIMITS = {
  title: 120,
  description: 600,
  location: 120,
} as const;

/** How many photographs the management list reads in one view. */
export const MANAGED_PHOTO_LIST_LIMIT = 500;

/**
 * Field names that describe STORAGE IDENTITY or pipeline-generated geometry.
 *
 * A submission carrying one is refused outright. Ignoring them silently would leave
 * an operator (or an attacker) unable to tell whether the value was honoured;
 * refusing states plainly that these are outside the editor's contract. Both the
 * database column names and their camelCase spellings are listed, because both
 * appear in this codebase's vocabulary.
 */
export const REFUSED_STORAGE_FIELDS: readonly string[] = [
  "original_storage_key",
  "web_storage_key",
  "thumbnail_storage_key",
  "originalStorageKey",
  "webStorageKey",
  "thumbnailStorageKey",
  "masterKey",
  "storageKey",
  "width",
  "height",
];

/** The explicit publication contract: a submitted string is parsed, never trusted. */
export const PUBLICATION_STATES = ["draft", "published"] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

/** The explicit featured contract. */
export const FEATURED_STATES = ["not-featured", "featured"] as const;
export type FeaturedState = (typeof FEATURED_STATES)[number];

export const PUBLICATION_STATE_LABELS: Record<PublicationState, string> = {
  draft: "Draft — not visible to visitors",
  published: "Published — visible to visitors (when its gallery is published)",
};

export const FEATURED_STATE_LABELS: Record<FeaturedState, string> = {
  "not-featured": "Not featured",
  featured: "Featured on the homepage",
};

/**
 * The list page's quick actions.
 *
 * Each names the TARGET state ("publish", "unpublish", "feature", "unfeature"), so
 * the control says what it will do rather than showing an ambiguous checkbox whose
 * meaning depends on the current value.
 */
export const PHOTO_INTENTS = ["publish", "unpublish", "feature", "unfeature"] as const;
export type PhotoIntent = (typeof PHOTO_INTENTS)[number];

export function parsePublicationState(value: unknown): boolean | null {
  if (value === "published") {
    return true;
  }
  if (value === "draft") {
    return false;
  }
  return null;
}

export function parseFeaturedState(value: unknown): boolean | null {
  if (value === "featured") {
    return true;
  }
  if (value === "not-featured") {
    return false;
  }
  return null;
}

export function parsePhotoIntent(value: unknown): PhotoIntent | null {
  return typeof value === "string" && (PHOTO_INTENTS as readonly string[]).includes(value)
    ? (value as PhotoIntent)
    : null;
}

/**
 * The intent's target state, as the two halves of the mutation contract.
 *
 * Keeping this mapping in one place means the list route cannot invent a fifth
 * meaning for an intent, and the check drives the same table the route does.
 */
export function targetStateFor(
  intent: PhotoIntent,
):
  | { readonly field: "published"; readonly value: boolean }
  | { readonly field: "featured"; readonly value: boolean } {
  switch (intent) {
    case "publish":
      return { field: "published", value: true };
    case "unpublish":
      return { field: "published", value: false };
    case "feature":
      return { field: "featured", value: true };
    default:
      return { field: "featured", value: false };
  }
}

/** One photograph as the management list shows it. */
export type ManagedPhotoSummary = {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly galleryId: string;
  readonly galleryName: string;
  /** Whether the photograph's gallery is published; the second half of visibility. */
  readonly galleryPublished: boolean;
  readonly published: boolean;
  readonly featured: boolean;
  /** Shown for operator context; the print flow itself lives in `/admin/prints`. */
  readonly printAvailable: boolean;
  readonly updatedAt: string;
  /**
   * Publicly visible = the photograph is published AND its gallery is published.
   * Derived here so an operator is never told a photograph is live while the gallery
   * rule is keeping it off the site.
   */
  readonly publiclyVisible: boolean;
};

/** One photograph as the editor needs it: the summary plus the editable fields. */
export type ManagedPhotoDetail = ManagedPhotoSummary & {
  readonly description: string;
  readonly location: string | null;
  readonly captureDate: string | null;
  readonly tags: readonly string[];
};

/** A gallery the editor may file a photograph into. */
export type GalleryOption = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly published: boolean;
};

/** Per-field validation messages, so a refusal says which field needs attention. */
export type PhotoField =
  | "title"
  | "description"
  | "location"
  | "captureDate"
  | "galleryId"
  | "tags"
  | "form";

export type PhotoFieldErrors = Partial<Record<PhotoField, string>>;

export type PhotoMetadataInput = {
  readonly title: unknown;
  readonly description: unknown;
  readonly location: unknown;
  readonly captureDate: unknown;
  readonly galleryId: unknown;
  readonly tags: readonly unknown[];
};

/**
 * The editor form's whole contract.
 *
 * The two state fields arrive as PARSED booleans: the route reads the submitted
 * strings through {@link parsePublicationState} and {@link parseFeaturedState}, so a
 * value this application does not understand can never reach a statement. They belong
 * to this input — rather than to three separate calls — so that saving the editor
 * form is ONE transaction: there is no state in which the metadata saved and the
 * publication change did not.
 */
export type PhotoEditInput = PhotoMetadataInput & {
  readonly published: boolean;
  readonly featured: boolean;
};

export type ValidatedPhotoMetadata = {
  readonly title: string;
  readonly description: string;
  readonly location: string | null;
  readonly captureDate: string | null;
  readonly galleryId: string;
  readonly tags: readonly string[];
};

export type PhotoMetadataValidation =
  | { readonly ok: true; readonly value: ValidatedPhotoMetadata }
  | { readonly ok: false; readonly errors: PhotoFieldErrors };

/** The outcome of a mutation. `ok` carries the state READ BACK from the database. */
export type PhotoMutationResult =
  | { readonly status: "ok"; readonly persisted: ManagedPhotoSummary }
  | { readonly status: "invalid"; readonly errors: PhotoFieldErrors }
  | { readonly status: "bad-request"; readonly errors: PhotoFieldErrors }
  | { readonly status: "not-found" }
  | { readonly status: "unavailable"; readonly reason: string };

/** Control characters, excluding tab and newline which a description may hold. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/** Read a form value as a trimmed string, with control characters removed. */
function fieldText(value: unknown): string {
  return typeof value === "string" ? value.replace(CONTROL_CHARACTERS, "").trim() : "";
}

/** An ISO `YYYY-MM-DD` date that is also a real calendar date. */
export function isValidCaptureDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day || month > 12 || day > 31) {
    return false;
  }
  // The round-trip rejects impossible days such as 2026-02-30, and also rejects a
  // year JavaScript would silently relocate (00–99 map to 1900+).
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Validate the editable metadata.
 *
 * An unrecognised value is refused: nothing is coerced, defaulted or dropped
 * silently. Tags are deduplicated and sorted, so the read-back comparison cannot be
 * confused by submission order and a repeated tag cannot reach the junction table's
 * primary key.
 */
export function validatePhotoMetadata(
  input: PhotoMetadataInput,
  options: { readonly galleryIds: readonly string[]; readonly tagIds: readonly string[] },
): PhotoMetadataValidation {
  const errors: PhotoFieldErrors = {};

  const title = fieldText(input.title);
  if (title.length === 0) {
    errors.title = "A photograph must have a title.";
  } else if (title.length > PHOTO_FIELD_LIMITS.title) {
    errors.title = `Please keep the title to ${PHOTO_FIELD_LIMITS.title} characters or fewer.`;
  }

  const description = fieldText(input.description);
  if (description.length > PHOTO_FIELD_LIMITS.description) {
    errors.description = `Please keep the description to ${PHOTO_FIELD_LIMITS.description} characters or fewer.`;
  }

  const location = fieldText(input.location);
  if (location.length > PHOTO_FIELD_LIMITS.location) {
    errors.location = `Please keep the location to ${PHOTO_FIELD_LIMITS.location} characters or fewer.`;
  }

  const captureDate = fieldText(input.captureDate);
  if (captureDate.length > 0 && !isValidCaptureDate(captureDate)) {
    errors.captureDate = "A capture date must be a real date in YYYY-MM-DD form.";
  }

  const galleryId = fieldText(input.galleryId);
  if (galleryId.length === 0) {
    errors.galleryId = "Please choose the gallery this photograph belongs to.";
  } else if (!options.galleryIds.includes(galleryId)) {
    errors.galleryId = "That gallery does not exist.";
  }

  const requested = [...new Set(input.tags.map(fieldText).filter((tag) => tag.length > 0))].sort();
  if (requested.some((tag) => !options.tagIds.includes(tag))) {
    errors.tags = "One or more of the selected tags no longer exists.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      title,
      description,
      location: location.length > 0 ? location : null,
      captureDate: captureDate.length > 0 ? captureDate : null,
      galleryId,
      tags: requested,
    },
  };
}

/**
 * Refuse a submission that names storage identity or pipeline geometry.
 *
 * Returns the offending field names, or an empty list. The caller applies this before
 * any other work, so such a submission cannot even cause a read.
 */
export function storageFieldsIn(form: { has(name: string): boolean }): readonly string[] {
  return REFUSED_STORAGE_FIELDS.filter((name) => form.has(name));
}
