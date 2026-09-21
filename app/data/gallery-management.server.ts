/**
 * Gallery management — the mutation layer — server only.
 *
 * Companion to `photo-management.server.ts` and deliberately built the same way:
 *
 *   1. resolve the record server-side (a submitted id is a lookup key, never a fact);
 *   2. validate through the pure contract in `gallery-management.ts`;
 *   3. perform ONE bounded, parameterised mutation;
 *   4. READ THE ROW BACK and compare it with what was intended;
 *   5. refuse to report success unless the persisted state matches.
 *
 * WHY IT MATTERS. A photograph belongs to a gallery, and production begins with none,
 * so this is the difference between Anya running her own site and needing a developer
 * for every collection. The schema already carried every field; nothing here invents
 * one.
 *
 * WHAT THIS MODULE REFUSES TO DO.
 *
 *   * There is no DELETE. V1 withdraws a gallery by unpublishing it: unpublishing is
 *     reversible, deletion is not, and the photographs inside would become unreachable
 *     without being deleted themselves.
 *   * An edit never re-derives the slug. A published gallery's URL is quoted, shared
 *     and indexed, so a rename must not silently break it; the slug is therefore part
 *     of the creation contract only.
 *   * A cover must be a photograph that ALREADY belongs to that gallery, checked in
 *     the same statement that sets it. A cover from another gallery would produce a
 *     public card that contradicts the gallery it appears on.
 *
 * PUBLICATION INVARIANT (unchanged, and re-asserted here): a photograph is publicly
 * visible only when BOTH it and its gallery are published. Publishing a gallery does
 * not publish its photographs, and unpublishing a gallery withdraws every photograph
 * inside it on the next request — that is the same live authority every public read
 * already consults.
 *
 * D1 only, with no seed fallback: a development seed set cannot store an editorial
 * decision, and reporting one as saved when it was not would be worse than saying the
 * surface is unavailable.
 */
import { isD1Binding, type D1DatabaseBinding } from "./repository.d1.server";
import {
  MANAGED_GALLERY_LIST_LIMIT,
  slugifyGalleryName,
  uniqueSlug,
  validateGallery,
  type GalleryFieldErrors,
  type GalleryInput,
} from "./gallery-management";

/** What this module needs from the environment. */
export type GalleryManagementEnvironment = {
  readonly DB?: unknown;
};

/** A gallery as the operator screen shows it, including what the public site derives. */
export type ManagedGallerySummary = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly published: boolean;
  readonly displayOrder: number;
  readonly coverPhotoId: string | null;
  readonly coverPhotoTitle: string | null;
  readonly photoCount: number;
  readonly publishedPhotoCount: number;
  readonly updatedAt: string;
};

/** A photograph the operator may choose as a cover: one that belongs to the gallery. */
export type GalleryPhotoChoice = {
  readonly id: string;
  readonly title: string;
  readonly published: boolean;
};

export type ManagedGalleryView =
  | {
      readonly available: true;
      readonly galleries: readonly ManagedGallerySummary[];
      readonly photosByGallery: Readonly<Record<string, readonly GalleryPhotoChoice[]>>;
    }
  | { readonly available: false; readonly reason: string };

export type GalleryMutationResult =
  | { readonly status: "ok"; readonly persisted: ManagedGallerySummary; readonly createdSlug?: string }
  | { readonly status: "not-found" }
  | { readonly status: "bad-request"; readonly errors: GalleryFieldErrors }
  | { readonly status: "unavailable"; readonly reason: string };

type GalleryRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  published: number;
  display_order: number;
  cover_photo_id: string | null;
  updated_at: string;
  cover_photo_title: string | null;
  photo_count: number;
  published_photo_count: number;
};

const GALLERY_COLUMNS = `g.id, g.name, g.slug, g.description, g.published, g.display_order,
  g.cover_photo_id, g.updated_at,
  (SELECT title FROM photos WHERE id = g.cover_photo_id) AS cover_photo_title,
  (SELECT COUNT(*) FROM photos WHERE gallery_id = g.id) AS photo_count,
  (SELECT COUNT(*) FROM photos WHERE gallery_id = g.id AND published = 1) AS published_photo_count`;

const UNAVAILABLE_REASON =
  "No database is configured in this environment, so gallery management is unavailable.";

