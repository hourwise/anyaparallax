/**
 * Engagement persistence (Slice 07) — server only.
 *
 * Likes and share events live in D1, and ONLY in D1. There is deliberately no
 * seed-backed fallback: the development seed set cannot store a like, and
 * inventing an in-memory counter would present fabricated engagement as real.
 * When no database is reachable, engagement reports itself UNAVAILABLE and the
 * UI says so, rather than showing a number that means nothing.
 *
 * The publication rule is enforced here, against the database, before any
 * mutation: a photograph must be published AND in a published gallery. The
 * caller's own lookup result is never trusted for this, because a like is a
 * mutation and a stale or forged slug must not be able to reach a draft.
 *
 * Duplicate mitigation is the database's `UNIQUE (photo_id, browser_token)` from
 * migration 0001, which is why the insert is `INSERT OR IGNORE`: under a
 * concurrent double-submit one statement wins and the other is a no-op, and the
 * count that is returned is always read back from storage rather than incremented
 * optimistically in JavaScript.
 */
import type { D1DatabaseBinding } from "../data/repository.d1.server";
import { isD1Binding } from "../data/repository.d1.server";
import type { PhotoEngagement, ShareChannel } from "./engagement";

/** What the repository needs from the environment. */
export type EngagementEnvironment = {
  readonly DB?: unknown;
};

/** The digits of a like state that came from storage. */
type LikeStateRow = {
  like_count?: unknown;
  liked_by_browser?: unknown;
};

/** Read a count defensively: a malformed aggregate is not a number to display. */
function toCount(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
}

export class EngagementStore {
  readonly #db: D1DatabaseBinding;

  constructor(db: D1DatabaseBinding) {
    this.#db = db;
  }

  /**
   * The like state of one photograph, for one browser digest.
   *
   * `browserTokenDigest` may be null for a first-time visitor; the count is then
   * still returned and `likedByThisBrowser` is false, without creating anything.
   */
  async likeState(photoId: string, browserTokenDigest: string | null): Promise<PhotoEngagement> {
    // One statement, so the count and this browser's own row are read from the
    // same snapshot rather than from two queries that could disagree.
    const result = await this.#db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM likes WHERE photo_id = ?1) AS like_count,
           (SELECT COUNT(*) FROM likes WHERE photo_id = ?1 AND browser_token = ?2) AS liked_by_browser`,
      )
      .bind(photoId, browserTokenDigest ?? "")
      .all<LikeStateRow>();
    const row = result.results?.[0];
    return {
      likeCount: toCount(row?.like_count),
      likedByThisBrowser: toCount(row?.liked_by_browser) > 0,
    };
  }

  /**
   * Is this photograph likeable by a visitor?
   *
   * Both flags, checked in the database. A photograph that is unpublished, or
   * that sits in an unpublished gallery, is not.
   */
  async isPubliclyEngageable(photoId: string): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `SELECT 1 AS allowed
           FROM photos p
           JOIN galleries g ON g.id = p.gallery_id
          WHERE p.id = ?1 AND p.published = 1 AND g.published = 1
          LIMIT 1`,
      )
      .bind(photoId)
      .all<{ allowed: number }>();
    return (result.results?.length ?? 0) > 0;
  }

  /**
   * Record a like for this browser, idempotently.
   *
   * `INSERT OR IGNORE` defers to the table's own unique constraint, so a repeated
   * or concurrent submit cannot create a second row. The identifier is unique per
   * like rather than the browser: the row's identity is the (photo, browser) pair,
   * which the schema already enforces.
   */
  async addLike(photoId: string, browserTokenDigest: string): Promise<void> {
    await this.#db
      .prepare(
        "INSERT OR IGNORE INTO likes (id, photo_id, browser_token, created_at) VALUES (?1, ?2, ?3, ?4)",
      )
      .bind(`like-${crypto.randomUUID()}`, photoId, browserTokenDigest, new Date().toISOString())
      .run();
  }

  /**
   * Remove THIS browser's like, if it has one.
   *
   * The delete is scoped by `browser_token`, so it can only ever remove the
   * caller's own row. Deleting nothing is not an error: unlike is idempotent.
   */
  async removeLike(photoId: string, browserTokenDigest: string): Promise<void> {
    await this.#db
      .prepare("DELETE FROM likes WHERE photo_id = ?1 AND browser_token = ?2")
      .bind(photoId, browserTokenDigest)
      .run();
  }

  /**
   * Record that a share interaction was INITIATED.
   *
   * Deliberately stores nothing about who did it: no address, no user agent, no
   * browser digest, no referrer. The table has no column for any of them, and the
   * statement supplies none.
   *
   * `external_confirmed_at` is left NULL. This slice performs no external
   * confirmation — opening a share sheet is not evidence that anything was
   * posted — so the column records the honest answer: unconfirmed.
   */
  async recordShareInitiation(photoId: string, channel: ShareChannel): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO share_events (id, photo_id, channel, created_at, external_confirmed_at)
         VALUES (?1, ?2, ?3, ?4, NULL)`,
      )
      .bind(`share-${crypto.randomUUID()}`, photoId, channel, new Date().toISOString())
      .run();
  }
}

/**
 * The store for this environment, or null when engagement cannot be persisted.
 *
 * Returning null is the fail-closed answer required for a deployment with no
 * database: callers report engagement as unavailable instead of fabricating a
 * count. It is deliberately NOT wired to the development seed fallback that the
 * portfolio queries use, because a seed set cannot hold a like.
 */
export function engagementStoreFor(env: EngagementEnvironment | undefined): EngagementStore | null {
  return isD1Binding(env?.DB) ? new EngagementStore(env.DB) : null;
}
