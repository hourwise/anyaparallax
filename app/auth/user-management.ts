/**
 * Authorised-account vocabulary — pure.
 *
 * The application's `users` table decides what an Access-authenticated person may do.
 * This module owns the words and the shape of that decision; the database work lives
 * in `user-management.server.ts`.
 *
 * THE RULE THAT MATTERS MOST: an application user row is an AUTHORISATION, never an
 * authentication. Cloudflare Access decides who somebody is, and a row here decides
 * what that proven identity may do. Adding a row for somebody Access would never admit
 * changes nothing at all, which is why this screen says so plainly.
 */
import { normaliseEmail } from "./identity";

export const ACCOUNT_ROLES = ["photographer", "manager"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/**
 * Which area each role reaches.
 *
 * `authorization.server.ts` remains the ENFORCING authority — these guards are what
 * actually deny a request — and this map only lets a screen describe a role truthfully
 * without importing server code into a component. The served check asserts the two
 * agree, so a future role added to the guards cannot silently be described wrongly
 * here.
 */
export const ROLE_AREAS: Record<AccountRole, { readonly admin: boolean; readonly manager: boolean }> = {
  photographer: { admin: true, manager: false },
  manager: { admin: true, manager: true },
};

export const ROLE_LABELS: Record<AccountRole, string> = {
  photographer: "Photographer — uploads, edits and publishes photographs",
  manager: "Manager — everything a photographer can do, plus users, maintenance and diagnostics",
};

export const USER_INTENTS = ["create", "role", "activate", "deactivate"] as const;
export type UserIntent = (typeof USER_INTENTS)[number];

export function parseUserIntent(value: unknown): UserIntent | null {
  return typeof value === "string" && (USER_INTENTS as readonly string[]).includes(value)
    ? (value as UserIntent)
    : null;
}

export function parseAccountRole(value: unknown): AccountRole | null {
  return typeof value === "string" && (ACCOUNT_ROLES as readonly string[]).includes(value)
    ? (value as AccountRole)
    : null;
}

export type UserValidation =
  | { readonly ok: true; readonly email: string; readonly role: AccountRole }
  | { readonly ok: false; readonly error: string };

/**
 * Validate a new authorised account.
 *
 * The email goes through the SAME normalisation the authentication boundary uses, so
 * the address stored here is the address an Access assertion will be compared against:
 * one rule, in one place, or an operator could add an account that can never match.
 */
export function validateNewUser(email: unknown, role: unknown): UserValidation {
  const normalised = normaliseEmail(email);
  if (normalised === null) {
    return { ok: false, error: "Enter a full email address, for example name@example.com." };
  }
  const parsed = parseAccountRole(role);
  if (parsed === null) {
    return { ok: false, error: "Choose either the photographer or the manager role." };
  }
  return { ok: true, email: normalised, role: parsed };
}

/** True when the role may reach the manager area. */
export function roleReachesManager(role: AccountRole): boolean {
  return ROLE_AREAS[role].manager;
}

/** True when the role may reach the admin area. */
export function roleReachesAdmin(role: AccountRole): boolean {
  return ROLE_AREAS[role].admin;
}
