/**
 * Enquiry persistence (Slice 08) — server only.
 *
 * Enquiries live in D1, and ONLY in D1. There is deliberately no seed-backed
 * fallback and no in-memory queue: a development seed set cannot store an
 * enquiry, and inventing a store that forgets would let the site show "your
 * enquiry has been received" for a message that was never kept. When no database
 * is reachable the service reports itself UNAVAILABLE and the page says so.
 *
 * Three rules are enforced here, against the database, rather than trusted from a
 * caller:
 *
 *   1. A PHOTOGRAPH IS RESOLVED, NOT ACCEPTED. `eligiblePhotoFor()` is the only
 *      way a photograph reference becomes a stored `photo_id`, and it requires
 *      the row to be PUBLISHED, to sit in a PUBLISHED gallery, AND to be marked
 *      print-eligible. A client-submitted title, status or eligibility flag is
 *      never read; a draft cannot become visible by being named in an enquiry,
 *      and an ineligible photograph cannot be enquired about as though it were
 *      offered.
 *   2. DUPLICATE SUBMISSIONS COLLAPSE. `INSERT OR IGNORE` defers to the unique
 *      index on `submission_token` (migration 0003), so a browser retry or a
 *      double-click writing the same token leaves exactly one row. Nothing about
 *      the submitter is used to achieve that: the token is an idempotency key
 *      issued by the form render, not an identity.
 *   3. NOTHING ABOUT THE REQUEST IS STORED. The statements below bind only the
 *      values an operator needs in order to reply. There is no column for an
 *      address, a user agent, a referrer, a fingerprint or the engagement
 *      cookie, and this module never receives a `Request` to read one from.
 */
import type { D1DatabaseBinding } from "../data/repository.d1.server";
import { isD1Binding } from "../data/repository.d1.server";
import {
  DEFAULT_ENQUIRY_STATUS,
  ENQUIRY_LIMITS,
  isEnquiryCategory,
  isEnquiryStatus,
  isPrintFormat,
  type EnquiryInput,
  type StoredEnquiry,
} from "./enquiry";

/** What this feature needs from the environment. */
export type EnquiryEnvironment = {
  readonly DB?: unknown;
};

/** A photograph a visitor may legitimately enquire about, resolved from the database. */
export type EnquiryPhotoTarget = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
};

/** A raw `enquiries` row, as D1 returns it. */
type EnquiryRow = {
  id: string;
  name: string;
  email: string;
  category: string;
  message: string;
  photo_id: string | null;
  print_format: string | null;
  print_size: string | null;
  status: string;
  created_at: string;
  photo_title?: string | null;
  photo_slug?: string | null;
};

/**
 * Map a row to the operator-facing shape.
 *
 * `category` is the one column migration 0001 does not constrain with a CHECK, so
 * an unrecognised stored value is read defensively — the same convention
 * `normaliseWatermarkPosition()` uses for a stored watermark position — and falls
 * back to 'other' rather than being displayed as a value this application cannot
 * name. `print_format` and `status` ARE constrained by the database, and are
 * narrowed here as well so a future schema change cannot widen the type silently.
 */
function toStoredEnquiry(row: EnquiryRow): StoredEnquiry {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    category: isEnquiryCategory(row.category) ? row.category : "other",
    message: row.message,
    photoId: row.photo_id,
    photoTitle: row.photo_title ?? null,
    photoSlug: row.photo_slug ?? null,
    printFormat: isPrintFormat(row.print_format) ? row.print_format : null,
    printSize: row.print_size,
    status: isEnquiryStatus(row.status) ? row.status : DEFAULT_ENQUIRY_STATUS,
    createdAt: row.created_at,
  };
}

export class EnquiryStore {
  readonly #db: D1DatabaseBinding;

  constructor(db: D1DatabaseBinding) {
    this.#db = db;
  }

  /**
   * Resolve a slug to a photograph a print enquiry may name, or null.
   *
   * ALL THREE conditions are required and all three are checked in the database:
   * the photograph is published, its gallery is published, and it is explicitly
   * marked print-eligible. Publication is checked FIRST and independently of
   * eligibility, so marking a draft print-eligible cannot make it reachable — the
   * visibility rule of every other slice is restated here rather than assumed.
   */
  async eligiblePhotoFor(slug: string): Promise<EnquiryPhotoTarget | null> {
    const result = await this.#db
      .prepare(
        `SELECT p.id AS id, p.slug AS slug, p.title AS title
           FROM photos p
           JOIN galleries g ON g.id = p.gallery_id
          WHERE p.slug = ?1
            AND p.published = 1
            AND g.published = 1
            AND p.print_available = 1
          LIMIT 1`,
      )
      .bind(slug)
      .all<EnquiryPhotoTarget>();
    return result.results?.[0] ?? null;
  }

