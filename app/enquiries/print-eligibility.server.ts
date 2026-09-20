/**
 * Print eligibility, from the operator's side (Slice 08) — server only.
 *
 * The public side of print availability is the repository projection
 * (`PublicPhoto.printAvailable`). This module is the WRITE side plus the
 * operator's read, and it exists because availability must be an explicit
 * editorial decision on a stored photograph — not something inferred from an
 * original, and not something only settable at upload time.
 *
 * The read deliberately includes UNPUBLISHED photographs: an operator decides
 * what will be offered before publishing it, and a list that hid drafts would
 * make the decision impossible to make in the right order. The write is a single
 * column update, and `published` is never in the statement.
 *
 * D1 only, with no seed fallback — the same rule engagement follows. A seed set
 * cannot store an editorial decision, and reporting one as saved when it was not
 * would be worse than saying the surface is unavailable.
 */
import { isD1Binding } from "../data/repository.d1.server";
import {
  PRINT_ELIGIBILITY_LIST_LIMIT,
  type PhotoPrintOption,
  type PrintEligibilityResult,
  type PrintEligibilityView,
} from "./print-eligibility";

/** What this feature needs from the environment. */
export type PrintEligibilityEnvironment = {
  readonly DB?: unknown;
};

type PhotoPrintRow = {
  id: string;
  title: string;
  slug: string;
  published: number;
  print_available: number;
};

function toPhotoPrintOption(row: PhotoPrintRow): PhotoPrintOption {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    // The column is INTEGER 0/1 with a NOT NULL default, so the comparison is
    // exact rather than truthy: anything other than 1 is not published.
    published: row.published === 1,
    printAvailable: row.print_available === 1,
  };
}

/**
 * Every photograph, with its publication and print-eligibility state.
 *
 * Newest first, drafts included, bounded. The operator surface shows the
 * publication state alongside each row, which is what makes the difference
 * between "offered for print" and "visible to visitors" visible to the person
 * making the decision.
 */
export async function listPhotoPrintOptions(
  env: PrintEligibilityEnvironment | undefined,
): Promise<PrintEligibilityView> {
  const db = env?.DB;
  if (!isD1Binding(db)) {
    return {
      available: false,
      reason: "No database is configured in this environment, so print eligibility cannot be read.",
    };
  }
  try {
    const result = await db
      .prepare(
        `SELECT id, title, slug, published, print_available
           FROM photos
          ORDER BY published DESC, published_at DESC, slug ASC
          LIMIT ?1`,
      )
      .bind(PRINT_ELIGIBILITY_LIST_LIMIT)
      .all<PhotoPrintRow>();
    return { available: true, photos: (result.results ?? []).map(toPhotoPrintOption) };
  } catch {
    return { available: false, reason: "The photograph list could not be read." };
  }
}

/**
 * Set whether a photograph is offered for print enquiries.
 *
 * ONE column changes. The statement cannot publish, unpublish, feature, retitle
 * or otherwise alter the photograph, so marking a draft eligible for print cannot
 * make it reachable — a rule the checks prove against real D1 rather than
 * assuming from this comment.
 *
 * The stored value is read back and compared before success is reported, so the
 * answer is what the database holds rather than what the statement intended.
 * `not-found` covers both an unknown id and a photograph that was deleted between
 * the list being rendered and the form being submitted.
 */
export async function setPhotoPrintAvailable(
  env: PrintEligibilityEnvironment | undefined,
  photoId: unknown,
  available: unknown,
): Promise<PrintEligibilityResult> {
  if (
    typeof photoId !== "string" ||
    photoId.length === 0 ||
    photoId.length > 128 ||
    typeof available !== "boolean"
  ) {
    return { status: "bad-request" };
  }
  const db = env?.DB;
  if (!isD1Binding(db)) {
    return { status: "unavailable" };
  }
  try {
    await db
      .prepare("UPDATE photos SET print_available = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(available ? 1 : 0, new Date().toISOString(), photoId)
      .run();
    const result = await db
      .prepare("SELECT print_available FROM photos WHERE id = ?1 LIMIT 1")
      .bind(photoId)
      .all<{ print_available: number }>();
    const row = result.results?.[0];
    if (!row) {
      return { status: "not-found" };
    }
    const stored = row.print_available === 1;
    if (stored !== available) {
      // The statement did not achieve what it asked for, which must never be
      // reported as a change the operator can rely on.
      return { status: "unavailable" };
    }
    return { status: "ok", printAvailable: stored };
  } catch {
    return { status: "unavailable" };
  }
}
