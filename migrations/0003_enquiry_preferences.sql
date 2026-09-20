-- Anyaparallax V1 — print-enquiry preferences and duplicate-submission safety
-- (Slice 08).
--
-- ADDITIVE ONLY. Migration 0001 already created `enquiries` with the bounded V1
-- shape (id, name, email, category, message, photo_id, status, created_at,
-- updated_at) and `photos.print_available`. Nothing here alters an existing
-- column, so applying this file to an already-migrated database is safe and no
-- table rebuild is required.
--
-- WHAT THIS ADDS, AND WHY EACH COLUMN IS NARROW:
--
--   print_format      The visitor's format PREFERENCE for a print enquiry. The
--                     values are the formats the build sheet names for print
--                     products; the CHECK mirrors the allow-list in
--                     `app/enquiries/enquiry.ts` so an invalid value cannot be
--                     stored even by a caller that skipped validation. It is an
--                     ENQUIRY preference, not a product variant: there is no
--                     price, no stock and no order.
--
--   print_size        The visitor's size preference as free text, because the
--                     build sheet states that physical dimensions are an
--                     operator decision that V1 must not invent. The length
--                     bound is enforced here as well as in the application.
--
--   submission_token  An idempotency key, not an identity. The form render
--                     issues one opaque token; a browser retry or a double-click
--                     replays the SAME token, so the unique index below collapses
--                     it to one enquiry. This is the duplicate-submission safety
--                     mechanism for Slice 08 and it deliberately records nothing
--                     about the submitter: no address, no user agent, no
--                     referrer, no browser fingerprint, and NOT the anonymous
--                     engagement cookie or its digest.
--
-- There is deliberately NO payment state, fulfilment state, shipment tracking,
-- order total, tax total or transaction id. An enquiry is not an order, and the
-- schema must not be able to pretend otherwise.

-- SQLite's `ALTER TABLE ... ADD COLUMN` accepts a column-level CHECK, so the
-- constraints below are real for every row written after this migration.
-- `print_format` is nullable: a general contact message has no format at all,
-- and a print enquiry that expresses no preference stores the explicit
-- 'no-preference' value rather than NULL, so "not asked" and "asked, no
-- preference" stay distinguishable.
ALTER TABLE enquiries ADD COLUMN print_format TEXT
  CHECK (
    print_format IS NULL
    OR print_format IN (
      'photographic-print',
      'fine-art-print',
      'framed-print',
      'no-preference'
    )
  );

ALTER TABLE enquiries ADD COLUMN print_size TEXT
  CHECK (print_size IS NULL OR (length(print_size) >= 1 AND length(print_size) <= 40));

-- Nullable on purpose: SQLite treats NULLs as distinct in a unique index, so a
-- row created without a token (an operator-entered record, or a future import)
-- never collides with another. A token, when present, may identify exactly one
-- enquiry.
ALTER TABLE enquiries ADD COLUMN submission_token TEXT
  CHECK (submission_token IS NULL OR (length(submission_token) >= 16 AND length(submission_token) <= 64));

CREATE UNIQUE INDEX IF NOT EXISTS idx_enquiries_submission_token
  ON enquiries (submission_token);