  /**
   * Store one enquiry, idempotently.
   *
   * `INSERT OR IGNORE` means a replayed token is a no-op rather than a second
   * row. The row is then read back BY TOKEN, and whether THIS call created it is
   * decided by comparing the stored id with the id this call generated: no
   * timestamp comparison, no reliance on a driver's change count, and the same
   * answer whether the retry arrived a millisecond or a day later.
   */
  async recordEnquiry(
    input: EnquiryInput,
  ): Promise<{ readonly id: string; readonly created: boolean }> {
    const id = `enquiry-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await this.#db
      .prepare(
        `INSERT OR IGNORE INTO enquiries
           (id, name, email, category, message, photo_id, print_format, print_size,
            submission_token, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      )
      .bind(
        id,
        input.name,
        input.email,
        input.category,
        input.message,
        input.photoId,
        input.printFormat,
        input.printSize,
        input.submissionToken,
        DEFAULT_ENQUIRY_STATUS,
        now,
        now,
      )
      .run();

    const stored = await this.#db
      .prepare("SELECT id FROM enquiries WHERE submission_token = ?1 LIMIT 1")
      .bind(input.submissionToken)
      .all<{ id: string }>();
    const row = stored.results?.[0];
    if (!row) {
      // The insert was ignored but no row carries the token, which means the
      // write did not land. Reporting the generated id here would claim a record
      // that does not exist, so this is an error rather than a success.
      throw new Error("The enquiry was not stored and no row carries its submission token.");
    }
    return { id: row.id, created: row.id === id };
  }

  /**
   * Enquiries for the operator, newest first.
   *
   * The photograph's title and slug are joined in so the operator can see WHICH
   * photograph an enquiry names without a second lookup. The join is not filtered
   * by publication: an operator is entitled to see that an enquiry was made about
   * a photograph that has since been unpublished, which is exactly the case where
   * the record matters most. Nothing here is reachable from a public route.
   */
  async listEnquiries(limit: number = ENQUIRY_LIMITS.operatorList): Promise<readonly StoredEnquiry[]> {
    const result = await this.#db
      .prepare(
        `SELECT e.id, e.name, e.email, e.category, e.message, e.photo_id,
                e.print_format, e.print_size, e.status, e.created_at,
                p.title AS photo_title, p.slug AS photo_slug
           FROM enquiries e
           LEFT JOIN photos p ON p.id = e.photo_id
          ORDER BY e.created_at DESC, e.id DESC
          LIMIT ?1`,
      )
      .bind(limit)
      .all<EnquiryRow>();
    return (result.results ?? []).map(toStoredEnquiry);
  }

  /**
   * Set an enquiry's handled state.
   *
   * The value is allow-listed by the caller before it arrives here, and the table
   * constrains it again. The stored state is read back and compared, so the answer
   * is what the database actually holds rather than what the statement asked for.
   */
  async setEnquiryStatus(id: string, status: string): Promise<boolean> {
    await this.#db
      .prepare("UPDATE enquiries SET status = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(status, new Date().toISOString(), id)
      .run();
    const result = await this.#db
      .prepare("SELECT status FROM enquiries WHERE id = ?1 LIMIT 1")
      .bind(id)
      .all<{ status: string }>();
    return result.results?.[0]?.status === status;
  }

  /** How many enquiries are stored, per handled state. */
  async statusCounts(): Promise<ReadonlyMap<string, number>> {
    const result = await this.#db
      .prepare("SELECT status, COUNT(*) AS total FROM enquiries GROUP BY status")
      .all<{ status: string; total: number }>();
    return new Map((result.results ?? []).map((row) => [row.status, Number(row.total)]));
  }
}

/**
 * The store for this environment, or null when an enquiry cannot be persisted.
 *
 * Returning null is the fail-closed answer a deployment with no database needs:
 * the form reports that nothing was saved rather than acknowledging an enquiry
 * that does not exist. It is deliberately NOT wired to the development seed
 * fallback the portfolio queries use, because a seed set cannot hold an enquiry.
 */
export function enquiryStoreFor(env: EnquiryEnvironment | undefined): EnquiryStore | null {
  return isD1Binding(env?.DB) ? new EnquiryStore(env.DB) : null;
}