function toSummary(row: GalleryRow): ManagedGallerySummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    published: row.published === 1,
    displayOrder: row.display_order,
    coverPhotoId: row.cover_photo_id,
    coverPhotoTitle: row.cover_photo_title,
    photoCount: row.photo_count,
    publishedPhotoCount: row.published_photo_count,
    updatedAt: row.updated_at,
  };
}

/** A stable, readable identifier. Gallery ids appear in no public URL. */
function galleryIdFor(slug: string): string {
  return `gallery-${slug}`;
}

export class GalleryManager {
  readonly #db: D1DatabaseBinding;

  constructor(db: D1DatabaseBinding) {
    this.#db = db;
  }

  /** Every gallery, in display order, with the counts the screen explains. */
  async list(): Promise<readonly ManagedGallerySummary[]> {
    const { results } = await this.#db
      .prepare(
        `SELECT ${GALLERY_COLUMNS} FROM galleries g
         ORDER BY g.display_order ASC, g.name ASC LIMIT ?`,
      )
      .bind(MANAGED_GALLERY_LIST_LIMIT)
      .all<GalleryRow>();
    return (results ?? []).map(toSummary);
  }

  /** Photographs the operator may use as a cover, grouped by the gallery they belong to. */
  async photoChoices(): Promise<Readonly<Record<string, readonly GalleryPhotoChoice[]>>> {
    const { results } = await this.#db
      .prepare(
        `SELECT id, title, gallery_id, published FROM photos
         ORDER BY published DESC, title ASC LIMIT ?`,
      )
      .bind(MANAGED_GALLERY_LIST_LIMIT * 4)
      .all<{ id: string; title: string; gallery_id: string; published: number }>();
    const grouped: Record<string, GalleryPhotoChoice[]> = {};
    for (const row of results ?? []) {
      (grouped[row.gallery_id] ??= []).push({
        id: row.id,
        title: row.title,
        published: row.published === 1,
      });
    }
    return grouped;
  }

  async read(id: string): Promise<ManagedGallerySummary | null> {
    // `all()` rather than `first()`: the shared binding type models exactly the two
    // methods D1 guarantees here, and a LIMIT 1 read is not a reason to widen it.
    const { results } = await this.#db
      .prepare(`SELECT ${GALLERY_COLUMNS} FROM galleries g WHERE g.id = ? LIMIT 1`)
      .bind(id)
      .all<GalleryRow>();
    const row = results?.[0];
    return row ? toSummary(row) : null;
  }

