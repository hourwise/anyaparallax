/**
 * Tag management — the mutation layer — server only.
 *
 * Same discipline as gallery and photograph management: resolve server-side, validate
 * through the pure contract, mutate once, read back, and never report success the
 * database does not hold.
 *
 * WHAT IT REFUSES TO DO. There is no mass taxonomy operation and no silent unlink. A
 * tag that is in use cannot be deleted at all: unlinking it from photographs to make a
 * delete succeed would silently change what those photographs say about themselves.
 * The operator is told how many photographs use it instead.
 *
 * Renaming keeps the slug: a tag's slug appears in public tag URLs, and a rename is a
 * correction to its label rather than a new identity.
 */
import { isD1Binding, type D1DatabaseBinding } from "./repository.d1.server";
import { uniqueTagSlug, validateTagName } from "./taxonomy";

export type TaxonomyEnvironment = { readonly DB?: unknown };

export type ManagedTag = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly usageCount: number;
};

export type TagMutationResult =
  | { readonly status: "ok"; readonly persisted: ManagedTag }
  | { readonly status: "not-found" }
  | { readonly status: "in-use"; readonly usageCount: number }
  | { readonly status: "bad-request"; readonly error: string }
  | { readonly status: "unavailable"; readonly reason: string };

export type ManagedTagsView =
  | { readonly available: true; readonly tags: readonly ManagedTag[] }
  | { readonly available: false; readonly reason: string };

type TagRow = { id: string; name: string; slug: string; usage_count: number };

const TAG_COLUMNS = `t.id, t.name, t.slug,
  (SELECT COUNT(*) FROM photo_tags WHERE tag_id = t.id) AS usage_count`;

function toTag(row: TagRow): ManagedTag {
  return { id: row.id, name: row.name, slug: row.slug, usageCount: row.usage_count };
}

export class TaxonomyManager {
  readonly #db: D1DatabaseBinding;

  constructor(db: D1DatabaseBinding) {
    this.#db = db;
  }

  async list(): Promise<readonly ManagedTag[]> {
    const { results } = await this.#db
      .prepare(`SELECT ${TAG_COLUMNS} FROM tags t ORDER BY t.name ASC LIMIT 500`)
      .all<TagRow>();
    return (results ?? []).map(toTag);
  }

  async read(id: string): Promise<ManagedTag | null> {
    const { results } = await this.#db
      .prepare(`SELECT ${TAG_COLUMNS} FROM tags t WHERE t.id = ? LIMIT 1`)
      .bind(id)
      .all<TagRow>();
    const row = results?.[0];
    return row ? toTag(row) : null;
  }

  async create(value: unknown): Promise<TagMutationResult> {
    const validation = validateTagName(value);
    if (!validation.ok) {
      return { status: "bad-request", error: validation.error };
    }
    const { results } = await this.#db
      .prepare("SELECT slug FROM tags LIMIT 500")
      .all<{ slug: string }>();
    const slug = uniqueTagSlug(validation.slug, (results ?? []).map((row) => row.slug));
    const id = `tag-${slug}`;
    await this.#db
      .prepare("INSERT INTO tags (id, name, slug) VALUES (?, ?, ?)")
      .bind(id, validation.name, slug)
      .run();
    const persisted = await this.read(id);
    return persisted
      ? { status: "ok", persisted }
      : { status: "unavailable", reason: "The tag could not be read back after saving." };
  }

  /** Rename the label; the slug (the public identity) is deliberately unchanged. */
  async rename(id: string, value: unknown): Promise<TagMutationResult> {
    const existing = await this.read(id);
    if (!existing) {
      return { status: "not-found" };
    }
    const validation = validateTagName(value);
    if (!validation.ok) {
      return { status: "bad-request", error: validation.error };
    }
    await this.#db
      .prepare("UPDATE tags SET name = ? WHERE id = ?")
      .bind(validation.name, id)
      .run();
    const persisted = await this.read(id);
    return persisted
      ? { status: "ok", persisted }
      : { status: "unavailable", reason: "The tag could not be read back after saving." };
  }

  /** Delete, but only a tag nothing uses. Reported as `in-use` rather than forced. */
  async deleteUnused(id: string): Promise<TagMutationResult> {
    const existing = await this.read(id);
    if (!existing) {
      return { status: "not-found" };
    }
    if (existing.usageCount > 0) {
      return { status: "in-use", usageCount: existing.usageCount };
    }
    await this.#db.prepare("DELETE FROM tags WHERE id = ? AND NOT EXISTS (SELECT 1 FROM photo_tags WHERE tag_id = ?)").bind(id, id).run();
    const stillThere = await this.read(id);
    if (stillThere) {
      // The row survived, which means the guarded statement refused: report the truth
      // rather than claiming a deletion that did not happen.
      return { status: "in-use", usageCount: stillThere.usageCount };
    }
    return { status: "ok", persisted: { ...existing, usageCount: 0 } };
  }
}

export function taxonomyManagerFor(env: TaxonomyEnvironment | undefined): TaxonomyManager | null {
  const db = env?.DB;
  if (!isD1Binding(db)) {
    return null;
  }
  return new TaxonomyManager(db);
}

export async function managedTagsView(
  env: TaxonomyEnvironment | undefined,
): Promise<ManagedTagsView> {
  const manager = taxonomyManagerFor(env);
  if (!manager) {
    return {
      available: false,
      reason: "No database is configured in this environment, so tags are unavailable.",
    };
  }
  return { available: true, tags: await manager.list() };
}
