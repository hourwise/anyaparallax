/**
 * Engagement identifier shape (Slice 07).
 *
 * Pure and shared by both sides of the wire, so the browser and the server agree
 * on what a valid identifier looks like without the validation rule living in a
 * client component.
 *
 * The accepted shape is exactly what `crypto.randomUUID()` produces and nothing
 * else: eight, four, four, four and twelve lowercase hexadecimal digits. Being
 * strict here is the point — a cookie that does not match cannot have been issued
 * by this application, so it must not be adopted or hashed into the database.
 */

/** A version-4 UUID in its canonical lowercase form. */
const IDENTIFIER_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isEngagementIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}
