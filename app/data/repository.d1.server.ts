/**
 * Cloudflare D1 implementation of `PortfolioRepository`.
 *
 * Server-only: this module is never imported by a route module or component, so
 * persistence code cannot enter the client bundle. Public loaders obtain it
 * through the factory in `app/data/queries.ts`, which is the only consumer.
 *
 * Rows are mapped to persistence records here and immediately projected to
 * public view types before leaving a method.
 */
import type {
  GalleryRecord,
  PhotoRecord,
  PublicGallery,
  PublicGalleryWithPhotos,
  PublicPhoto,
  PublicPhotoWithGallery,
  PublicTag,
} from "./model";
import {
  editorialSlotForIndex,
  normaliseWatermarkPosition,
  orientationOf,
  toPublicGallery,
  toPublicPhoto,
  toPublicPhotoWithGallery,
} from "./project";
import type { PortfolioRepository, PublicPhotoDetail } from "./repository";
import { slugify, suffixedSlug, type NewPhotoInput } from "./repository";

/** The D1 binding surface used here. */
export type D1DatabaseBinding = {
  prepare(query: string): D1PreparedStatementBinding;
  /**
   * Execute several statements as ONE transaction.
   *
   * Required, not optional: `createPhoto` records a photograph and its tag links
   * together, and a sequential pair of `.run()` calls can leave a photograph
   * with missing tag links (or fail after the row exists) if the second call
   * fails. D1 batches are atomic, so either the whole record lands or none of it.
   */
  batch?(statements: readonly D1PreparedStatementBinding[]): Promise<readonly unknown[]>;
};

export type D1PreparedStatementBinding = {
  bind(...values: readonly unknown[]): D1PreparedStatementBinding;
  all<T = unknown>(): Promise<D1ResultLike<T>>;
  run<T = unknown>(): Promise<D1ResultLike<T>>;
};

export type D1ResultLike<T> = {
  readonly results?: readonly T[];
  readonly success?: boolean;
};

type GalleryRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  cover_photo_id: string | null;
  display_order: number;
  published: number;
  created_at: string;
  updated_at: string;
};

type PhotoRow = {
  id: string;
  title: string;
  slug: string;
  description: string;
  gallery_id: string;
  location: string | null;
  capture_date: string | null;
  width: number;
  height: number;
  original_storage_key: string;
  web_storage_key: string;
  thumbnail_storage_key: string;
  watermark_enabled: number;
  watermark_position: string;
  featured: number;
  published: number;
  print_available: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

type TagRow = {
  id: string;
  name: string;
  slug: string;
};

function toGalleryRecord(row: GalleryRow): GalleryRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    coverPhotoId: row.cover_photo_id,
    displayOrder: row.display_order,
    published: row.published === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPhotoRecord(row: PhotoRow, tags: readonly string[]): PhotoRecord {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    galleryId: row.gallery_id,
    tags,
    location: row.location,
    captureDate: row.capture_date,
    width: row.width,
    height: row.height,
    orientation: orientationOf(row.width, row.height),
    originalStorageKey: row.original_storage_key,
    webStorageKey: row.web_storage_key,
    thumbnailStorageKey: row.thumbnail_storage_key,
    watermarkEnabled: row.watermark_enabled === 1,
    watermarkPosition: normaliseWatermarkPosition(row.watermark_position),
    featured: row.featured === 1,
    // Editorial slot is presentation-only and derived when featuring.
    featuredVariant: "a",
    published: row.published === 1,
    printAvailable: row.print_available === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

/**
 * True when a value looks like a D1 binding.
 *
 * Exported so a server module can decide whether it is able to consult the
 * database at all — the media route refuses to serve anything it cannot prove is
 * published, and needs exactly this test to fail closed.
 */
export function isD1Binding(value: unknown): value is D1DatabaseBinding {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { prepare?: unknown }).prepare === "function"
  );
}

const PUBLISHED_GALLERY = "g.published = 1";
const PUBLISHED_PHOTO = "p.published = 1";
const PHOTO_ORDER = "p.published_at DESC, p.slug ASC";

