/**
 * Tag vocabulary and validation — pure.
 *
 * Tags are the only taxonomy V1 has: a flat list an operator can put on a photograph.
 * Production starts with none, so — like galleries — this is the difference between
 * Anya tagging her own work and needing a developer.
 *
 * The slug rule is deliberately the SAME rule galleries use (`slugifyGalleryName`):
 * one definition of "a URL-safe slug from a human name" in this application, so the
 * two cannot drift into disagreeing about what `Café` becomes.
 */
import { slugifyGalleryName, uniqueSlug } from "./gallery-management";

export const TAG_FIELD_LIMITS = { name: 40 } as const;

export const TAG_INTENTS = ["create", "rename", "delete"] as const;
export type TagIntent = (typeof TAG_INTENTS)[number];

export function parseTagIntent(value: unknown): TagIntent | null {
  return typeof value === "string" && (TAG_INTENTS as readonly string[]).includes(value)
    ? (value as TagIntent)
    : null;
}

export function slugifyTagName(name: string): string {
  return slugifyGalleryName(name);
}

export function uniqueTagSlug(base: string, taken: readonly string[]): string {
  return uniqueSlug(base, taken);
}

export type TagValidation =
  | { readonly ok: true; readonly name: string; readonly slug: string }
  | { readonly ok: false; readonly error: string };

/** Tag names are required, bounded, and never only punctuation. */
export function validateTagName(value: unknown): TagValidation {
  const name =
    typeof value === "string"
      ? // eslint-disable-next-line no-control-regex
        value.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
      : "";
  if (name.length === 0) {
    return { ok: false, error: "Give the tag a name." };
  }
  if (name.length > TAG_FIELD_LIMITS.name) {
    return { ok: false, error: `Keep the tag to ${TAG_FIELD_LIMITS.name} characters or fewer.` };
  }
  return { ok: true, name, slug: slugifyTagName(name) };
}
