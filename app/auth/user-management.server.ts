/**
 * Authorised-account management — server only.
 *
 * The manager-only screen for the `users` table: who may use the operator areas, with
 * which role, and whether the account is active. Nothing here authenticates anybody.
 *
 * THE THREE RULES THIS MODULE EXISTS TO ENFORCE
 *
 *   1. AN APPLICATION ROW IS NOT AN IDENTITY. Cloudflare Access proves who a person is;
 *      a row here only decides what that proven identity may do. Adding an address that
 *      Access would never admit grants nothing, and removing every row would not open
 *      the operator areas — the guards deny on their own.
 *   2. THERE MUST ALWAYS BE ONE ACTIVE MANAGER, AND THE STATEMENT GUARANTEES IT
 *      (APV1C-01). The invariant is part of the UPDATE predicate, not a check performed
 *      before it: a read-then-write pair can be interleaved so that two requests both see
 *      "another manager exists" and both remove one, leaving none. The predicate below
 *      cannot be interleaved, because the row it examines and the row it writes are the
 *      same row in one statement.
 *   3. AN EMAIL ADDRESS IS AN IDENTITY; AN ACCOUNT ID IS NOT (APV1C-03). The primary key
 *      is an application-generated UUID, because a local part is not unique —
 *      `alice@example.com` and `alice@other.example` share one — and no authority is
 *      ever derived from it. Access is matched against the normalised email.
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
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?1 LIMIT 1`)
      .bind(id)
      .all<UserRow>();
    const row = results?.[0];
    return row ? toUser(row) : null;
  }

  /** Read one account by normalised email — used only to report a duplicate honestly. */
  async readByEmail(email: string): Promise<ManagedUser | null> {
    const { results } = await this.#db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?1 COLLATE NOCASE LIMIT 1`)
      .bind(email)
      .all<UserRow>();
    const row = results?.[0];
    return row ? toUser(row) : null;
  }

  /** Add an authorised address. The email is normalised by the shared identity rule. */
  async create(email: unknown, role: unknown): Promise<UserMutationResult> {
    const validation = validateNewUser(email, role);
    if (!validation.ok) {
      return { status: "bad-request", error: validation.error };
    }
    // A courtesy fast path: the refusal below is the authority, not this read.
    if (await this.readByEmail(validation.email)) {
      return { status: "duplicate", email: validation.email };
    }

    // An application-generated UUID (APV1C-03). A sanitised local part collides across
    // domains, and the id is a primary key, so a collision would surface as an unrelated
    // failure blamed on the email.
    const id = `user-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    try {
      await this.#db
        .prepare(
          "INSERT INTO users (id, email, role, active, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?5)",
        )
        .bind(id, validation.email, validation.role, now, now)
        .run();
    } catch {
      // The UNIQUE email index is the authority. Ask WHICH constraint failed rather than
      // reporting a primary-key problem as "that email already exists".
      const clash = await this.readByEmail(validation.email);
      return clash
        ? { status: "duplicate", email: validation.email }
        : { status: "unavailable", reason: "The account could not be created." };
    }

    const persisted = await this.read(id);
    return persisted
      ? { status: "ok", persisted }
      : { status: "unavailable", reason: "The account could not be read back after saving." };
  }

  /**
   * Change a role, with the last-manager invariant inside the statement (APV1C-01).
   *
   * The predicate reads: write this row unless it is CURRENTLY an active manager whose new
   * role is not manager, and no OTHER active manager exists. `RETURNING` tells the caller
   * which of the two happened — a written row, or a refusal.
   */
  async setRole(id: string, role: unknown): Promise<UserMutationResult> {
    const parsed = role === "manager" || role === "photographer" ? role : null;
    if (parsed === null) {
      return { status: "bad-request", error: "Choose either the photographer or the manager role." };
    }
    return this.#guarded(
      `UPDATE users SET role = ?1, updated_at = ?2
       WHERE id = ?3
         AND (
           NOT (role = 'manager' AND active = 1)
           OR ?4 = 'manager'
           OR EXISTS (
             SELECT 1 FROM users other
             WHERE other.id <> users.id AND other.role = 'manager' AND other.active = 1
           )
         )
       RETURNING ${USER_COLUMNS}`,
      [parsed, new Date().toISOString(), id, parsed],
      id,
    );
  }

  /** Activate or deactivate, with the same invariant in the same place. */
  async setActive(id: string, active: boolean): Promise<UserMutationResult> {
    const flag = active ? 1 : 0;
    return this.#guarded(
      `UPDATE users SET active = ?1, updated_at = ?2
       WHERE id = ?3
         AND (
           NOT (role = 'manager' AND active = 1)
           OR ?4 = 1
           OR EXISTS (
             SELECT 1 FROM users other
             WHERE other.id <> users.id AND other.role = 'manager' AND other.active = 1
           )
         )
       RETURNING ${USER_COLUMNS}`,
      [flag, new Date().toISOString(), id, flag],
      id,
    );
  }

  /**
   * Run a guarded single-statement mutation and say exactly what happened.
   *
   * A written row is success. No written row means EITHER the account is gone OR the
   * predicate refused it — so the row is read back to distinguish the two rather than
   * guessing, and a refusal is never reported as a missing account.
   */
  async #guarded(
    sql: string,
    values: readonly unknown[],
    id: string,
  ): Promise<UserMutationResult> {
    const { results } = await this.#db.prepare(sql).bind(...values).all<UserRow>();
    const row = results?.[0];
    if (row) {
      return { status: "ok", persisted: toUser(row) };
    }
    return (await this.read(id)) ? { status: "last-manager" } : { status: "not-found" };
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