export class D1PortfolioRepository implements PortfolioRepository {
  readonly #db: D1DatabaseBinding;

  constructor(db: D1DatabaseBinding) {
    this.#db = db;
  }

  async #all<T>(statement: D1PreparedStatementBinding): Promise<readonly T[]> {
    const result = await statement.all<T>();
    return result.results ?? [];
  }

  async #galleryRows(slug?: string): Promise<readonly GalleryRow[]> {
    const sql = slug
      ? `SELECT g.* FROM galleries g WHERE ${PUBLISHED_GALLERY} AND g.slug = ?1`
      : `SELECT g.* FROM galleries g WHERE ${PUBLISHED_GALLERY} ORDER BY g.display_order ASC, g.slug ASC`;
    const statement = slug ? this.#db.prepare(sql).bind(slug) : this.#db.prepare(sql);
    return this.#all<GalleryRow>(statement);
  }

  async listGalleries(): Promise<readonly PublicGallery[]> {
    const rows = await this.#galleryRows();
    return rows.map(toGalleryRecord).map(toPublicGallery);
  }

  async getGallery(slug: string): Promise<PublicGalleryWithPhotos | null> {
    const rows = await this.#galleryRows(slug);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const gallery = toGalleryRecord(row);
    const photos = await this.#photosForGallery(gallery.id);
    const tagsByPhoto = await this.#tagsForPhotos(photos.map((photo) => photo.id));
    return {
      ...toPublicGallery(gallery),
      photos: photos.map((photo) =>
        toPublicPhoto(toPhotoRecord(photo, tagsByPhoto.get(photo.id) ?? [])),
      ),
    };
  }

  async photoCounts(): Promise<ReadonlyMap<string, number>> {
    const rows = await this.#all<{ gallery_id: string; total: number }>(
      this.#db.prepare(
        `SELECT p.gallery_id AS gallery_id, COUNT(*) AS total
           FROM photos p
           JOIN galleries g ON g.id = p.gallery_id
          WHERE ${PUBLISHED_PHOTO} AND ${PUBLISHED_GALLERY}
          GROUP BY p.gallery_id`,
      ),
    );
    return new Map(rows.map((row) => [row.gallery_id, Number(row.total)]));
  }

  async listPhotos(): Promise<readonly PublicPhoto[]> {
    const rows = await this.#publishedPhotoRows();
    const tagsByPhoto = await this.#tagsForPhotos(rows.map((row) => row.id));
    return rows.map((row) => toPublicPhoto(toPhotoRecord(row, tagsByPhoto.get(row.id) ?? [])));
  }

  async getPhoto(slug: string): Promise<PublicPhotoWithGallery | null> {
    const row = (await this.#publishedPhotoRows(slug))[0];
    if (!row) {
      return null;
    }
    const gallery = await this.#galleryForId(row.gallery_id);
    if (!gallery) {
      return null;
    }
    const tagsByPhoto = await this.#tagsForPhotos([row.id]);
    return toPublicPhotoWithGallery(
      toPhotoRecord(row, tagsByPhoto.get(row.id) ?? []),
      gallery,
    );
  }

  async getPhotoDetail(slug: string): Promise<PublicPhotoDetail | null> {
    const resolved = await this.getPhoto(slug);
    if (!resolved) {
      return null;
    }
    const siblings = await this.#photosForGallery(resolved.galleryId);
    const tagsByPhoto = await this.#tagsForPhotos(siblings.map((photo) => photo.id));
    const index = siblings.findIndex((candidate) => candidate.slug === slug);
    const previousRow = index > 0 ? siblings[index - 1] ?? null : null;
    const nextRow = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] ?? null : null;
    return {
      photo: resolved,
      gallery: resolved.gallery,
      previous: previousRow
        ? toPublicPhoto(toPhotoRecord(previousRow, tagsByPhoto.get(previousRow.id) ?? []))
        : null,
      next: nextRow
        ? toPublicPhoto(toPhotoRecord(nextRow, tagsByPhoto.get(nextRow.id) ?? []))
        : null,
    };
  }

  async listFeatured(limit?: number): Promise<readonly PublicPhotoWithGallery[]> {
    const rows = await this.#all<PhotoRow>(
      this.#db.prepare(
        `SELECT p.* FROM photos p
           JOIN galleries g ON g.id = p.gallery_id
          WHERE ${PUBLISHED_PHOTO} AND ${PUBLISHED_GALLERY} AND p.featured = 1
          ORDER BY ${PHOTO_ORDER}${typeof limit === "number" ? " LIMIT ?1" : ""}`,
      ).bind(...(typeof limit === "number" ? [limit] : [])),
    );
    return this.#attachGalleries(rows);
  }

  async listRecent(limit: number): Promise<readonly PublicPhotoWithGallery[]> {
    const rows = await this.#all<PhotoRow>(
      this.#db.prepare(
        `SELECT p.* FROM photos p
           JOIN galleries g ON g.id = p.gallery_id
          WHERE ${PUBLISHED_PHOTO} AND ${PUBLISHED_GALLERY}
          ORDER BY ${PHOTO_ORDER}
          LIMIT ?1`,
      ).bind(limit),
    );
    return this.#attachGalleries(rows);
  }

  /**
   * Published photographs offered for print enquiries.
   *
   * The eligibility condition is ADDED to the publication conditions rather than
   * replacing them, and the two are separate predicates in the same WHERE clause
   * so neither can be satisfied by the other: a row must be published, its gallery
   * must be published, AND `print_available` must be 1. That is what makes
   * "marking a draft print-eligible" unable to publish it.
   */
  async listPrintEligible(limit?: number): Promise<readonly PublicPhotoWithGallery[]> {
    const rows = await this.#all<PhotoRow>(
      this.#db.prepare(
        `SELECT p.* FROM photos p
           JOIN galleries g ON g.id = p.gallery_id
          WHERE ${PUBLISHED_PHOTO} AND ${PUBLISHED_GALLERY} AND p.print_available = 1
          ORDER BY ${PHOTO_ORDER}${typeof limit === "number" ? " LIMIT ?1" : ""}`,
      ).bind(...(typeof limit === "number" ? [limit] : [])),
    );
    return this.#attachGalleries(rows);
  }

  async resolveTags(tagIds: readonly string[]): Promise<readonly PublicTag[]> {
    const unique = [...new Set(tagIds)];
    if (unique.length === 0) {
      return [];
    }
    const placeholders = unique.map((_, index) => `?${index + 1}`).join(", ");
    const rows = await this.#all<TagRow>(
      this.#db.prepare(`SELECT id, name, slug FROM tags WHERE id IN (${placeholders})`).bind(...unique),
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const resolved: PublicTag[] = [];
    for (const tagId of tagIds) {
      const row = byId.get(tagId);
      if (row) {
        resolved.push({ name: row.name, slug: row.slug });
      }
    }
    return resolved;
  }

  async listTags(): Promise<readonly PublicTag[]> {
    const rows = await this.#all<TagRow>(
      this.#db.prepare(
        `SELECT DISTINCT t.id AS id, t.name AS name, t.slug AS slug
           FROM tags t
           JOIN photo_tags pt ON pt.tag_id = t.id
           JOIN photos p ON p.id = pt.photo_id
           JOIN galleries g ON g.id = p.gallery_id
          WHERE ${PUBLISHED_PHOTO} AND ${PUBLISHED_GALLERY}
          ORDER BY t.name ASC`,
      ),
    );
    return rows.map((row) => ({ name: row.name, slug: row.slug }));
  }

  async getGalleryCover(gallery: PublicGallery): Promise<PublicPhoto | null> {
    const rows = await this.#photosForGallery(gallery.id);
    const cover = gallery.coverPhotoId
      ? rows.find((row) => row.id === gallery.coverPhotoId)
      : undefined;
    const chosen = cover ?? rows[0];
    if (!chosen) {
      return null;
    }
    const tagsByPhoto = await this.#tagsForPhotos([chosen.id]);
    return toPublicPhoto(toPhotoRecord(chosen, tagsByPhoto.get(chosen.id) ?? []));
  }

  /** Published photographs of one gallery, newest first. */
  async #photosForGallery(galleryId: string): Promise<readonly PhotoRow[]> {
    return this.#all<PhotoRow>(
      this.#db.prepare(
        `SELECT p.* FROM photos p
          WHERE ${PUBLISHED_PHOTO} AND p.gallery_id = ?1
          ORDER BY ${PHOTO_ORDER}`,
      ).bind(galleryId),
    );
  }

  async #publishedPhotoRows(slug?: string): Promise<readonly PhotoRow[]> {
    const sql = slug
      ? `SELECT p.* FROM photos p
           JOIN galleries g ON g.id = p.gallery_id
          WHERE ${PUBLISHED_PHOTO} AND ${PUBLISHED_GALLERY} AND p.slug = ?1`
      : `SELECT p.* FROM photos p
           JOIN galleries g ON g.id = p.gallery_id
          WHERE ${PUBLISHED_PHOTO} AND ${PUBLISHED_GALLERY}
          ORDER BY ${PHOTO_ORDER}`;
    const statement = slug ? this.#db.prepare(sql).bind(slug) : this.#db.prepare(sql);
    return this.#all<PhotoRow>(statement);
  }

  async #galleryForId(galleryId: string): Promise<GalleryRecord | null> {
    const rows = await this.#all<GalleryRow>(
      this.#db.prepare(`SELECT g.* FROM galleries g WHERE ${PUBLISHED_GALLERY} AND g.id = ?1`).bind(galleryId),
    );
    const row = rows[0];
    return row ? toGalleryRecord(row) : null;
  }

  /** Tag ids used by each supplied photograph. */
  async #tagsForPhotos(photoIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
    const map = new Map<string, string[]>();
    if (photoIds.length === 0) {
      return map;
    }
    const placeholders = photoIds.map((_, index) => `?${index + 1}`).join(", ");
    const rows = await this.#all<{ photo_id: string; tag_id: string }>(
      this.#db
        .prepare(
          `SELECT photo_id, tag_id FROM photo_tags
            WHERE photo_id IN (${placeholders})
            ORDER BY tag_id ASC`,
        )
        .bind(...photoIds),
    );
    for (const row of rows) {
      const existing = map.get(row.photo_id);
      if (existing) {
        existing.push(row.tag_id);
      } else {
        map.set(row.photo_id, [row.tag_id]);
      }
    }
    return map;
  }

  /** Project a photograph list with its publishing galleries and editorial slots. */
  async #attachGalleries(rows: readonly PhotoRow[]): Promise<readonly PublicPhotoWithGallery[]> {
    if (rows.length === 0) {
      return [];
    }
    const tagsByPhoto = await this.#tagsForPhotos(rows.map((row) => row.id));
    const galleries = await this.#all<GalleryRow>(
      this.#db.prepare(`SELECT g.* FROM galleries g WHERE ${PUBLISHED_GALLERY}`),
    );
    const galleriesById = new Map(galleries.map((row) => [row.id, toGalleryRecord(row)]));

    const result: PublicPhotoWithGallery[] = [];
    rows.forEach((row, index) => {
      const gallery = galleriesById.get(row.gallery_id);
      if (!gallery) {
        return;
      }
      const record: PhotoRecord = {
        ...toPhotoRecord(row, tagsByPhoto.get(row.id) ?? []),
        featuredVariant: editorialSlotForIndex(index),
      };
      result.push(toPublicPhotoWithGallery(record, gallery));
    });
    return result;
  }

  /**
   * A slug no photograph holds yet.
   *
   * Uniqueness is ultimately the database's job (`photos.slug` is UNIQUE), but
   * this asks first so the common case produces `title` rather than a suffix.
   * Existing suffixes are counted rather than guessed, so a base that already
   * ends in `-2` cannot collide with a generated `-2`.
   */
  async availablePhotoSlug(preferred: string): Promise<string> {
    const base = slugify(preferred) ?? "photo";
    const rows = await this.#all<{ slug: string }>(
      this.#db
        .prepare("SELECT slug FROM photos WHERE slug = ?1 OR slug LIKE ?2")
        .bind(base, `${base}-%`),
    );
    const taken = new Set(rows.map((row) => row.slug));
    if (!taken.has(base)) {
      return base;
    }
    // Bounded: the loop stops at the first free suffix, and the UNIQUE column
    // still refuses a duplicate if two uploads race for the same name.
    for (let attempt = 2; attempt <= 1000; attempt += 1) {
      const candidate = suffixedSlug(base, attempt);
      if (!taken.has(candidate)) {
        return candidate;
      }
    }
    return `${base}-${Date.now()}`;
  }

  /**
   * Record a photograph from an accepted upload.
   *
   * The photograph row and EVERY tag link are committed in ONE D1 batch, which
   * is a single transaction: a failing tag foreign key, a slug collision or any
   * other statement leaves neither the photograph nor any link behind. A
   * sequential pair of `.run()` calls could not promise that — the row would
   * already exist when the link insert failed.
   *
   * Duplicate tag ids are collapsed first: the junction table's primary key
   * would reject a repeat, and a repeated tag is an operator slip rather than a
   * reason to fail an otherwise valid upload.
   */
  async createPhoto(input: NewPhotoInput): Promise<PhotoRecord> {
    const now = new Date().toISOString();
    const tagIds = [...new Set(input.tags)];

    const statements: D1PreparedStatementBinding[] = [
      this.#db
        .prepare(
          `INSERT INTO photos (
             id, title, slug, description, gallery_id, location, capture_date,
             width, height, original_storage_key, web_storage_key, thumbnail_storage_key,
             watermark_enabled, watermark_position, featured, published, print_available,
             created_at, updated_at, published_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)`,
        )
        .bind(
          input.id,
          input.title,
          input.slug,
          input.description,
          input.galleryId,
          input.location,
          input.captureDate,
          input.width,
          input.height,
          input.originalStorageKey,
          input.webStorageKey,
          input.thumbnailStorageKey,
          input.watermarkEnabled ? 1 : 0,
          input.watermarkPosition,
          input.featured ? 1 : 0,
          input.published ? 1 : 0,
          input.printAvailable ? 1 : 0,
          now,
          now,
          input.published ? now : null,
        ),
      ...tagIds.map((tagId) =>
        this.#db.prepare("INSERT INTO photo_tags (photo_id, tag_id) VALUES (?1, ?2)").bind(
          input.id,
          tagId,
        ),
      ),
    ];

    if (typeof this.#db.batch !== "function") {
      // Fail loudly rather than silently degrading to non-atomic writes. A
      // binding without `batch` cannot honour the all-or-nothing guarantee this
      // method exists to provide.
      throw new Error(
        "The D1 binding does not expose batch(), so the photograph and its tag links " +
          "cannot be committed atomically. Refusing to write a partial record.",
      );
    }
    await this.#db.batch(statements);

    return {
      id: input.id,
      title: input.title,
      slug: input.slug,
      description: input.description,
      galleryId: input.galleryId,
      tags: tagIds,
      location: input.location,
      captureDate: input.captureDate,
      width: input.width,
      height: input.height,
      orientation: orientationOf(input.width, input.height),
      originalStorageKey: input.originalStorageKey,
      webStorageKey: input.webStorageKey,
      thumbnailStorageKey: input.thumbnailStorageKey,
      watermarkEnabled: input.watermarkEnabled,
      watermarkPosition: input.watermarkPosition,
      featured: input.featured,
      featuredVariant: "a",
      published: input.published,
      printAvailable: input.printAvailable,
      createdAt: now,
      updatedAt: now,
      publishedAt: input.published ? now : null,
    };
  }
}
