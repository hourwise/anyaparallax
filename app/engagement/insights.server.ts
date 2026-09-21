/**
 * Operator engagement summary — server only, read-only.
 *
 * A small, honest answer to "is anybody engaging with this?" for the photographer and
 * manager: how many likes and share actions exist, which photographs attract them, and
 * which channels were used.
 *
 * WHAT IT DELIBERATELY CANNOT SHOW, because the application never stores it: an IP
 * address, a user agent, a referrer, a fingerprint or the anonymous browser token
 * itself. The engagement design keeps identity package-private on purpose, and an
 * operator summary must not become the surveillance subsystem that design refused. Every
 * row here is an aggregate over stored counts.
 *
 * "Shares" means share actions INITIATED through this site. The application never learns
 * whether an external share completed, so nothing here claims that it did.
 */
import { isD1Binding, type D1DatabaseBinding } from "../data/repository.d1.server";

export type EngagementEnvironment = { readonly DB?: unknown };

export type EngagementHighlight = {
  readonly title: string;
  readonly slug: string;
  readonly total: number;
};

export type EngagementInsights = {
  readonly available: boolean;
  readonly reason?: string;
  readonly totalLikes: number;
  readonly totalShares: number;
  readonly topLiked: readonly EngagementHighlight[];
  readonly mostShared: readonly EngagementHighlight[];
  readonly channels: readonly { readonly channel: string; readonly total: number }[];
};

const UNAVAILABLE: EngagementInsights = {
  available: false,
  reason: "No database is configured in this environment, so engagement cannot be summarised.",
  totalLikes: 0,
  totalShares: 0,
  topLiked: [],
  mostShared: [],
  channels: [],
};

async function scalar(db: D1DatabaseBinding, sql: string): Promise<number> {
  const { results } = await db.prepare(sql).all<{ value: number }>();
  return results?.[0]?.value ?? 0;
}

async function highlights(
  db: D1DatabaseBinding,
  table: "likes" | "share_events",
): Promise<readonly EngagementHighlight[]> {
  // The table name is a literal from this module, never from a request.
  const { results } = await db
    .prepare(
      `SELECT p.title, p.slug, COUNT(e.id) AS total
       FROM ${table} e JOIN photos p ON p.id = e.photo_id
       GROUP BY p.id ORDER BY total DESC, p.title ASC LIMIT 5`,
    )
    .all<{ title: string; slug: string; total: number }>();
  return (results ?? []).map((row) => ({ title: row.title, slug: row.slug, total: row.total }));
}

export async function readEngagementInsights(
  env: EngagementEnvironment | undefined,
): Promise<EngagementInsights> {
  const db = env?.DB;
  if (!isD1Binding(db)) {
    return UNAVAILABLE;
  }
  try {
    const [totalLikes, totalShares, topLiked, mostShared, channelRows] = await Promise.all([
      scalar(db, "SELECT COUNT(*) AS value FROM likes"),
      scalar(db, "SELECT COUNT(*) AS value FROM share_events"),
      highlights(db, "likes"),
      highlights(db, "share_events"),
      db
        .prepare(
          `SELECT channel, COUNT(*) AS total FROM share_events
           GROUP BY channel ORDER BY total DESC, channel ASC LIMIT 8`,
        )
        .all<{ channel: string; total: number }>(),
    ]);
    return {
      available: true,
      totalLikes,
      totalShares,
      topLiked,
      mostShared,
      channels: (channelRows.results ?? []).map((row) => ({
        channel: row.channel,
        total: row.total,
      })),
    };
  } catch {
    return { ...UNAVAILABLE, reason: "The engagement rows could not be read." };
  }
}
