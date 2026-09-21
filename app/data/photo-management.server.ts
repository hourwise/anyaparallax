/**
 * Photograph management — the mutation layer (REPAIR-09B) — server only.
 *
 * The audited blocker was that a photograph's metadata could be supplied while
 * uploading and never corrected afterwards, and — the part that matters most — that a
 * PUBLISHED photograph could not be withdrawn without direct database intervention.
 * V1 requires Anya to run the site herself, so unpublishing is a safety control
 * rather than polish: it is the withdrawal mechanism.
 *
 * The vocabulary, the field bounds and the validation live in the pure module
 * `photo-management.ts`, because the operator screens need them and a route must not
 * import a `.server` module into client code. This module owns the database:
 *
 *   1. resolve the record server-side (a submitted id is a lookup key, never a fact);
 *   2. validate through the pure contract;
 *   3. perform ONE bounded, parameterised mutation (plus an atomic tag batch);
 *   4. READ THE ROW BACK and compare it with what was intended;
 *   5. refuse to report success unless the persisted state matches.
 *
 * WHAT THIS MODULE CANNOT DO, BY CONSTRUCTION. There is no statement here that writes
 * `original_storage_key`, `web_storage_key`, `thumbnail_storage_key`, `width`,
 * `height` or `slug`; the mutation contract does not contain them, the editor form
 * cannot post them, and a submission that names them is refused by the route rather
 * than ignored. Deleting is likewise absent: V1 withdraws a photograph by
 * unpublishing it, and no photograph or R2 object is ever removed.
 *
 * PUBLICATION IS THE AUTHORITY, and it is already honoured everywhere else:
 * `/photo/:slug`, the gallery and homepage queries, the print-eligibility list and the
 * `/media/...` gate all read `published` from the database on every request, so
 * flipping the column withdraws a photograph immediately. Public derivative OBJECTS
 * are deliberately left in place — unpublishing hides a photograph, it does not
 * destroy an archival record.
 *
 * D1 only, with no seed fallback: a development seed set cannot store an editorial
 * decision, and reporting one as saved when it was not would be worse than saying the
 * surface is unavailable. That is the rule the print-eligibility and engagement stores
 * already follow.
 */
import { isD1Binding, type D1DatabaseBinding } from "./repository.d1.server";
import {
  MANAGED_PHOTO_LIST_LIMIT,
  validatePhotoMetadata,
  type GalleryOption,
  type ManagedPhotoDetail,
  type ManagedPhotoSummary,
  type PhotoEditInput,
  type PhotoMetadataInput,
  type PhotoMutationResult,
  type ValidatedPhotoMetadata,
} from "./photo-management";

/** What this module needs from the environment. */
export type PhotoManagementEnvironment = {
  readonly DB?: unknown;
};

export type ManagedPhotoListView =
  | { readonly available: true; readonly photos: readonly ManagedPhotoSummary[] }
  | { readonly available: false; readonly reason: string };

export type ManagedPhotoEditorView =
  | {
      readonly status: "ok";
      readonly photo: ManagedPhotoDetail;
      readonly galleries: readonly GalleryOption[];
    }
  | { readonly status: "not-found" }
  | { readonly status: "unavailable"; readonly reason: string };

/** A `photos` row joined to its gallery: the internal record, not a projection. */
type ManagedPhotoRow = {
  id: string;
  title: string;
  slug: string;
  description: string;
  gallery_id: string;
  location: string | null;
  capture_date: string | null;
  published: number;
  featured: number;
  print_available: number;
  original_storage_key: string;
  web_storage_key: string;
  thumbnail_storage_key: string;
  published_at: string | null;
  updated_at: string;
  gallery_name: string;
  gallery_published: number;
};

const PHOTO_COLUMNS = `p.id, p.title, p.slug, p.description, p.gallery_id, p.location,
  p.capture_date, p.published, p.featured, p.print_available,
  p.original_storage_key, p.web_storage_key, p.thumbnail_storage_key,
  p.published_at, p.updated_at,
  g.name AS gallery_name, g.published AS gallery_published`;

