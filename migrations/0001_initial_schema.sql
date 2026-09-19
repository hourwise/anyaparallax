-- Anyaparallax V1 — initial schema (Slice 04).
--
-- Applies to Cloudflare D1. The TypeScript domain model in `app/data/model.ts`
-- maps to these tables through `app/data/d1-repository.server.ts`.
--
-- Conventions:
--   * ids are TEXT and application-generated (stable slugs use a separate unique column)
--   * timestamps are ISO-8601 TEXT
--   * dates are ISO `YYYY-MM-DD` TEXT
--   * booleans are INTEGER 0/1
--
-- Foreign keys are declared for documentation and local integrity checking.
-- D1 enforces them only when `PRAGMA foreign_keys = ON` is active for the
-- connection, so application code must not rely on them for business rules.
--
-- Storage keys: `photos.original_storage_key` locates the PRIVATE archival/print
-- master in the private bucket. `web_storage_key` and `thumbnail_storage_key`
-- locate PUBLIC derivatives. Nothing in the private bucket is ever served to a
-- visitor; see `app/data/storage.server.ts`.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('photographer', 'manager')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Tables are created in dependency order: `photos` before `galleries` so the
-- gallery-cover reference exists.
--
-- `photos.gallery_id` intentionally has no FOREIGN KEY constraint: `galleries`
-- references `photos` for its cover, so declaring both would create a cycle that
-- SQLite cannot add after the fact. The photograph→gallery relationship is
-- enforced by the repository layer and covered by the data checks, and every
-- public query joins through `galleries` anyway.

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  gallery_id TEXT NOT NULL,
  location TEXT,
  capture_date TEXT,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  original_storage_key TEXT NOT NULL,
  web_storage_key TEXT NOT NULL,
  thumbnail_storage_key TEXT NOT NULL,
  watermark_enabled INTEGER NOT NULL DEFAULT 1,
  watermark_position TEXT NOT NULL DEFAULT 'bottom-right'
    CHECK (watermark_position IN ('bottom-right', 'bottom-left', 'bottom-center', 'center', 'none')),
  featured INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  print_available INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS galleries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  cover_photo_id TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (cover_photo_id) REFERENCES photos (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS photo_tags (
  photo_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (photo_id, tag_id),
  FOREIGN KEY (photo_id) REFERENCES photos (id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
);

-- Aggregate engagement (slices 07+). A generated anonymous browser token plus
-- the photo id prevents obvious repeat likes without fingerprinting.
CREATE TABLE IF NOT EXISTS likes (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL,
  browser_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (photo_id) REFERENCES photos (id) ON DELETE CASCADE,
  UNIQUE (photo_id, browser_token)
);

-- Records that a share action was INITIATED in this application. It is not
-- evidence of an external post: `external_confirmed_at` stays null unless an
-- external service actually confirms publication.
CREATE TABLE IF NOT EXISTS share_events (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  created_at TEXT NOT NULL,
  external_confirmed_at TEXT,
  FOREIGN KEY (photo_id) REFERENCES photos (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS enquiries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  photo_id TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'read', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (photo_id) REFERENCES photos (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_galleries_published
  ON galleries (published, display_order);

CREATE INDEX IF NOT EXISTS idx_photos_gallery
  ON photos (gallery_id);

CREATE INDEX IF NOT EXISTS idx_photos_publication
  ON photos (published, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_photos_featured
  ON photos (featured, published, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_photo_tags_tag
  ON photo_tags (tag_id, photo_id);

CREATE INDEX IF NOT EXISTS idx_likes_photo
  ON likes (photo_id);

CREATE INDEX IF NOT EXISTS idx_share_events_photo
  ON share_events (photo_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_enquiries_status
  ON enquiries (status, created_at DESC);
