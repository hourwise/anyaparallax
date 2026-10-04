/** Gallery-series management. Series organise photographs; they never publish them. */
import { isD1Binding, type D1DatabaseBinding } from "./repository.d1.server";
import { fieldText, parseDisplayOrder, slugifyGalleryName, uniqueSlug } from "./gallery-management";

export const SERIES_TITLE_LIMIT = 80;

export type ManagedSeries = {
  readonly id: string;
  readonly galleryId: string;
  readonly title: string;
  readonly slug: string;
  readonly displayOrder: number;
  readonly photoCount: number;
};

type SeriesRow = {
  id: string;
  gallery_id: string;
  title: string;
  slug: string;
  display_order: number;
  photo_count: number;
};

export type SeriesResult =
  | { readonly status: "ok"; readonly series?: ManagedSeries }
  | { readonly status: "bad-request"; readonly reason: string }
  | { readonly status: "not-found" }
  | { readonly status: "in-use"; readonly photoCount: number }
  | { readonly status: "unavailable" };

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function toSeries(row: SeriesRow): ManagedSeries {
  return {
    id: row.id,
    galleryId: row.gallery_id,
    title: row.title,
    slug: row.slug,
    displayOrder: Number(row.display_order),
    photoCount: Number(row.photo_count),
  };
}

export class SeriesManager {
  readonly #db: D1DatabaseBinding;
  constructor(db: D1DatabaseBinding) { this.#db = db; }

  async list(): Promise<readonly ManagedSeries[]> {
    const result = await this.#db.prepare(
      `SELECT s.id, s.gallery_id, s.title, s.slug, s.display_order,
              (SELECT COUNT(*) FROM photos p WHERE p.series_id = s.id) AS photo_count
         FROM gallery_series s
        ORDER BY s.gallery_id, s.display_order, s.title`,
    ).all<SeriesRow>();
    return (result.results ?? []).map(toSeries);
  }

  async forGallery(galleryId: string): Promise<readonly ManagedSeries[]> {
    return (await this.list()).filter((series) => series.galleryId === galleryId);
  }

  async create(galleryId: unknown, rawTitle: unknown, rawOrder: unknown): Promise<SeriesResult> {
    if (!validId(galleryId)) return { status: "bad-request", reason: "Choose a gallery." };
    const title = fieldText(rawTitle);
    if (!title || title.length > SERIES_TITLE_LIMIT) {
      return { status: "bad-request", reason: `Give the series a title of ${SERIES_TITLE_LIMIT} characters or fewer.` };
    }
    const gallery = await this.#db.prepare("SELECT id FROM galleries WHERE id = ?1 LIMIT 1").bind(galleryId).all<{id:string}>();
    if (!gallery.results?.[0]) return { status: "not-found" };
    const existing = await this.forGallery(galleryId);
    const parsedOrder = parseDisplayOrder(rawOrder);
    if (typeof rawOrder === "string" && rawOrder.trim() && parsedOrder === null) {
      return { status: "bad-request", reason: "Use a whole-number display order." };
    }
    const slug = uniqueSlug(slugifyGalleryName(title), existing.map((item) => item.slug));
    const displayOrder = parsedOrder ?? (existing.reduce((max, item) => Math.max(max, item.displayOrder), -1) + 1);
    const id = `series-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    try {
      await this.#db.prepare(
        `INSERT INTO gallery_series (id, gallery_id, title, slug, display_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
      ).bind(id, galleryId, title, slug, displayOrder, now).run();
      return { status: "ok", series: { id, galleryId, title, slug, displayOrder, photoCount: 0 } };
    } catch { return { status: "unavailable" }; }
  }

  async update(id: unknown, rawTitle: unknown, rawOrder: unknown): Promise<SeriesResult> {
    if (!validId(id)) return { status: "bad-request", reason: "No series was identified." };
    const title = fieldText(rawTitle);
    const order = parseDisplayOrder(rawOrder);
    if (!title || title.length > SERIES_TITLE_LIMIT) return { status: "bad-request", reason: "Give the series a short title." };
    if (order === null) return { status: "bad-request", reason: "Use a whole-number display order." };
    const now = new Date().toISOString();
    try {
      await this.#db.prepare("UPDATE gallery_series SET title = ?1, display_order = ?2, updated_at = ?3 WHERE id = ?4")
        .bind(title, order, now, id).run();
      const found = (await this.list()).find((series) => series.id === id);
      return found ? { status: "ok", series: found } : { status: "not-found" };
    } catch { return { status: "unavailable" }; }
  }

  async deleteEmpty(id: unknown): Promise<SeriesResult> {
    if (!validId(id)) return { status: "bad-request", reason: "No series was identified." };
    const found = (await this.list()).find((series) => series.id === id);
    if (!found) return { status: "not-found" };
    if (found.photoCount > 0) return { status: "in-use", photoCount: found.photoCount };
    try {
      await this.#db.prepare("DELETE FROM gallery_series WHERE id = ?1").bind(id).run();
      return { status: "ok" };
    } catch { return { status: "unavailable" }; }
  }
}

export function seriesManagerFor(env: { readonly DB?: unknown } | undefined): SeriesManager | null {
  return isD1Binding(env?.DB) ? new SeriesManager(env.DB) : null;
}
