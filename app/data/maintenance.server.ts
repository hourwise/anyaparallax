/**
 * Manager maintenance and integrity reporting — server only, read-only.
 *
 * WHAT THIS IS: a set of checks an operator can run to see whether the stored data
 * still makes sense — counts, broken relationships, publication states that disagree,
 * missing storage keys, orphaned engagement rows — plus a bounded look at whether the
 * expected objects exist in the two buckets.
 *
 * WHAT IT DELIBERATELY IS NOT: a destructive console. There is no reset, no purge, no
 * mass delete and no bucket operation in this module at all, because a single mistyped
 * control there could destroy an archive that has no backup. V1's answer to "something
 * looks wrong" is to SEE it, and to fix it through the ordinary screens.
 *
 * PRIVATE DATA STAYS PRIVATE. Findings name counts and record ids; storage keys are only
 * ever COUNTED as present or missing, never listed, and no visitor-identifying value
 * (no browser token, no enquiry message) appears in the report.
 */
import { isD1Binding, type D1DatabaseBinding } from "./repository.d1.server";
import { isR2Bucket, type R2BucketBinding } from "./storage.server";

export type MaintenanceEnvironment = {
  readonly DB?: unknown;
  readonly MASTERS?: unknown;
  readonly IMAGES?: unknown;
  readonly IMAGE_TRANSFORMS?: unknown;
};

export type IntegrityFinding = {
  /** `attention` means a human should look; nothing here is repaired automatically. */
  readonly level: "ok" | "attention";
  readonly label: string;
  readonly detail: string;
};

export type MaintenanceCounts = {
  readonly users: number;
  readonly activeManagers: number;
  readonly galleries: number;
  readonly publishedGalleries: number;
  readonly photos: number;
  readonly publishedPhotos: number;
  readonly tags: number;
  readonly tagLinks: number;
  readonly enquiries: number;
  readonly newEnquiries: number;
  readonly likes: number;
  readonly shareEvents: number;
};

export type StorageProbe = {
  readonly bound: boolean;
  readonly checked: number;
  readonly missingMasters: number;
  readonly missingDerivatives: number;
  readonly missingThumbnails: number;
  readonly note: string;
};

export type MaintenanceReport =
  | {
      readonly available: true;
      readonly counts: MaintenanceCounts;
      readonly findings: readonly IntegrityFinding[];
      readonly storage: StorageProbe;
    }
  | { readonly available: false; readonly reason: string };

/** How many photographs the optional object probe will look at in one request. */
export const STORAGE_PROBE_LIMIT = 25;

async function scalar(db: D1DatabaseBinding, sql: string): Promise<number> {
  const { results } = await db.prepare(sql).all<{ value: number }>();
  return results?.[0]?.value ?? 0;
}

