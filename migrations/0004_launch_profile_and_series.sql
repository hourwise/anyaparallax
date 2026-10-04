-- Anyaparallax V1 launch content — gallery series.
--
-- Forward-only and additive: existing galleries and photographs remain valid because
-- `series_id` is nullable.  A series is editorial structure only; publication remains
-- controlled exclusively by photos.published AND galleries.published.

CREATE TABLE IF NOT EXISTS gallery_series (
  id TEXT PRIMARY KEY,
  gallery_id TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (gallery_id) REFERENCES galleries (id) ON DELETE RESTRICT,
  UNIQUE (gallery_id, slug),
  UNIQUE (id, gallery_id)
);

ALTER TABLE photos ADD COLUMN series_id TEXT
  REFERENCES gallery_series (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_gallery_series_order
  ON gallery_series (gallery_id, display_order, title);

CREATE INDEX IF NOT EXISTS idx_photos_series
  ON photos (series_id);

-- SQLite cannot add a composite FK to an existing table, so triggers provide the
-- database backstop for the same-gallery rule.  NULL deliberately means unassigned.
CREATE TRIGGER IF NOT EXISTS photos_series_same_gallery_insert
BEFORE INSERT ON photos
WHEN NEW.series_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM gallery_series s
    WHERE s.id = NEW.series_id AND s.gallery_id = NEW.gallery_id
 )
BEGIN
  SELECT RAISE(ABORT, 'photo series must belong to photo gallery');
END;

CREATE TRIGGER IF NOT EXISTS photos_series_same_gallery_update
BEFORE UPDATE OF gallery_id, series_id ON photos
WHEN NEW.series_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM gallery_series s
    WHERE s.id = NEW.series_id AND s.gallery_id = NEW.gallery_id
 )
BEGIN
  SELECT RAISE(ABORT, 'photo series must belong to photo gallery');
END;
