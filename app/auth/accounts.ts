/**
 * Account identity rules — the shared vocabulary of the authorised-user
 * directory (Slice 05 repair 01).
 *
 * An email address is an IDENTITY in this application, not an opaque key: the
 * authentication boundary normalises it, and exactly one account row must
 * answer for it. Two places must agree on that, or authority becomes ambiguous:
 *
 *   * the DATABASE — `migrations/0002_user_email_identity_uniqueness.sql`
 *     creates a unique NOCASE index, so a case variant of an authorised address
 *     cannot become a second row;
 *   * the APPLICATION — `accounts.server.ts` compares the stored column using
 *     the SAME collation (`COLLATE NOCASE`) and takes at most two rows, so the
 *     lookup uses the index, agrees with the index's rule, and can detect the
 *     forbidden state instead of assuming it away.
 *
 * This module is pure (no bindings, no environment, no React Router) so the
 * rule can be asserted directly from a check script and reused by any future
 * account source.
 */
import { isAppRole, type UserRecord } from "../data/model";
import { normaliseEmail } from "./identity";

/**
 * The largest number of rows the lookup may read. Two is enough to tell "one
 * identity" from "more than one", and reading two rows is what makes the
 * ambiguous state detectable at all.
 */
export const ACCOUNT_IDENTITY_ROW_LIMIT = 2;

/**
 * The account query.
 *
 * `email COLLATE NOCASE = ?1` is deliberately written with the collation on the
 * STORED COLUMN rather than as `lower(email) = ?1`:
 *
 *   * it indexes — `idx_users_email_identity_nocase` on `(email COLLATE NOCASE)`
 *     can satisfy the comparison directly, whereas wrapping the column in
 *     `lower()` makes the index unusable and forces a scan of every account;
 *   * it agrees with the uniqueness invariant — the index and the comparison
 *     use one collation, so the lookup cannot see a different set of rows than
 *     the constraint permits.
 *
 * The bound parameter is the normalised (lower-cased) address; NOCASE folding
 * makes the comparison match any stored case. The subquery is limited to
 * {@link ACCOUNT_IDENTITY_ROW_LIMIT} rows and selects `email` so the outer
 * projection names its columns as `users` does, which keeps the row mapper
 * identical for both account sources.
 */
export const ACCOUNT_BY_EMAIL_SQL =
  "SELECT id, email, role, active, created_at, updated_at FROM users " +
  `WHERE email IN (SELECT email FROM users WHERE email COLLATE NOCASE = ?1 LIMIT ${ACCOUNT_IDENTITY_ROW_LIMIT})`;

/** A `users` row as read from D1, or as held in the development seed set. */
export type AccountRow = {
  readonly id?: unknown;
  readonly email?: unknown;
  readonly role?: unknown;
  readonly active?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
};

/**
 * Map a `users` row defensively: a malformed or unexpected row is not an account.
 */
export function toUserRecord(row: AccountRow): UserRecord | null {
  if (typeof row.id !== "string" || typeof row.email !== "string") {
    return null;
  }
  if (!isAppRole(row.role)) {
    return null;
  }
  const email = normaliseEmail(row.email);
  if (email === null) {
    return null;
  }
  return {
    id: row.id,
    email,
    role: row.role,
    // D1 returns INTEGER 0/1; the harness and the seed set may use booleans.
    active: row.active === 1 || row.active === true,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

/**
 * The account a list of candidate users holds for one NORMALISED identity.
 *
 * This is the rule every account source applies: `users.filter(matches)` then
 * exactly one account, or none. It takes the identity already normalised, so a
 * caller cannot accidentally compare unnormalised text; `soleAccount` remains
 * the final authority on whether the result is usable.
 */
export function accountForIdentity(
  users: readonly UserRecord[],
  email: string,
): UserRecord | null {
  const matches = users.filter((user) => normaliseEmail(user.email) === email);
  return soleAccount(matches);
}

/**
 * The account for one identity, from the rows a source returned for it.
 *
 * Fails closed. An identity resolves to an account ONLY when exactly one usable
 * row answers for it:
 *
 * * zero rows            → unknown identity → `null`, and the guard denies;
 * * more than one row    → AMBIGUOUS identity → `null`, and the guard denies.
 *   The unique NOCASE index should make this unreachable; it is checked anyway
 *   because reading one arbitrary row would silently grant whichever role
 *   happened to sort first, which is exactly the failure this repair removes;
 * * one row that is not a usable account (bad role, unusable email) → `null`.
 *
 * A denial must never depend on row ordering, so this function never picks a
 * row out of a set of candidates.
 */
export function soleAccount(rows: readonly AccountRow[] | undefined): UserRecord | null {
  if (!rows || rows.length !== 1) {
    return null;
  }
  const [row] = rows;
  return row ? toUserRecord(row) : null;
}