export async function maintenanceReport(
  env: MaintenanceEnvironment | undefined,
): Promise<MaintenanceReport> {
  const db = env?.DB;
  if (!isD1Binding(db)) {
    return {
      available: false,
      reason: "No database is configured in this environment, so no integrity report can be produced.",
    };
  }

  const counts: MaintenanceCounts = {
    users: await scalar(db, "SELECT COUNT(*) AS value FROM users"),
    activeManagers: await scalar(
      db,
      "SELECT COUNT(*) AS value FROM users WHERE role = 'manager' AND active = 1",
    ),
    galleries: await scalar(db, "SELECT COUNT(*) AS value FROM galleries"),
    publishedGalleries: await scalar(db, "SELECT COUNT(*) AS value FROM galleries WHERE published = 1"),
    photos: await scalar(db, "SELECT COUNT(*) AS value FROM photos"),
    publishedPhotos: await scalar(db, "SELECT COUNT(*) AS value FROM photos WHERE published = 1"),
    tags: await scalar(db, "SELECT COUNT(*) AS value FROM tags"),
    tagLinks: await scalar(db, "SELECT COUNT(*) AS value FROM photo_tags"),
    enquiries: await scalar(db, "SELECT COUNT(*) AS value FROM enquiries"),
    newEnquiries: await scalar(db, "SELECT COUNT(*) AS value FROM enquiries WHERE status = 'new'"),
    likes: await scalar(db, "SELECT COUNT(*) AS value FROM likes"),
    shareEvents: await scalar(db, "SELECT COUNT(*) AS value FROM share_events"),
  };

  const findings: IntegrityFinding[] = [];

  const add = async (sql: string, label: string, detail: (count: number) => string) => {
    const count = await scalar(db, sql);
    findings.push({
      level: count === 0 ? "ok" : "attention",
      label,
      detail: count === 0 ? "Nothing to report." : detail(count),
    });
  };

  // A cover must belong to the gallery showing it, or a public card would contradict
  // the collection it appears on.
  await add(
    `SELECT COUNT(*) AS value FROM galleries g
     WHERE g.cover_photo_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM photos p WHERE p.id = g.cover_photo_id AND p.gallery_id = g.id)`,
    "Galleries whose cover photograph is missing or belongs to another gallery",
    (count) => `${count} gallery(ies) have a cover that is not one of their own photographs.`,
  );

  await add(
    `SELECT COUNT(*) AS value FROM photos p
     JOIN galleries g ON g.id = p.gallery_id
     WHERE p.published = 1 AND g.published = 0`,
    "Published photographs sitting in unpublished galleries",
    (count) =>
      `${count} photograph(s) are published but their gallery is not, so they are not visible on the public site until the gallery is published.`,
  );

  await add(
    `SELECT COUNT(*) AS value FROM photos
     WHERE original_storage_key = '' OR web_storage_key = '' OR thumbnail_storage_key = ''`,
    "Photographs with an incomplete storage key",
    (count) => `${count} photograph(s) are missing one of their three storage keys.`,
  );

  await add(
    `SELECT COUNT(*) AS value FROM photo_tags pt
     LEFT JOIN photos p ON p.id = pt.photo_id
     LEFT JOIN tags t ON t.id = pt.tag_id
     WHERE p.id IS NULL OR t.id IS NULL`,
    "Tag links pointing at a photograph or tag that no longer exists",
    (count) => `${count} tag link(s) reference a record that is missing.`,
  );

  await add(
    `SELECT COUNT(*) AS value FROM likes l
     LEFT JOIN photos p ON p.id = l.photo_id WHERE p.id IS NULL`,
    "Likes pointing at a photograph that no longer exists",
    (count) => `${count} like row(s) reference a missing photograph.`,
  );

  await add(
    `SELECT COUNT(*) AS value FROM share_events s
     LEFT JOIN photos p ON p.id = s.photo_id WHERE p.id IS NULL`,
    "Share events pointing at a photograph that no longer exists",
    (count) => `${count} share event(s) reference a missing photograph.`,
  );

  await add(
    `SELECT COUNT(*) AS value FROM enquiries
     WHERE status NOT IN ('new', 'read', 'archived')`,
    "Enquiries in a state this application does not recognise",
    (count) => `${count} enquiry row(s) carry an unknown status.`,
  );

  await add(
    `SELECT COUNT(*) AS value FROM (
       SELECT email FROM users GROUP BY email COLLATE NOCASE HAVING COUNT(*) > 1
     )`,
    "Duplicate authorised addresses",
    (count) => `${count} address(es) appear more than once, which makes the role lookup ambiguous.`,
  );

  findings.push(
    counts.activeManagers === 0
      ? {
          level: "attention",
          label: "Active managers",
          detail:
            "There is no active manager, so the manager area cannot be reached at all. Database intervention is required to recover.",
        }
      : { level: "ok", label: "Active managers", detail: `${counts.activeManagers} active manager(s).` },
  );

  return { available: true, counts, findings, storage: await probeStorage(env, db) };
}

/**
 * A bounded object-existence probe.
 *
 * The keys come from the database, never from a request, and only a fixed number of
 * photographs are inspected so the page stays cheap. Missing objects are counted by
 * kind; no key is ever rendered.
 */
async function probeStorage(
  env: MaintenanceEnvironment | undefined,
  db: D1DatabaseBinding,
): Promise<StorageProbe> {
  const masters = env?.MASTERS;
  const images = env?.IMAGES;
  const bound = isR2Bucket(masters) && isR2Bucket(images);
  if (!bound) {
    return {
      bound: false,
      checked: 0,
      missingMasters: 0,
      missingDerivatives: 0,
      missingThumbnails: 0,
      note: "Storage bindings are not both present in this environment, so objects were not inspected.",
    };
  }

  const { results } = await db
    .prepare(
      `SELECT original_storage_key, web_storage_key, thumbnail_storage_key FROM photos
       ORDER BY published DESC, created_at DESC LIMIT ?`,
    )
    .bind(STORAGE_PROBE_LIMIT)
    .all<{
      original_storage_key: string;
      web_storage_key: string;
      thumbnail_storage_key: string;
    }>();

  const objectKey = (key: string) => key.replace(/^r2:\/\/[a-z]+\//, "");
  let missingMasters = 0;
  let missingDerivatives = 0;
  let missingThumbnails = 0;

  for (const row of results ?? []) {
    // A development seed row names a placeholder asset rather than a stored object, so
    // only `r2://` keys are probed: anything else is not this application's object.
    if (row.original_storage_key.startsWith("r2://masters/")) {
      const found = await (masters as R2BucketBinding).head(objectKey(row.original_storage_key));
      if (!found) {
        missingMasters += 1;
      }
    }
    if (row.web_storage_key.startsWith("r2://images/")) {
      const found = await (images as R2BucketBinding).head(objectKey(row.web_storage_key));
      if (!found) {
        missingDerivatives += 1;
      }
    }
    if (row.thumbnail_storage_key.startsWith("r2://images/")) {
      const found = await (images as R2BucketBinding).head(objectKey(row.thumbnail_storage_key));
      if (!found) {
        missingThumbnails += 1;
      }
    }
  }

  return {
    bound: true,
    checked: (results ?? []).length,
    missingMasters,
    missingDerivatives,
    missingThumbnails,
    note: `Checked the most recent ${(results ?? []).length} photograph(s). Missing objects are counted, never listed.`,
  };
}
