/**
 * Gallery management vocabulary and validation — pure.
 *
 * The operator screens need these bounds and parsers, and a route module must not
 * import a `.server` module into client code, so everything here is a pure function
 * over plain values. The database work lives in `gallery-management.server.ts`.
 *
 * WHY THIS EXISTS. Production starts with zero galleries and a photograph belongs to
 * one, so without this surface Anya cannot put a single photograph on the site
 * without a developer. The schema already supported all of it (`name`, `slug`,
 * `description`, `cover_photo_id`, `display_order`, `published`); what was missing was
 * a server-side contract and a screen.
 *
 * The validation is AUTHORITATIVE and mirrors what the form asks for, because a form
 * attribute is a convenience for the browser and never a rule the server can rely on.
 */
import { isValidCaptureDate } from "./photo-management";

export { isValidCaptureDate };

/** Field bounds, in code points, matching the form's `maxLength` attributes. */
export const GALLERY_FIELD_LIMITS = {
  name: 80,
  description: 600,
} as const;

/** Longest slug this application will generate or accept. */
export const MAX_GALLERY_SLUG_LENGTH = 60;

/** Display order is a plain integer so ordering is deterministic and explainable. */
export const MAX_GALLERY_ORDER = 9999;

/** Every gallery the management list will read in one request. */
export const MANAGED_GALLERY_LIST_LIMIT = 500;

export const PUBLICATION_STATES = ["draft", "published"] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

export const PUBLICATION_STATE_LABELS: Record<PublicationState, string> = {
  draft: "Draft — not visible on the public site",
  published: "Published — visible on the public site when it holds a published photograph",
};

/** The submitted actions this screen understands, as an explicit allow-list. */
export const GALLERY_INTENTS = [
  "create",
  "update",
  "publish",
  "unpublish",
  "cover",
  "clear-cover",
  "order",
] as const;
export type GalleryIntent = (typeof GALLERY_INTENTS)[number];

export function parseGalleryIntent(value: unknown): GalleryIntent | null {
  return typeof value === "string" && (GALLERY_INTENTS as readonly string[]).includes(value)
    ? (value as GalleryIntent)
    : null;
}

export function parsePublicationState(value: unknown): boolean | null {
  if (value === "published") {
    return true;
  }
  if (value === "draft") {
    return false;
  }
  return null;
}

/**
 * A display order, or null when the submitted value is not one.
 *
 * Only a plain non-negative integer inside the bound is accepted: a blank field means
 * "not supplied" to the caller rather than silently becoming zero, and a fraction,
 * a negative number or text is a refusal.
 */
export function parseDisplayOrder(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_GALLERY_ORDER) {
    return null;
  }
  return parsed;
}

/**
 * A URL-safe slug from a gallery name.
 *
 * Diacritics are folded rather than dropped (`Café` → `cafe`), everything outside
 * ASCII letters, digits and single hyphens becomes a hyphen, and runs collapse. The
 * result is never empty: a name made entirely of punctuation yields `gallery`, and
 * the caller appends a numeric suffix when the slug is taken.
 */
export function slugifyGalleryName(name: string): string {
  const folded = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const slug = folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_GALLERY_SLUG_LENGTH)
    .replace(/-$/, "");
  return slug.length > 0 ? slug : "gallery";
}

/**
 * The first free slug for a base, appending `-2`, `-3`, … as needed.
 *
 * Collision handling is here rather than in the database because the useful outcome
 * is a created gallery with a predictable URL, not a uniqueness error the operator has
 * to resolve by hand. `taken` must be the CURRENT set of slugs.
 */
export function uniqueSlug(base: string, taken: readonly string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) {
    return base;
  }
  for (let suffix = 2; suffix <= used.size + 2; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function isSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_GALLERY_SLUG_LENGTH &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}

export type GalleryField = "name" | "slug" | "description" | "displayOrder" | "coverPhotoId";
export type GalleryFieldErrors = Partial<Record<GalleryField, string>>;

export type GalleryInput = {
  readonly name: string;
  readonly description: string;
  readonly displayOrder: string;
  readonly published: boolean;
};

export type ValidatedGallery = {
  readonly name: string;
  readonly description: string;
  readonly displayOrder: number;
  readonly published: boolean;
};

export type GalleryValidation =
  | { readonly ok: true; readonly gallery: ValidatedGallery }
  | { readonly ok: false; readonly errors: GalleryFieldErrors };

/** Control characters are stripped, then the value is trimmed — never silently padded. */
export function fieldText(value: unknown): string {
  return typeof value === "string"
    ? // eslint-disable-next-line no-control-regex
      value.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
    : "";
}

/**
 * Validate a gallery submission.
 *
 * A gallery NAME is required; its slug is derived from the name on creation and is
 * never re-derived on an edit, because a stable public URL matters more than a slug
 * that tracks a rename. `displayOrder` may be blank, which means "append": the caller
 * supplies the next free order in that case.
 */
export function validateGallery(input: GalleryInput): GalleryValidation {
  const errors: GalleryFieldErrors = {};
  const name = fieldText(input.name);
  const description = fieldText(input.description);

  if (name.length === 0) {
    errors.name = "Give the gallery a name.";
  } else if (name.length > GALLERY_FIELD_LIMITS.name) {
    errors.name = `Keep the name to ${GALLERY_FIELD_LIMITS.name} characters or fewer.`;
  }
  if (description.length > GALLERY_FIELD_LIMITS.description) {
    errors.description = `Keep the description to ${GALLERY_FIELD_LIMITS.description} characters or fewer.`;
  }

  const order = parseDisplayOrder(input.displayOrder);
  if (input.displayOrder.trim() !== "" && order === null) {
    errors.displayOrder = `Use a whole number between 0 and ${MAX_GALLERY_ORDER}.`;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    gallery: {
      name,
      description,
      displayOrder: order ?? 0,
      published: input.published,
    },
  };
}
