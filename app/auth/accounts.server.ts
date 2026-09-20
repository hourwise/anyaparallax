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
 */
import type { AppBindings } from "../data/context";
import { isAppRole, type UserRecord } from "../data/model";
import type { D1DatabaseBinding } from "../data/repository.d1.server";
import { seed } from "../data/seed";
import { normaliseEmail } from "./identity";

/** The environment values the directory reads. */
export type AccountEnvironment = Pick<AppBindings, "DB" | "ALLOW_DEVELOPMENT_SEED">;

type UserRow = {
  id?: unknown;
  email?: unknown;
  role?: unknown;
  active?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

/** Map a `users` row defensively: a malformed or unexpected row is not an account. */
function toUserRecord(row: UserRow): UserRecord | null {
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
    // D1 returns INTEGER 0/1; the harness may return booleans.
    active: row.active === 1 || row.active === true,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

function isD1Binding(value: unknown): value is D1DatabaseBinding {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { prepare?: unknown }).prepare === "function"
  );
}

async function findAccountInD1(
  db: D1DatabaseBinding,
  email: string,
): Promise<UserRecord | null> {
  const result = await db
    .prepare(
      "SELECT id, email, role, active, created_at, updated_at FROM users WHERE lower(email) = ?1 LIMIT 1",
    )
    .bind(email)
    .all<UserRow>();
  const row = result.results?.[0];
  return row ? toUserRecord(row) : null;
}

function findAccountInSeed(email: string): UserRecord | null {
  return seed.users.find((user) => normaliseEmail(user.email) === email) ?? null;
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
    .all<UserRow>();
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