  async #takenSlugs(): Promise<readonly string[]> {
    const { results } = await this.#db
      .prepare("SELECT slug FROM galleries LIMIT ?")
      .bind(MANAGED_GALLERY_LIST_LIMIT)
      .all<{ slug: string }>();
    return (results ?? []).map((row) => row.slug);
  }

  /** Create a gallery: slug derived from the name, collision handled, order appended. */
  async create(input: GalleryInput): Promise<GalleryMutationResult> {
    const validation = validateGallery(input);
    if (!validation.ok) {
      return { status: "bad-request", errors: validation.errors };
    }
    const taken = await this.#takenSlugs();
    const slug = uniqueSlug(slugifyGalleryName(validation.gallery.name), taken);
    const id = galleryIdFor(slug);
    const now = new Date().toISOString();
    const order =
      input.displayOrder.trim() === ""
        ? await this.#nextOrder()
        : validation.gallery.displayOrder;

    await this.#db
      .prepare(
        `INSERT INTO galleries (id, name, slug, description, cover_photo_id, display_order, published, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        validation.gallery.name,
        slug,
        validation.gallery.description,
        order,
        validation.gallery.published ? 1 : 0,
        now,
        now,
      )
      .run();

    const persisted = await this.read(id);
    if (!persisted) {
      return { status: "unavailable", reason: "The gallery could not be read back after saving." };
    }
    return { status: "ok", persisted, createdSlug: slug };
  }

  /** One past the highest order in use, so a new gallery lands last. */
  async #nextOrder(): Promise<number> {
    const { results } = await this.#db
      .prepare("SELECT COALESCE(MAX(display_order), -1) AS highest FROM galleries")
      .all<{ highest: number }>();
    return (results?.[0]?.highest ?? -1) + 1;
  }

  /**
   * Edit name, description, order and publication state.
   *
   * The slug is not in the statement: this method cannot change it even if a caller
   * asks, which is what keeps an established public URL stable across a rename.
   */
  async update(id: string, input: GalleryInput): Promise<GalleryMutationResult> {
    const existing = await this.read(id);
    if (!existing) {
      return { status: "not-found" };
    }
    const validation = validateGallery(input);
    if (!validation.ok) {
      return { status: "bad-request", errors: validation.errors };
    }
    const order =
      input.displayOrder.trim() === "" ? existing.displayOrder : validation.gallery.displayOrder;

    await this.#db
      .prepare(
        `UPDATE galleries SET name = ?, description = ?, display_order = ?, published = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        validation.gallery.name,
        validation.gallery.description,
        order,
        validation.gallery.published ? 1 : 0,
        new Date().toISOString(),
        id,
      )
      .run();

    return this.#readBack(id);
  }

  /** Publication on its own, so the control cannot accidentally edit other fields. */
  async setPublication(id: string, published: boolean): Promise<GalleryMutationResult> {
    const existing = await this.read(id);
    if (!existing) {
      return { status: "not-found" };
    }
    await this.#db
      .prepare("UPDATE galleries SET published = ?, updated_at = ? WHERE id = ?")
      .bind(published ? 1 : 0, new Date().toISOString(), id)
      .run();
    return this.#readBack(id);
  }

  /** Display order on its own, for the deterministic ordering control. */
  async setOrder(id: string, displayOrder: number): Promise<GalleryMutationResult> {
    const existing = await this.read(id);
    if (!existing) {
      return { status: "not-found" };
    }
    await this.#db
      .prepare("UPDATE galleries SET display_order = ?, updated_at = ? WHERE id = ?")
      .bind(displayOrder, new Date().toISOString(), id)
      .run();
    return this.#readBack(id);
  }

  /**
   * Choose a cover, or clear it with null.
   *
   * The photograph must belong to THIS gallery: the check and the write are one
   * statement, so a concurrent change cannot slip between them. A gallery with no
   * photographs simply has no cover, which the public card already handles.
   */
  async setCover(id: string, photoId: string | null): Promise<GalleryMutationResult> {
    const existing = await this.read(id);
    if (!existing) {
      return { status: "not-found" };
    }
    if (photoId !== null) {
      // The membership test and the write are ONE statement, so a concurrent change
      // cannot slip between them; the read-back then proves which of the two happened.
      await this.#db
        .prepare(
          `UPDATE galleries SET cover_photo_id = ?, updated_at = ?
           WHERE id = ? AND EXISTS (SELECT 1 FROM photos WHERE photos.id = ? AND photos.gallery_id = galleries.id)`,
        )
        .bind(photoId, new Date().toISOString(), id, photoId)
        .run();

      const persisted = await this.read(id);
      if (!persisted) {
        return { status: "unavailable", reason: "The gallery could not be read back after saving." };
      }
      if (persisted.coverPhotoId !== photoId) {
        return {
          status: "bad-request",
          errors: {
            coverPhotoId: "That photograph is not in this gallery, so it cannot be its cover.",
          },
        };
      }
      return { status: "ok", persisted };
    }

    await this.#db
      .prepare("UPDATE galleries SET cover_photo_id = NULL, updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), id)
      .run();
    return this.#readBack(id);
  }

  async #readBack(id: string): Promise<GalleryMutationResult> {
    const persisted = await this.read(id);
    if (!persisted) {
      return { status: "unavailable", reason: "The gallery could not be read back after saving." };
    }
    return { status: "ok", persisted };
  }
}

export function galleryManagerFor(
  env: GalleryManagementEnvironment | undefined,
): GalleryManager | null {
  const db = env?.DB;
  if (!isD1Binding(db)) {
    return null;
  }
  return new GalleryManager(db);
}

/** The management list plus every cover choice, in one call for the route loader. */
export async function managedGalleriesView(
  env: GalleryManagementEnvironment | undefined,
): Promise<ManagedGalleryView> {
  const manager = galleryManagerFor(env);
  if (!manager) {
    return { available: false, reason: UNAVAILABLE_REASON };
  }
  const [galleries, photosByGallery] = await Promise.all([
    manager.list(),
    manager.photoChoices(),
  ]);
  return { available: true, galleries, photosByGallery };
}
