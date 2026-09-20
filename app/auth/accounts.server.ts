/**
 * Authorised-user directory — the application half of the Slice 05 boundary.
 *
 * Cloudflare Access proves WHO a request is (`identity.server.ts`); this module
 * answers what that identity may do: is the email an application user, is the
 * account active, and which role does it hold? Roles come from the database
 * only. A request can never declare, hint at or upgrade its own role.
 *
 * Source selection mirrors `app/data/queries.ts`:
 *
 *   D1 binding present        → the `users` table (the real store)
 *   no binding + seed allowed → the development seed users (local only)
 *   neither                   → throws; a deployment that cannot consult the
 *                               directory denies loudly instead of guessing
 *                               that an identity might be authorised
 *
 * Server-only: accounts contain personal data (email addresses) and must never
 * reach a public loader payload or the client bundle. Only the authenticated
 * `/admin` and `/manager` surfaces display them, and only to their operator.
 *
 * Identity uniqueness (Slice 05 repair 01): an email address denotes exactly one
 * account, and a case variant of it is the same identity. The database refuses
 * a second row under a unique NOCASE index
 * (`migrations/0002_user_email_identity_uniqueness.sql`), and both lookups here
 * apply the matching rule from `accounts.ts` — the same collation for the
 * comparison, and a fail-closed refusal to answer when more than one row
 * answers for one identity.
 */
import type { AppBindings } from "../data/context";
import type { UserRecord } from "../data/model";
import type { D1DatabaseBinding } from "../data/repository.d1.server";
import { seed } from "../data/seed";
import {
  ACCOUNT_BY_EMAIL_SQL,
  accountForIdentity,
  soleAccount,
  toUserRecord,
  type AccountRow,
} from "./accounts";
import { normaliseEmail } from "./identity";

/** The environment values the directory reads. */
export type AccountEnvironment = Pick<AppBindings, "DB" | "ALLOW_DEVELOPMENT_SEED">;

function isD1Binding(value: unknown): value is D1DatabaseBinding {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { prepare?: unknown }).prepare === "function"
  );
}

/**
 * Resolve an identity through D1.
 *
 * The comparison collation and the row limit come from `accounts.ts` so the
 * lookup and the database's uniqueness invariant cannot drift apart: the query
 * is index-backed and case-insensitive, and reading up to two rows lets an
 * ambiguous directory fail closed (see `soleAccount`) instead of answering with
 * an arbitrary role.
 */
async function findAccountInD1(
  db: D1DatabaseBinding,
  email: string,
): Promise<UserRecord | null> {
  const result = await db
    .prepare(ACCOUNT_BY_EMAIL_SQL)
    .bind(email)
    .all<AccountRow>();
  return soleAccount(result.results);
}

/**
 * Resolve an identity through the development seed users.
 *
 * The seed set is another account source and obeys the same rule as the table
 * (`accountForIdentity`): an identity resolves only when exactly one seed user
 * matches, so a duplicate can never make local authority depend on array order.
 */
function findAccountInSeed(email: string): UserRecord | null {
  return accountForIdentity(seed.users, email);
}

/**
 * Look up an account by email, active or not.
 *
 * Returns null when the email cannot be an address or is not a known user.
 * Activity is deliberately NOT filtered here: the guard denies inactive
 * accounts explicitly, and the Manager surface must be able to list them.
 */
export async function findAccountByEmail(
  email: unknown,
  env: AccountEnvironment | undefined,
): Promise<UserRecord | null> {
  const normalised = normaliseEmail(email);
  if (normalised === null) {
    return null;
  }
  if (isD1Binding(env?.DB)) {
    return findAccountInD1(env.DB, normalised);
  }
  if (env?.ALLOW_DEVELOPMENT_SEED === "true") {
    return findAccountInSeed(normalised);
  }
  throw new Error(
    "The authorised-user directory is unavailable: no D1 binding and " +
      "ALLOW_DEVELOPMENT_SEED is not enabled. Deny-by-default requires a real " +
      "user source; configure the DB binding in wrangler.jsonc.",
  );
}

async function listAccountsInD1(db: D1DatabaseBinding): Promise<readonly UserRecord[]> {
  const result = await db
    .prepare(
      "SELECT id, email, role, active, created_at, updated_at FROM users ORDER BY role ASC, email ASC",
    )
    .all<AccountRow>();
  return (result.results ?? [])
    .map(toUserRecord)
    .filter((account): account is UserRecord => account !== null);
}

function listAccountsInSeed(): readonly UserRecord[] {
  return [...seed.users].sort((left, right) =>
    left.role === right.role
      ? left.email.localeCompare(right.email)
      : left.role.localeCompare(right.role),
  );
}

/** Every authorised account, managers first, then email order. Manager surface only. */
export async function listAccounts(
  env: AccountEnvironment | undefined,
): Promise<readonly UserRecord[]> {
  if (isD1Binding(env?.DB)) {
    return listAccountsInD1(env.DB);
  }
  if (env?.ALLOW_DEVELOPMENT_SEED === "true") {
    return listAccountsInSeed();
  }
  throw new Error(
    "The authorised-user directory is unavailable: no D1 binding and " +
      "ALLOW_DEVELOPMENT_SEED is not enabled.",
  );
}