function toSummary(row: ManagedPhotoRow): ManagedPhotoSummary {
  const published = row.published === 1;
  const galleryPublished = row.gallery_published === 1;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    galleryId: row.gallery_id,
    galleryName: row.gallery_name,
    galleryPublished,
    published,
    featured: row.featured === 1,
    printAvailable: row.print_available === 1,
    updatedAt: row.updated_at,
    publiclyVisible: published && galleryPublished,
  };
}

/** The three columns this module must never change, read for before/after comparison. */
type StorageIdentity = {
  readonly original: string;
  readonly web: string;
  readonly thumbnail: string;
};

/**
 * A binding that can commit several statements as one transaction.
 *
 * The tag edit needs it. `D1DatabaseBinding.batch` is optional in the shared type
 * because the media route only ever reads; every method here that needs it checks for
 * it at call time and fails closed, which is what makes the assertion in
 * `photoManagerFor` safe rather than hopeful.
 */
type BatchCapableBinding = D1DatabaseBinding & {
  batch(statements: readonly unknown[]): Promise<readonly unknown[]>;
};

export class PhotoManager {
  readonly #db: BatchCapableBinding;

  constructor(db: BatchCapableBinding) {
    this.#db = db;
  }

  async #all<T>(sql: string, ...values: readonly unknown[]): Promise<readonly T[]> {
    const statement =
      values.length > 0 ? this.#db.prepare(sql).bind(...values) : this.#db.prepare(sql);
    const result = await statement.all<T>();
    return result.results ?? [];
  }

  async #photoRow(photoId: string): Promise<ManagedPhotoRow | null> {
    const rows = await this.#all<ManagedPhotoRow>(
      `SELECT ${PHOTO_COLUMNS}
         FROM photos p
         JOIN galleries g ON g.id = p.gallery_id
        WHERE p.id = ?1
        LIMIT 1`,
      photoId,
    );
    return rows[0] ?? null;
  }

  async #tagsFor(photoId: string): Promise<readonly string[]> {
    const rows = await this.#all<{ tag_id: string }>(
      "SELECT tag_id FROM photo_tags WHERE photo_id = ?1 ORDER BY tag_id ASC",
      photoId,
    );
    return rows.map((row) => row.tag_id);
  }

  #storageIdentityOf(row: ManagedPhotoRow): StorageIdentity {
    return {
      original: row.original_storage_key,
      web: row.web_storage_key,
      thumbnail: row.thumbnail_storage_key,
    };
  }

  /**
   * The `published_at` value the contract requires.
   *
   * A published photograph carries a timestamp and an unpublished one carries NULL —
   * the rule `createPhoto` writes and the seed data follows. Publishing something
   * already published KEEPS its original timestamp, so an accidental double-submit
   * cannot reorder the site; publishing a draft stamps now, which puts it at the front
   * of the newest-first public ordering.
   */
  #publishedAtFor(before: ManagedPhotoRow, published: boolean, now: string): string | null {
    if (!published) {
      return null;
    }
    const alreadyStamped =
      before.published === 1 &&
      typeof before.published_at === "string" &&
      before.published_at.length > 0;
    return alreadyStamped ? before.published_at : now;
  }

  /**
   * Every photograph, DRAFTS FIRST.
   *
   * Drafts lead the list on purpose: an unpublished photograph is the state that needs
   * an operator's attention, and burying it below hundreds of published rows would
   * make the one screen that manages publication state least useful exactly when it
   * matters. Within each group, most recently updated first.
   */
  async listPhotos(): Promise<readonly ManagedPhotoSummary[]> {
    const rows = await this.#all<ManagedPhotoRow>(
      `SELECT ${PHOTO_COLUMNS}
         FROM photos p
         JOIN galleries g ON g.id = p.gallery_id
        ORDER BY p.published ASC, p.updated_at DESC, p.slug ASC
        LIMIT ?1`,
      MANAGED_PHOTO_LIST_LIMIT,
    );
    return rows.map(toSummary);
  }

  /**
   * One photograph for the editor, with every gallery it could be filed into.
   *
   * ALL galleries are offered, published or not, because filing a draft into a gallery
   * that is itself still a draft is a legitimate editorial step. Each option carries
   * its publication state so the editor can state the consequence plainly: a
   * photograph in an unpublished gallery is not publicly visible whatever its own
   * `published` flag says.
   */
  async editorFor(photoId: string): Promise<ManagedPhotoEditorView> {
    if (photoId.length === 0 || photoId.length > 128) {
      return { status: "not-found" };
    }
    const row = await this.#photoRow(photoId);
    if (!row) {
      return { status: "not-found" };
    }
    const galleries = await this.#all<{
      id: string;
      name: string;
      slug: string;
      published: number;
    }>("SELECT id, name, slug, published FROM galleries ORDER BY display_order ASC, name ASC");

    return {
      status: "ok",
      photo: {
        ...toSummary(row),
        description: row.description,
        location: row.location,
        captureDate: row.capture_date,
        tags: await this.#tagsFor(photoId),
      },
      galleries: galleries.map((gallery) => ({
        id: gallery.id,
        name: gallery.name,
        slug: gallery.slug,
        published: gallery.published === 1,
      })),
    };
  }

  /**
   * Re-read the photograph and confirm the mutation landed as intended.
   *
   * This is what makes a success message trustworthy: the caller is handed the state
   * the DATABASE holds, and a mismatch is reported as a failure rather than as a save.
   * The storage identity is compared here too — the editor has no way to change it, and
   * this is the assertion that keeps that true even if a future statement were written
   * carelessly.
   */
  async #confirm(
    photoId: string,
    expected: Partial<ValidatedPhotoMetadata & { published: boolean; featured: boolean }>,
    storageBefore: StorageIdentity,
    expectedPublished: boolean | undefined,
  ): Promise<PhotoMutationResult> {
    const row = await this.#photoRow(photoId);
    if (!row) {
      return { status: "not-found" };
    }
    if (
      row.original_storage_key !== storageBefore.original ||
      row.web_storage_key !== storageBefore.web ||
      row.thumbnail_storage_key !== storageBefore.thumbnail
    ) {
      return {
        status: "unavailable",
        reason:
          "The mutation altered storage identity, which is never permitted; it was not accepted.",
      };
    }

    const mismatches: string[] = [];
    if (expected.title !== undefined && row.title !== expected.title) {
      mismatches.push("title");
    }
    if (expected.description !== undefined && row.description !== expected.description) {
      mismatches.push("description");
    }
    if (expected.location !== undefined && row.location !== expected.location) {
      mismatches.push("location");
    }
    if (expected.captureDate !== undefined && row.capture_date !== expected.captureDate) {
      mismatches.push("capture date");
    }
    if (expected.galleryId !== undefined && row.gallery_id !== expected.galleryId) {
      mismatches.push("gallery");
    }
    if (expected.published !== undefined && (row.published === 1) !== expected.published) {
      mismatches.push("publication state");
    }
    if (expected.featured !== undefined && (row.featured === 1) !== expected.featured) {
      mismatches.push("featured state");
    }
    // The published_at contract: a published photograph carries a timestamp, an
    // unpublished one carries NULL.
    if (expectedPublished !== undefined) {
      const carriesTimestamp = typeof row.published_at === "string" && row.published_at.length > 0;
      if (carriesTimestamp !== expectedPublished) {
        mismatches.push("publication timestamp");
      }
    }
    if (expected.tags !== undefined) {
      const stored = await this.#tagsFor(photoId);
      if (stored.join(",") !== expected.tags.join(",")) {
        mismatches.push("tags");
      }
    }
    if (mismatches.length > 0) {
      return {
        status: "unavailable",
        reason: `The change to ${mismatches.join(", ")} was not stored, so it has not been reported as saved.`,
      };
    }
    return { status: "ok", persisted: toSummary(row) };
  }

  /**
   * Apply the whole editor form to one photograph, atomically.
   *
   * ONE transaction covers the row and its tag links: D1 batches are atomic, so a
   * failing tag insert cannot leave a photograph with half its tags — the same
   * guarantee `createPhoto` relies on — and because the metadata and the two state
   * fields are written by the SAME statement, the editor cannot half-save.
   *
   * The statement touches only the nine editable columns. The three storage keys, the
   * geometry the pipeline measured, the slug, the creation timestamp and every
   * engagement and enquiry row are outside it.
   */
  async updatePhoto(
    photoId: unknown,
    input: PhotoEditInput,
    options: { readonly galleryIds: readonly string[]; readonly tagIds: readonly string[] },
  ): Promise<PhotoMutationResult> {
    if (typeof photoId !== "string" || photoId.length === 0 || photoId.length > 128) {
      return { status: "bad-request", errors: { form: "No photograph was identified." } };
    }
    if (typeof input.published !== "boolean" || typeof input.featured !== "boolean") {
      return {
        status: "bad-request",
        errors: {
          form: "The publication and featured states must be chosen from the listed options.",
        },
      };
    }
    if (typeof this.#db.batch !== "function") {
      return {
        status: "unavailable",
        reason:
          "This database binding cannot commit the photograph and its tag links atomically, so nothing was changed.",
      };
    }

    const before = await this.#photoRow(photoId);
    if (!before) {
      return { status: "not-found" };
    }

    const validation = validatePhotoMetadata(input as PhotoMetadataInput, options);
    if (!validation.ok) {
      return { status: "invalid", errors: validation.errors };
    }
    const value = validation.value;
    const now = new Date().toISOString();

    const statements = [
      this.#db
        .prepare(
          `UPDATE photos
              SET title = ?1, description = ?2, location = ?3, capture_date = ?4,
                  gallery_id = ?5, published = ?6, published_at = ?7, featured = ?8,
                  updated_at = ?9
            WHERE id = ?10`,
        )
        .bind(
          value.title,
          value.description,
          value.location,
          value.captureDate,
          value.galleryId,
          input.published ? 1 : 0,
          this.#publishedAtFor(before, input.published, now),
          input.featured ? 1 : 0,
          now,
          photoId,
        ),
      // Replace the link set wholesale: obsolete relationships go first, so removing a
      // tag in the editor actually removes it, and re-adding one cannot duplicate it
      // because the junction table's primary key would reject the second row.
      this.#db.prepare("DELETE FROM photo_tags WHERE photo_id = ?1").bind(photoId),
      ...value.tags.map((tagId) =>
        this.#db
          .prepare("INSERT INTO photo_tags (photo_id, tag_id) VALUES (?1, ?2)")
          .bind(photoId, tagId),
      ),
    ];

    try {
      await this.#db.batch(statements);
    } catch {
      return {
        status: "unavailable",
        reason: "The change could not be committed, so the photograph is unchanged.",
      };
    }

    return this.#confirm(
      photoId,
      { ...value, published: input.published, featured: input.featured },
      this.#storageIdentityOf(before),
      input.published,
    );
  }

  /**
   * Publish or withdraw one photograph.
   *
   * THE WITHDRAWAL MECHANISM. `published` is the single authority every public read
   * already consults, so this one column decides whether `/photo/:slug`, the gallery
   * and homepage listings, print-enquiry resolution and the `/media/...` gate serve the
   * photograph — on the very next request, because all of them read the database rather
   * than a cache. No R2 object is deleted: withdrawing a photograph hides it, and the
   * derivative and the private master both stay exactly as the pipeline wrote them.
   */
  async setPublication(photoId: unknown, published: unknown): Promise<PhotoMutationResult> {
    if (typeof photoId !== "string" || photoId.length === 0 || photoId.length > 128) {
      return { status: "bad-request", errors: { form: "No photograph was identified." } };
    }
    if (typeof published !== "boolean") {
      return {
        status: "bad-request",
        errors: { form: "A publication state must be 'draft' or 'published'." },
      };
    }

    const before = await this.#photoRow(photoId);
    if (!before) {
      return { status: "not-found" };
    }

    const now = new Date().toISOString();
    try {
      await this.#db
        .prepare(
          `UPDATE photos
              SET published = ?1, published_at = ?2, updated_at = ?3
            WHERE id = ?4`,
        )
        .bind(published ? 1 : 0, this.#publishedAtFor(before, published, now), now, photoId)
        .run();
    } catch {
      return {
        status: "unavailable",
        reason: "The publication change could not be committed, so the photograph is unchanged.",
      };
    }

    return this.#confirm(photoId, { published }, this.#storageIdentityOf(before), published);
  }

  /** Feature or unfeature one photograph. Only `photos.featured` is written. */
  async setFeatured(photoId: unknown, featured: unknown): Promise<PhotoMutationResult> {
    if (typeof photoId !== "string" || photoId.length === 0 || photoId.length > 128) {
      return { status: "bad-request", errors: { form: "No photograph was identified." } };
    }
    if (typeof featured !== "boolean") {
      return {
        status: "bad-request",
        errors: { form: "A featured state must be 'featured' or 'not-featured'." },
      };
    }

    const before = await this.#photoRow(photoId);
    if (!before) {
      return { status: "not-found" };
    }

    try {
      await this.#db
        .prepare("UPDATE photos SET featured = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(featured ? 1 : 0, new Date().toISOString(), photoId)
        .run();
    } catch {
      return {
        status: "unavailable",
        reason: "The featured change could not be committed, so the photograph is unchanged.",
      };
    }

    return this.#confirm(photoId, { featured }, this.#storageIdentityOf(before), undefined);
  }
}

/**
 * The manager for this environment, or null when photographs cannot be managed.
 *
 * The `batch` assertion is safe because every method that needs it checks for it at
 * call time and fails closed with an explanation, so a binding without `batch`
 * degrades to a truthful refusal rather than to a partial write.
 */
/**
 * The gallery and tag ids that currently exist, for validating a submission.
 *
 * The editor already validated against lists like this; the UPLOAD path did not, which
 * was the audit finding (APV1-03): a direct POST could name a gallery or a tag that does
 * not exist because only the browser's `<select>` had stopped it. Both paths now ask the
 * same question of the same tables.
 */
export async function knownReferenceIds(
  env: PhotoManagementEnvironment | undefined,
): Promise<{ readonly galleryIds: readonly string[]; readonly tagIds: readonly string[] }> {
  const db = env?.DB;
  if (!isD1Binding(db)) {
    return { galleryIds: [], tagIds: [] };
  }
  const [galleryRows, tagRows] = await Promise.all([
    db.prepare("SELECT id FROM galleries LIMIT 500").all<{ id: string }>(),
    db.prepare("SELECT id FROM tags LIMIT 500").all<{ id: string }>(),
  ]);
  return {
    galleryIds: (galleryRows.results ?? []).map((row) => row.id),
    tagIds: (tagRows.results ?? []).map((row) => row.id),
  };
}

export function photoManagerFor(env: PhotoManagementEnvironment | undefined): PhotoManager | null {
  const db = env?.DB;
  return isD1Binding(db) ? new PhotoManager(db as BatchCapableBinding) : null;
}

/** Every photograph for the management list. */
export async function listManagedPhotos(
  env: PhotoManagementEnvironment | undefined,
): Promise<ManagedPhotoListView> {
  const manager = photoManagerFor(env);
  if (!manager) {
    return {
      available: false,
      reason: "No database is configured in this environment, so photographs cannot be managed.",
    };
  }
  try {
    return { available: true, photos: await manager.listPhotos() };
  } catch {
    return { available: false, reason: "The photograph list could not be read." };
  }
}

/** One photograph and the galleries it could be filed into. */
export async function managedPhotoEditorFor(
  env: PhotoManagementEnvironment | undefined,
  photoId: string,
): Promise<ManagedPhotoEditorView> {
  const manager = photoManagerFor(env);
  if (!manager) {
    return {
      status: "unavailable",
      reason: "No database is configured in this environment, so this photograph cannot be edited.",
    };
  }
  try {
    return await manager.editorFor(photoId);
  } catch {
    return { status: "unavailable", reason: "The photograph could not be read." };
  }
}
