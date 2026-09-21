/**
 * Authorised-account management — server only.
 *
 * The manager-only screen for the `users` table: who may use the operator areas, with
 * which role, and whether the account is active. Nothing here authenticates anybody.
 *
 * THE TWO RULES THIS MODULE EXISTS TO ENFORCE
 *
 *   1. AN APPLICATION ROW IS NOT AN IDENTITY. Cloudflare Access proves who a person is;
 *      a row here only decides what that proven identity may do. Adding an address that
 *      Access would never admit grants nothing, and removing every row would not open
 *      the operator areas — the guards deny on their own.
 *   2. THERE MUST ALWAYS BE ONE ACTIVE MANAGER. The check is made against the CURRENT
 *      table state inside the same call as the write, so the last active manager cannot
 *      be deactivated or demoted — including by that manager acting on their own row.
 *      A locked-out workspace would need database intervention to recover, which is
 *      exactly what V1 must not require.
 *
 * No password, token or credential is stored or read: accounts here are email addresses
 * and roles, and authentication stays entirely with Access.
 */
import { isD1Binding, type D1DatabaseBinding } from "../data/repository.d1.server";
import { validateNewUser, type AccountRole } from "./user-management";

export type UserManagementEnvironment = { readonly DB?: unknown };

export type ManagedUser = {
  readonly id: string;
  readonly email: string;
  readonly role: AccountRole;
  readonly active: boolean;
  readonly updatedAt: string;
};

export type ManagedUsersView =
  | { readonly available: true; readonly users: readonly ManagedUser[] }
  | { readonly available: false; readonly reason: string };

export type UserMutationResult =
  | { readonly status: "ok"; readonly persisted: ManagedUser }
  | { readonly status: "not-found" }
  | { readonly status: "duplicate"; readonly email: string }
  | { readonly status: "bad-request"; readonly error: string }
  | { readonly status: "last-manager" }
  | { readonly status: "unavailable"; readonly reason: string };

type UserRow = {
  id: string;
  email: string;
  role: string;
  active: number;
  updated_at: string;
};

const USER_COLUMNS = "id, email, role, active, updated_at";

function toUser(row: UserRow): ManagedUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role === "manager" ? "manager" : "photographer",
    active: row.active === 1,
    updatedAt: row.updated_at,
  };
}

export class UserManager {
  readonly #db: D1DatabaseBinding;

  constructor(db: D1DatabaseBinding) {
    this.#db = db;
  }

  async list(): Promise<readonly ManagedUser[]> {
    const { results } = await this.#db
      .prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY active DESC, email ASC LIMIT 200`)
      .all<UserRow>();
    return (results ?? []).map(toUser);
  }

  async read(id: string): Promise<ManagedUser | null> {
    const { results } = await this.#db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ? LIMIT 1`)
      .bind(id)
      .all<UserRow>();
    const row = results?.[0];
    return row ? toUser(row) : null;
  }

  /**
   * Would this change remove the last active manager?
   *
   * Asked BEFORE the write, against the current rows, and the change is refused rather
   * than repaired afterwards.
   */
  async #wouldRemoveLastManager(id: string, next: { role: AccountRole; active: boolean }): Promise<boolean> {
    const users = await this.list();
    const activeManagersAfter = users.filter((user) =>
      user.id === id ? next.active && next.role === "manager" : user.active && user.role === "manager",
    );
    return activeManagersAfter.length === 0;
  }

  /** Add an authorised address. The email is normalised by the shared identity rule. */
  async create(email: unknown, role: unknown): Promise<UserMutationResult> {
    const validation = validateNewUser(email, role);
    if (!validation.ok) {
      return { status: "bad-request", error: validation.error };
    }
    const existing = await this.#db
      .prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE LIMIT 1")
      .bind(validation.email)
      .all<{ id: string }>();
    if ((existing.results ?? []).length > 0) {
      return { status: "duplicate", email: validation.email };
    }
    const id = `user-${validation.email.split("@")[0]?.replace(/[^a-z0-9]+/g, "-") ?? "account"}`;
    const now = new Date().toISOString();
    try {
      await this.#db
        .prepare(
          "INSERT INTO users (id, email, role, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
        )
        .bind(id, validation.email, validation.role, now, now)
        .run();
    } catch {
      // The unique index is the authority on duplicate identity; a race lands here.
      return { status: "duplicate", email: validation.email };
    }
    const persisted = await this.read(id);
    return persisted
      ? { status: "ok", persisted }
      : { status: "unavailable", reason: "The account could not be read back after saving." };
  }

  async setRole(id: string, role: unknown): Promise<UserMutationResult> {
    const existing = await this.read(id);
    if (!existing) {
      return { status: "not-found" };
    }
    const parsed = role === "manager" || role === "photographer" ? role : null;
    if (parsed === null) {
      return { status: "bad-request", error: "Choose either the photographer or the manager role." };
    }
    if (await this.#wouldRemoveLastManager(id, { role: parsed, active: existing.active })) {
      return { status: "last-manager" };
    }
    return this.#update(id, "role = ?", [parsed]);
  }

  async setActive(id: string, active: boolean): Promise<UserMutationResult> {
    const existing = await this.read(id);
    if (!existing) {
      return { status: "not-found" };
    }
    if (await this.#wouldRemoveLastManager(id, { role: existing.role, active })) {
      return { status: "last-manager" };
    }
    return this.#update(id, "active = ?", [active ? 1 : 0]);
  }

  async #update(id: string, assignment: string, values: readonly unknown[]): Promise<UserMutationResult> {
    await this.#db
      .prepare(`UPDATE users SET ${assignment}, updated_at = ? WHERE id = ?`)
      .bind(...values, new Date().toISOString(), id)
      .run();
    const persisted = await this.read(id);
    return persisted
      ? { status: "ok", persisted }
      : { status: "unavailable", reason: "The account could not be read back after saving." };
  }
}

export function userManagerFor(env: UserManagementEnvironment | undefined): UserManager | null {
  const db = env?.DB;
  if (!isD1Binding(db)) {
    return null;
  }
  return new UserManager(db);
}

export async function managedUsersView(
  env: UserManagementEnvironment | undefined,
): Promise<ManagedUsersView> {
  const manager = userManagerFor(env);
  if (!manager) {
    return {
      available: false,
      reason:
        "No database is configured in this environment, so the authorised-account list is unavailable.",
    };
  }
  return { available: true, users: await manager.list() };
}
