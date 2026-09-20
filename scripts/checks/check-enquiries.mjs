#!/usr/bin/env node
/**
 * Print eligibility and enquiry check (Slice 08).
 *
 * Driven against a REAL D1 database through the production store and service, so
 * the duplicate-submission backstop under test is the table's own unique index on
 * `submission_token` rather than a JavaScript guard that happens to agree with it,
 * and the publication/eligibility rules are the SQL the application actually runs.
 *
 * What this suite is built to catch:
 *
 *   * print eligibility that leaks a draft — a photograph marked available for
 *     prints while unpublished, or sitting in an unpublished gallery, appearing on
 *     `/prints` or being accepted by the enquiry form;
 *   * eligibility INFERRED from publication, or from the presence of an original,
 *     rather than stored as an explicit decision;
 *   * an operator action that changes publication while claiming to change only
 *     the print flag;
 *   * an enquiry stored twice for one form render, or lost under a double-click;
 *   * a draft or ineligible photograph attached to an enquiry because the client
 *     said so, or a client-supplied title/status/eligibility flag becoming stored
 *     state;
 *   * an overlong, malformed or invented value reaching storage;
 *   * an address, user agent, referrer, fingerprint or engagement token reaching
 *     the enquiries table;
 *   * a customer's details reachable from a public route;
 *   * copy or code that offers checkout, a basket, payment, an order, shipping or
 *     automated fulfilment that does not exist.
 */
import { register } from "node:module";

register("../ts-extension-hooks.mjs", import.meta.url);

const {
  CONTACT_CATEGORIES,
  ENQUIRY_CATEGORIES,
  ENQUIRY_CATEGORY_LABELS,
  ENQUIRY_COPY,
  ENQUIRY_LIMITS,
  ENQUIRY_STATUSES,
  ENQUIRY_STATUS_LABELS,
  FORBIDDEN_COMMERCE_CLAIMS,
  PRINT_ENQUIRY_CATEGORY,
  PRINT_FORMAT_LABELS,
  PRINT_FORMATS,
  carriesPrintPreferences,
  forbiddenCommerceClaimIn,
  isEnquiryCategory,
  isEnquiryStatus,
  isPrintFormat,
} = await import("../../app/enquiries/enquiry.ts");
const { fieldText, formValuesFrom, isValidEmailAddress, validateEnquiry } = await import(
  "../../app/enquiries/validation.ts"
);
const { EnquiryStore, enquiryStoreFor } = await import("../../app/enquiries/store.server.ts");
const { readEnquiryCounts, readEnquiries, submitEnquiry, updateEnquiryStatus } = await import(
  "../../app/enquiries/enquiries.server.ts"
);
const { listPhotoPrintOptions, setPhotoPrintAvailable } = await import(
  "../../app/enquiries/print-eligibility.server.ts"
);
const { D1PortfolioRepository } = await import("../../app/data/repository.d1.server.ts");
const { SeedPortfolioRepository } = await import("../../app/data/repository.seed.server.ts");
const { seed } = await import("../../app/data/seed.ts");
const { createD1TestDatabase } = await import("./d1-harness.mjs");
const { check, note, report } = await import("./report.mjs");
const { readFileSync, readdirSync } = await import("node:fs");
const { dirname, join, resolve } = await import("node:path");
const { fileURLToPath } = await import("node:url");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// --- Fixture database -----------------------------------------------------

const database = await createD1TestDatabase({ seed, label: "enquiries" });
const env = { DB: database.binding };
const store = new EnquiryStore(database.binding);
const repository = new D1PortfolioRepository(database.binding);
const seedRepository = new SeedPortfolioRepository();

const NOW = "2026-09-20T09:00:00.000Z";

/** A published, print-eligible photograph in a published gallery (from the seed set). */
const ELIGIBLE = "stage-haze";
/** A published photograph that is NOT offered for print. */
const NOT_ELIGIBLE = "closing-time";
/** A DRAFT photograph explicitly marked print-eligible, in a published gallery. */
const DRAFT = "studio-trial";
/** A DRAFT photograph marked print-eligible, in an UNPUBLISHED gallery. */
const DRAFT_HIDDEN = "unreleased-edit";
/** A published, print-eligible photograph in an UNPUBLISHED gallery (inserted below). */
const HIDDEN_GALLERY = "p-hidden-eligible";

function insertPhoto(id, galleryId, published, printAvailable) {
  database.exec(
    `INSERT INTO photos (id, title, slug, description, gallery_id, width, height,
       original_storage_key, web_storage_key, thumbnail_storage_key, watermark_enabled,
       watermark_position, featured, published, print_available, created_at, updated_at, published_at)
     VALUES ('${id}', 'Hidden offering', '${id}', 'A fixture photograph.', '${galleryId}', 100, 100,
       'r2://masters/originals/${id}/master.jpg',
       'r2://images/web/${id}/web.webp', 'r2://images/thumbs/${id}/thumb.webp', 0,
       'bottom-right', 0, ${published ? 1 : 0}, ${printAvailable ? 1 : 0},
       '${NOW}', '${NOW}', ${published ? `'${NOW}'` : "NULL"})`,
  );
}

// The seed set already provides the three load-bearing cases (a published eligible
// photograph, a published ineligible one, and two DRAFTS marked eligible). This
// adds the fourth: a published, eligible photograph whose GALLERY is unpublished,
// which isolates the gallery rule from the photograph rule.
insertPhoto(HIDDEN_GALLERY, "gallery-studio", 1, 1);

/** A fresh idempotency token, in the shape the form issues. */
function newToken() {
  return crypto.randomUUID();
}

/** The form values a route would extract from a submission. */
function printEnquiry(overrides = {}) {
  return {
    name: "Rowan Ellis",
    email: "rowan.ellis@example.com",
    category: PRINT_ENQUIRY_CATEGORY,
    message: "I would like to ask about a print of this photograph, please.",
    photoSlug: ELIGIBLE,
    printFormat: "fine-art-print",
    printSize: "about 40 × 50 cm",
    submissionToken: newToken(),
    ...overrides,
  };
}

function enquiryRows() {
  return database.query("SELECT * FROM enquiries ORDER BY created_at, id");
}

function clearEnquiries() {
  database.exec("DELETE FROM enquiries");
}

// --- A. Schema and migration ---------------------------------------------

const columns = database
  .query("PRAGMA table_info('enquiries')")
  .map((row) => row.name)
  .sort();
check(
  columns.join(",") ===
    "category,created_at,email,id,message,name,photo_id,print_format,print_size,status,submission_token,updated_at",
  `the enquiries table has an unexpected shape: ${columns.join(", ")}`,
);

// The schema must not be able to describe an order. This is the ecommerce
// non-goal stated as a structural property rather than as a review note.
const commerceColumns = columns.filter((column) =>
  /pay|order|total|price|amount|ship|tax|vat|transaction|fulfil|fulfill|stock|quantity|invoice/i.test(
    column,
  ),
);
check(
  commerceColumns.length === 0,
  `the enquiries table carries ecommerce columns: ${commerceColumns.join(", ")}`,
);

const tokenIndex = database.query(
  "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_enquiries_submission_token'",
)[0];
check(Boolean(tokenIndex), "migration 0003 did not create idx_enquiries_submission_token");
check((tokenIndex?.sql ?? "").includes("UNIQUE"), "the submission-token index is not UNIQUE");
check(
  (tokenIndex?.sql ?? "").includes("submission_token"),
  "the submission-token index does not cover submission_token",
);

const badFormat = database.probe([
  "INSERT INTO enquiries (id, name, email, category, message, print_format, status, created_at, updated_at) " +
    "VALUES ('e-bad-format', 'A', 'a@b.test', 'print-enquiry', 'm', 'poster', 'new', '2026-01-01', '2026-01-01')",
]);
check(
  /CHECK constraint failed/i.test(badFormat[0] ?? ""),
  "the print_format CHECK did not reject a format outside the allow-list",
);
const badSize = database.probe([
  `INSERT INTO enquiries (id, name, email, category, message, print_size, status, created_at, updated_at) ` +
    `VALUES ('e-bad-size', 'A', 'a@b.test', 'print-enquiry', 'm', '${"x".repeat(41)}', 'new', '2026-01-01', '2026-01-01')`,
]);
check(
  /CHECK constraint failed/i.test(badSize[0] ?? ""),
  "the print_size CHECK did not reject an overlong value",
);
const badStatus = database.probe([
  "INSERT INTO enquiries (id, name, email, category, message, status, created_at, updated_at) " +
    "VALUES ('e-bad-status', 'A', 'a@b.test', 'other', 'm', 'paid', '2026-01-01', '2026-01-01')",
]);
check(
  /CHECK constraint failed/i.test(badStatus[0] ?? ""),
  "enquiries.status accepted a value outside new/read/archived",
);

// A token may identify exactly one enquiry, at the database layer.
const duplicateToken = database.probe([
  "INSERT INTO enquiries (id, name, email, category, message, submission_token, status, created_at, updated_at) " +
    "VALUES ('e-token-1', 'A', 'a@b.test', 'other', 'm', 'token-probe-value-0001', 'new', '2026-01-01', '2026-01-01')",
  "INSERT INTO enquiries (id, name, email, category, message, submission_token, status, created_at, updated_at) " +
    "VALUES ('e-token-2', 'B', 'b@b.test', 'other', 'm', 'token-probe-value-0001', 'new', '2026-01-01', '2026-01-01')",
]);
check(duplicateToken[0] === null, `the first token probe failed: ${duplicateToken[0]}`);
check(
  /UNIQUE constraint failed/i.test(duplicateToken[1] ?? ""),
  "two enquiries were allowed to share one submission token",
);
note("schema: bounded enquiry columns, no commerce columns, allow-list CHECKs and a unique token index");

// --- B. Print eligibility is a stored decision ----------------------------

const d1Eligible = await repository.listPrintEligible();
const d1Slugs = d1Eligible.map((photo) => photo.slug);

check(d1Slugs.includes(ELIGIBLE), "a published print-eligible photograph is missing from /prints data");
check(
  !d1Slugs.includes(NOT_ELIGIBLE),
  "a published photograph that is NOT offered for print appeared in the print list",
);
check(
  !d1Slugs.includes(DRAFT),
  "a DRAFT marked print-eligible appeared in the print list: eligibility published a draft",
);
check(
  !d1Slugs.includes(DRAFT_HIDDEN),
  "a draft in an unpublished gallery appeared in the print list",
);
check(
  !d1Slugs.includes(HIDDEN_GALLERY),
  "a print-eligible photograph in an UNPUBLISHED gallery appeared in the print list",
);
check(
  d1Eligible.every((photo) => photo.printAvailable),
  "the print list contains a photograph that is not marked print-eligible",
);
check(
  !JSON.stringify(d1Eligible).includes("masters") &&
    !JSON.stringify(d1Eligible).includes("originalStorageKey"),
  "the print list carries a private master reference",
);
check(
  d1Eligible.every((photo) => typeof photo.thumbnailImagePath === "string"),
  "the print list does not carry browser-facing thumbnail paths",
);
// The limit must actually bound the query, which needs more than one eligible row
// to be observable. One is offered for print in the fixture; a second is made
// eligible for the duration of this assertion and then withdrawn again.
check(d1Eligible.length === 1, `the fixture offers ${d1Eligible.length} photographs for print, expected 1`);
database.exec(`UPDATE photos SET print_available = 1 WHERE id = '${NOT_ELIGIBLE}'`);
check(
  (await repository.listPrintEligible()).length === 2,
  "a second eligible photograph did not appear in the print list",
);
check(
  (await repository.listPrintEligible(1)).length === 1,
  "the print list limit was not respected",
);
database.exec(`UPDATE photos SET print_available = 0 WHERE id = '${NOT_ELIGIBLE}'`);
note(`print list (D1): ${d1Slugs.join(", ")}`);

// The development seed source must apply the same rule, or local behaviour would
// disagree with production about what is offered.
const seedSlugs = (await seedRepository.listPrintEligible()).map((photo) => photo.slug);
check(
  seedSlugs.includes(ELIGIBLE) &&
    !seedSlugs.includes(NOT_ELIGIBLE) &&
    !seedSlugs.includes(DRAFT) &&
    !seedSlugs.includes(DRAFT_HIDDEN),
  `the seed print list breaks the publication rule: ${seedSlugs.join(", ")}`,
);
check(
  seedSlugs.join(",") === d1Slugs.filter((slug) => slug !== HIDDEN_GALLERY).join(","),
  `the seed and D1 print lists disagree: seed [${seedSlugs.join(", ")}] vs D1 [${d1Slugs.join(", ")}]`,
);
const seedDrafts = seed.photos.filter((photo) => !photo.published && photo.printAvailable);
check(
  seedDrafts.length >= 2,
  "the seed set no longer contains a draft marked print-eligible, so that rule is not exercised",
);
note(`print list (seed): ${seedSlugs.join(", ")} across ${seedDrafts.length} eligible drafts`);

// --- C. A photograph is RESOLVED, not accepted ----------------------------

for (const [slug, expected, label] of [
  [ELIGIBLE, true, "a published print-eligible photograph"],
  [NOT_ELIGIBLE, false, "a published photograph that is not offered"],
  [DRAFT, false, "a draft marked print-eligible"],
  [DRAFT_HIDDEN, false, "a draft marked print-eligible in an unpublished gallery"],
  [HIDDEN_GALLERY, false, "a print-eligible photograph in an unpublished gallery"],
  ["no-such-photograph", false, "an unknown photograph"],
  ["", false, "an empty slug"],
  ["stage-haze' OR 1=1 --", false, "an injection-shaped slug"],
]) {
  const resolved = await store.eligiblePhotoFor(slug);
  check(
    (resolved !== null) === expected,
    `resolution of ${label} returned ${resolved === null ? "null" : JSON.stringify(resolved)}`,
  );
}
check(
  (await store.eligiblePhotoFor(ELIGIBLE))?.title ===
    seed.photos.find((photo) => photo.slug === ELIGIBLE)?.title,
  "the resolved photograph does not carry the stored title",
);

// --- D. Validation --------------------------------------------------------

const validInput = printEnquiry();
const validResult = validateEnquiry(validInput);
check(validResult.ok === true, `a valid print enquiry was refused: ${JSON.stringify(validResult)}`);
check(
  validResult.ok && !("photoId" in validResult.value),
  "validation invented a photograph id instead of leaving resolution to the server",
);

for (const [field, value, label] of [
  ["name", "", "an empty name"],
  ["name", "   ", "a whitespace-only name"],
  ["name", "x".repeat(ENQUIRY_LIMITS.name + 1), "an overlong name"],
  ["email", "", "an empty email"],
  ["message", "", "an empty message"],
  ["message", "x".repeat(ENQUIRY_LIMITS.message + 1), "an overlong message"],
  ["category", "", "a missing category"],
  ["category", "printer", "an invented category"],
  ["submissionToken", "", "a missing token"],
  ["submissionToken", "not-a-uuid", "a malformed token"],
  ["photoSlug", "Not A Slug", "a malformed photograph reference"],
  ["printFormat", "canvas", "a format outside the allow-list"],
  ["printSize", "x".repeat(ENQUIRY_LIMITS.printSize + 1), "an overlong size preference"],
]) {
  const result = validateEnquiry(printEnquiry({ [field]: value }));
  check(result.ok === false, `${label} was accepted`);
  check(
    result.ok === false && Boolean(result.errors[field]),
    `${label} was refused without an error on ${field}: ${JSON.stringify(result)}`,
  );
}

for (const [email, expected] of [
  ["rowan.ellis@example.com", true],
  ["r+prints@example.co.uk", true],
  ["first.last@sub.domain.example", true],
  ["rowan@example.xn--p1ai", true],
  ["rowan.ellis@example", false],
  ["rowan.ellis@.com", false],
  ["rowan.ellis@example..com", false],
  ["@example.com", false],
  ["rowan@", false],
  ["rowan ellis@example.com", false],
  ["rowan@exam ple.com", false],
  ["a@b.c", false],
  ["rowan@example.com,second@example.com", false],
  ["rowan@example.com;second@example.com", false],
  ["<rowan@example.com>", false],
  ["rowan@example.com\nbcc: someone@example.com", false],
  [`${"x".repeat(65)}@example.com`, false],
  [`rowan@${"x".repeat(254)}.com`, false],
]) {
  check(
    isValidEmailAddress(email) === expected,
    `email validation ${expected ? "refused" : "accepted"} ${JSON.stringify(email)}`,
  );
}
check(
  isValidEmailAddress("rowan.ellis@example.com") && !isValidEmailAddress("rowan.ellis@exa mple.com"),
  "the email rule is not distinguishing malformed input",
);

// The two journeys are not interchangeable. A general contact message carrying a
// photograph, a format or a size is REFUSED, not silently reduced.
for (const field of ["photoSlug", "printFormat", "printSize"]) {
  const result = validateEnquiry({
    name: "Rowan Ellis",
    email: "rowan.ellis@example.com",
    category: "gig-photography",
    message: "Are you free on the fourteenth?",
    [field]: field === "photoSlug" ? ELIGIBLE : field === "printFormat" ? "framed-print" : "A2",
    submissionToken: newToken(),
  });
  check(result.ok === false, `a contact message carrying ${field} was accepted`);
  check(
    result.ok === false && Boolean(result.errors[field]),
    `a contact message carrying ${field} was refused without saying so`,
  );
}
const contactValid = validateEnquiry({
  name: "Rowan Ellis",
  email: "rowan.ellis@example.com",
  category: "gig-photography",
  message: "Are you free on the fourteenth?",
  submissionToken: newToken(),
});
check(contactValid.ok === true, `a valid contact message was refused: ${JSON.stringify(contactValid)}`);
check(
  contactValid.ok && contactValid.value.printFormat === null && contactValid.value.printSize === null,
  "a contact message was given print preferences it did not ask for",
);

check(
  ENQUIRY_CATEGORIES.length === 6 && CONTACT_CATEGORIES.length === 5,
  "the category vocabulary changed size",
);
check(
  !CONTACT_CATEGORIES.includes(PRINT_ENQUIRY_CATEGORY),
  "the general contact categories include the print category",
);
check(
  PRINT_FORMATS.length === 4 && PRINT_FORMATS.every((format) => isPrintFormat(format)),
  "the print format allow-list is inconsistent",
);
check(
  carriesPrintPreferences(PRINT_ENQUIRY_CATEGORY) &&
    !carriesPrintPreferences("other") &&
    ENQUIRY_CATEGORIES.every((category) => isEnquiryCategory(category)),
  "the print/contact split is not defined by the category",
);
check(
  fieldText("  Rowan  ") === "Rowan" && fieldText(undefined) === "" && fieldText(42) === "42",
  "form values are not read defensively",
);
check(
  !fieldText("Ro\u0000wan\u0007").includes("\u0000"),
  "a control character survived being read from a form value",
);
note(`validation: ${ENQUIRY_CATEGORIES.length} categories, ${PRINT_FORMATS.length} formats, 18 email shapes`);

// --- E. Submission against real D1 ---------------------------------------

clearEnquiries();
const recorded = await submitEnquiry(printEnquiry(), env);
check(recorded.status === "recorded", `a valid print enquiry was not recorded: ${recorded.status}`);
check(enquiryRows().length === 1, `a valid print enquiry produced ${enquiryRows().length} rows`);

const storedRow = enquiryRows()[0] ?? {};
check(storedRow.status === "new", `a new enquiry was stored as ${storedRow.status}`);
check(storedRow.photo_id === ELIGIBLE, `the enquiry stored photo_id ${storedRow.photo_id}`);
check(storedRow.category === PRINT_ENQUIRY_CATEGORY, `the enquiry stored category ${storedRow.category}`);
check(storedRow.print_format === "fine-art-print", `the format was stored as ${storedRow.print_format}`);
check(storedRow.print_size === "about 40 × 50 cm", `the size was stored as ${storedRow.print_size}`);
check(
  typeof storedRow.submission_token === "string" && storedRow.submission_token.length === 36,
  "the enquiry did not store its submission token",
);
check(
  storedRow.created_at === storedRow.updated_at,
  "a new enquiry did not have matching created/updated timestamps",
);

// Duplicate safety: the SAME rendered form, submitted again.
const replayedToken = newToken();
const first = await submitEnquiry(printEnquiry({ submissionToken: replayedToken }), env);
const second = await submitEnquiry(printEnquiry({ submissionToken: replayedToken }), env);
check(first.status === "recorded" && second.status === "recorded", "a replayed submission was refused");
check(
  database.query("SELECT COUNT(*) AS total FROM enquiries WHERE submission_token = ?1", replayedToken)[0]
    ?.total === 1,
  "a replayed submission created more than one enquiry",
);

// A concurrent double-click.
const concurrentToken = newToken();
const concurrent = await Promise.all(
  Array.from({ length: 8 }, () => submitEnquiry(printEnquiry({ submissionToken: concurrentToken }), env)),
);
check(
  concurrent.every((outcome) => outcome.status === "recorded"),
  `a concurrent submission batch produced a failure: ${JSON.stringify(concurrent)}`,
);
check(
  database.query("SELECT COUNT(*) AS total FROM enquiries WHERE submission_token = ?1", concurrentToken)[0]
    ?.total === 1,
  "eight simultaneous identical submissions created more than one enquiry",
);
note("duplicate safety: a replayed token and 8 concurrent submissions each produced exactly one enquiry");

// Two DIFFERENT renders are two enquiries: the token is per render, not per person.
const beforeDistinct = enquiryRows().length;
await submitEnquiry(printEnquiry(), env);
await submitEnquiry(printEnquiry(), env);
check(
  enquiryRows().length === beforeDistinct + 2,
  "two separately rendered submissions were collapsed into one",
);

// A general contact message stores no photograph and no print preferences.
clearEnquiries();
const contactRecorded = await submitEnquiry(
  {
    name: "Sam Okonkwo",
    email: "sam.okonkwo@example.com",
    category: "car-photography",
    message: "Do you shoot car meets?",
    submissionToken: newToken(),
  },
  env,
);
check(contactRecorded.status === "recorded", "a valid contact message was not recorded");
const contactRow = enquiryRows()[0] ?? {};
check(contactRow.photo_id === null, "a contact message stored a photograph");
check(
  contactRow.print_format === null && contactRow.print_size === null,
  "a contact message stored print preferences",
);

// Photographs that must NOT be attachable.
for (const [slug, label] of [
  [DRAFT, "a draft marked print-eligible"],
  [DRAFT_HIDDEN, "a draft in an unpublished gallery"],
  [HIDDEN_GALLERY, "a print-eligible photograph in an unpublished gallery"],
  [NOT_ELIGIBLE, "a published photograph that is not offered for print"],
  ["no-such-photograph", "an unknown photograph"],
]) {
  clearEnquiries();
  const outcome = await submitEnquiry(printEnquiry({ photoSlug: slug }), env);
  check(
    outcome.status === "invalid",
    `an enquiry naming ${label} returned ${outcome.status} instead of being refused`,
  );
  check(
    outcome.status === "invalid" && Boolean(outcome.errors.photoSlug),
    `an enquiry naming ${label} was refused without an error naming the photograph`,
  );
  check(
    enquiryRows().length === 0,
    `an enquiry naming ${label} was stored anyway (${enquiryRows().length} rows)`,
  );
}

// A client cannot make a photograph eligible, or name one that is not, by
// supplying authoritative-looking fields. Only the resolved id is ever stored.
clearEnquiries();
const forged = await submitEnquiry(
  {
    ...printEnquiry({ photoSlug: ELIGIBLE }),
    photoId: DRAFT,
    title: "Client supplied title",
    published: "1",
    printAvailable: "1",
    status: "read",
  },
  env,
);
check(forged.status === "recorded", "a submission carrying extra fields was refused outright");
const forgedRow = enquiryRows()[0] ?? {};
check(forgedRow.photo_id === ELIGIBLE, `a client-supplied photo id was stored: ${forgedRow.photo_id}`);
check(forgedRow.status === "new", `a client-supplied status was stored: ${forgedRow.status}`);
check(
  !JSON.stringify(forgedRow).includes("Client supplied title"),
  "a client-supplied title reached storage",
);
check(
  !/title|published|available/i.test(Object.keys(forgedRow).join(",")),
  `the enquiries table stores a client-supplied publication or eligibility flag: ${Object.keys(forgedRow).join(", ")}`,
);

// No database: refuse rather than acknowledge.
clearEnquiries();
const noDatabase = await submitEnquiry(printEnquiry(), {});
check(noDatabase.status === "unavailable", `submitting without a database returned ${noDatabase.status}`);
check(enquiryRows().length === 0, "a submission without a database still wrote a row");
check(enquiryStoreFor({}) === null, "an enquiry store was constructed without a database binding");
check(enquiryStoreFor(undefined) === null, "an enquiry store was constructed from an undefined environment");

// An enquiry about a photograph that is eligible but whose gallery is not, using
// the same slug the operator could have marked from the admin surface.
database.exec(`UPDATE photos SET print_available = 1 WHERE id = '${NOT_ELIGIBLE}'`);
clearEnquiries();
const newlyEligible = await submitEnquiry(printEnquiry({ photoSlug: NOT_ELIGIBLE }), env);
check(
  newlyEligible.status === "recorded",
  "a photograph marked eligible after the page was rendered could not be enquired about",
);
database.exec(`UPDATE photos SET print_available = 0 WHERE id = '${NOT_ELIGIBLE}'`);
clearEnquiries();
const noLongerEligible = await submitEnquiry(printEnquiry({ photoSlug: NOT_ELIGIBLE }), env);
check(
  noLongerEligible.status === "invalid",
  "an enquiry was accepted for a photograph that is no longer offered (a stale page was replayed)",
);

// --- F. Privacy: nothing about the request is stored ----------------------

// The hostile request below is what a route would receive. The route extracts the
// FORM VALUES from it and hands those — and only those — to the write path, which
// is the property being proved: the submission is built from `formData()` alone.
const ENGAGEMENT_COOKIE = "anyaparallax_browser";
const hostileToken = crypto.randomUUID();
const hostileDigest = [...new Uint8Array(
  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hostileToken)),
)]
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");
const hostileBody = new URLSearchParams(
  Object.entries(printEnquiry()).map(([key, value]) => [key, String(value)]),
);
const hostileRequest = new Request("https://anyaparallax.co.uk/prints/enquire", {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    cookie: `${ENGAGEMENT_COOKIE}=${hostileToken}`,
    "user-agent": "FingerprintBot/9.9 (definitely-not-a-browser)",
    "x-forwarded-for": "203.0.113.42",
    "cf-connecting-ip": "198.51.100.77",
    referer: "https://anyaparallax.co.uk/prints?tracking=1",
    "accept-language": "de-DE,de;q=0.9",
    "sec-ch-ua-platform": "Windows",
  },
  body: hostileBody.toString(),
});
const hostileForm = await hostileRequest.formData();
clearEnquiries();
const fromRequest = await submitEnquiry(
  {
    name: hostileForm.get("name"),
    email: hostileForm.get("email"),
    category: hostileForm.get("category"),
    message: hostileForm.get("message"),
    photoSlug: hostileForm.get("photoSlug"),
    printFormat: hostileForm.get("printFormat"),
    printSize: hostileForm.get("printSize"),
    submissionToken: hostileForm.get("submissionToken"),
  },
  env,
);
check(fromRequest.status === "recorded", "a submission built from request form values was refused");
const privacyRow = enquiryRows()[0] ?? {};
const privacyJson = JSON.stringify(privacyRow);
for (const [label, value] of [
  ["the client address", "203.0.113.42"],
  ["the connecting address", "198.51.100.77"],
  ["the user agent", "FingerprintBot"],
  ["the referrer", "tracking=1"],
  ["the language header", "de-DE"],
  ["the client-hint header", "Windows"],
  ["the engagement cookie name", ENGAGEMENT_COOKIE],
  ["the engagement cookie value", hostileToken],
  ["a digest of the engagement token", hostileDigest],
]) {
  check(!privacyJson.includes(value), `the stored enquiry contains ${label}`);
}
check(
  Object.keys(privacyRow).sort().join(",") === columns.join(","),
  "the stored enquiry row does not match the bounded column set",
);
note("privacy: a submission carrying addresses, a user agent, a referrer and an engagement cookie stored none of them");

// The structural complement: the write path has no way to read any of it.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const enquiryModules = readdirSync(resolve(root, "app", "enquiries")).filter((name) =>
  /\.ts$/.test(name),
);
check(enquiryModules.length >= 5, `the enquiry feature has only ${enquiryModules.length} modules`);

for (const name of enquiryModules) {
  const source = stripComments(readFileSync(resolve(root, "app", "enquiries", name), "utf8"));
  for (const [label, pattern] of [
    ["reads request headers", /\.headers\b/],
    ["reads a request at all", /\brequest\./],
    ["names the user agent", /user-agent|userAgent/i],
    ["names a forwarded address", /forwarded|cf-connecting-ip|x-real-ip/i],
    ["names a referrer", /referer|referrer/i],
    ["names the engagement cookie", /anyaparallax_browser/i],
    ["mints or digests an engagement identity", /digestBrowserToken|newBrowserToken|anonymous-browser/],
  ]) {
    check(!pattern.test(source), `app/enquiries/${name} ${label}`);
  }
}
note(`privacy: ${enquiryModules.length} enquiry modules read no request property and no engagement identity`);

// The admin read must not be reachable from a public route.
const publicRouteFiles = readdirSync(resolve(root, "app", "routes"), { recursive: true })
  .map((entry) => String(entry))
  .filter((name) => /\.tsx?$/.test(name) && !name.startsWith("admin"));
const adminReaders = publicRouteFiles.filter((name) =>
  readFileSync(resolve(root, "app", "routes", name), "utf8").includes("readEnquiries"),
);
check(
  adminReaders.length === 0,
  `a public route reads the enquiry list: ${adminReaders.join(", ")}`,
);
check(
  readFileSync(resolve(root, "app", "routes", "admin", "enquiries.tsx"), "utf8").includes(
    "readEnquiries",
  ),
  "the operator enquiry route does not read the enquiry list",
);
note(`privacy: ${publicRouteFiles.length} public route modules inspected; none reads the enquiry list`);

// --- G. Operator surfaces -------------------------------------------------

const listView = await readEnquiries(env);
check(listView.available === true, "the operator enquiry list reported itself unavailable");
check(
  listView.available && listView.enquiries.length === 1,
  `the operator list returned ${listView.available ? listView.enquiries.length : "?"} enquiries`,
);
const listedKeys = Object.keys((listView.available && listView.enquiries[0]) || {}).sort();
check(
  listedKeys.join(",") ===
    "category,createdAt,email,id,message,name,photoId,photoSlug,photoTitle,printFormat,printSize,status",
  `the operator enquiry payload exposes unexpected fields: ${listedKeys.join(", ")}`,
);
check(
  listView.available && listView.enquiries[0]?.photoTitle !== null,
  "the operator list did not resolve the photograph's title",
);
check(
  !JSON.stringify(listView).includes("token") && !JSON.stringify(listView).includes("created_at"),
  "the operator list exposes a submission token or a raw column name",
);

const unavailableList = await readEnquiries({});
check(unavailableList.available === false, "the operator list reported itself available with no database");
check(
  (await readEnquiries(undefined)).available === false,
  "the operator list reported itself available from an undefined environment",
);
check(
  !Object.prototype.hasOwnProperty.call(unavailableList, "enquiries"),
  "an unavailable operator list still carried enquiries",
);

// Handled state: the allow-list, the stored result, and the refusals.
clearEnquiries();
const toManage = await submitEnquiry(printEnquiry(), env);
const managedId = toManage.status === "recorded" ? toManage.id : "";
check(managedId.length > 0, "an enquiry to manage was not recorded");
const readResult = await updateEnquiryStatus(managedId, "read", env);
check(readResult.status === "ok", `marking an enquiry read returned ${readResult.status}`);
check(
  database.query("SELECT status FROM enquiries WHERE id = ?1", managedId)[0]?.status === "read",
  "the handled state was not stored",
);
const archived = await updateEnquiryStatus(managedId, "archived", env);
check(archived.status === "ok", `archiving an enquiry returned ${archived.status}`);
check(
  database.query("SELECT status FROM enquiries WHERE id = ?1", managedId)[0]?.status === "archived",
  "the archived state was not stored",
);
const updatedAt = database.query("SELECT updated_at, created_at FROM enquiries WHERE id = ?1", managedId)[0];
check(
  updatedAt.updated_at >= updatedAt.created_at,
  "changing the handled state moved updated_at before created_at",
);

for (const bad of ["paid", "fulfilled", "ordered", "NEW", "", "read ", "read' OR 1=1 --", null, 42]) {
  const outcome = await updateEnquiryStatus(managedId, bad, env);
  check(outcome.status === "bad-request", `the status allow-list accepted ${JSON.stringify(bad)}`);
}
check(
  database.query("SELECT status FROM enquiries WHERE id = ?1", managedId)[0]?.status === "archived",
  "a refused status change still altered the stored state",
);
check(
  (await updateEnquiryStatus("enquiry-does-not-exist", "read", env)).status === "not-found",
  "changing an unknown enquiry did not report not-found",
);
check(
  (await updateEnquiryStatus(managedId, "read", {})).status === "unavailable",
  "changing a state without a database did not fail closed",
);
check(ENQUIRY_STATUSES.length === 3, "the handled-state vocabulary changed size");
check(
  ENQUIRY_STATUSES.every((status) => isEnquiryStatus(status)),
  "the handled-state vocabulary is inconsistent with its guard",
);

const counts = await readEnquiryCounts(env);
check(counts?.get("archived") === 1, `the status counts are ${JSON.stringify([...(counts ?? [])])}`);
check(
  ![...(counts ?? [])].some(([status]) => /paid|order|fulfil|ship/i.test(status)),
  "the status counts report an order-like state",
);
check((await readEnquiryCounts({})) === null, "status counts were reported without a database");

// Print eligibility, from the operator's side.
const options = await listPhotoPrintOptions(env);
check(options.available === true, "the print-eligibility list reported itself unavailable");
const optionNames = (options.available ? options.photos : []).map((photo) => photo.slug);
check(optionNames.includes(DRAFT), "the eligibility list hides drafts, so the decision cannot be made");
check(
  optionNames.includes(ELIGIBLE) && optionNames.includes(NOT_ELIGIBLE),
  "the eligibility list is missing photographs",
);
const optionKeys = Object.keys((options.available && options.photos[0]) || {}).sort();
check(
  optionKeys.join(",") === "id,printAvailable,published,slug,title",
  `the eligibility list exposes unexpected fields: ${optionKeys.join(", ")}`,
);
check(
  (await listPhotoPrintOptions({})).available === false,
  "the eligibility list reported itself available with no database",
);
check(
  !Object.prototype.hasOwnProperty.call(await listPhotoPrintOptions({}), "photos"),
  "an unavailable eligibility list still carried photographs",
);

/** Every column of a photograph row except the two the eligibility write may touch. */
function photoRow(id) {
  return database.query("SELECT * FROM photos WHERE id = ?1", id)[0];
}

const beforeDraft = photoRow(DRAFT);
// Withdraw first, so the assertion below observes a real transition rather than a
// value that was already in place.
const draftWithdrawn = await setPhotoPrintAvailable(env, DRAFT, false);
check(draftWithdrawn.status === "ok", `withdrawing a draft returned ${draftWithdrawn.status}`);
check(photoRow(DRAFT).print_available === 0, "the print flag was not cleared");
check(photoRow(DRAFT).published === 0, "clearing the print flag published the photograph");

const draftMarked = await setPhotoPrintAvailable(env, DRAFT, true);
check(draftMarked.status === "ok", `marking a draft print-eligible returned ${draftMarked.status}`);
const afterDraft = photoRow(DRAFT);
check(afterDraft.print_available === 1, "the print flag was not stored");
// THE DECISIVE ASSERTION: eligibility is not publication.
check(afterDraft.published === 0, "marking a photograph print-eligible PUBLISHED it");
const changedColumns = Object.keys(afterDraft).filter(
  (column) => afterDraft[column] !== beforeDraft[column],
);
check(
  changedColumns.length > 0,
  "the eligibility write changed nothing, so the assertion proves nothing",
);
// `updated_at` is the audit stamp every write in this repository maintains; the
// assertion is that nothing ELSE moved, and `published` is checked outright above.
check(
  changedColumns.every((column) => column === "print_available" || column === "updated_at"),
  `the eligibility write changed columns it must not touch: ${changedColumns.join(", ")}`,
);
check(
  !(await repository.listPrintEligible()).some((photo) => photo.slug === DRAFT),
  "a draft became publicly listable after being marked print-eligible",
);
check(
  (await store.eligiblePhotoFor(DRAFT)) === null,
  "a draft became attachable to an enquiry after being marked print-eligible",
);

const publishedOff = await setPhotoPrintAvailable(env, ELIGIBLE, false);
check(publishedOff.status === "ok", `withdrawing a published photograph returned ${publishedOff.status}`);
check(photoRow(ELIGIBLE).published === 1, "withdrawing a print offer unpublished the photograph");
check(
  !(await repository.listPrintEligible()).some((photo) => photo.slug === ELIGIBLE),
  "a withdrawn photograph is still listed for print",
);
check(
  (await store.eligiblePhotoFor(ELIGIBLE)) === null,
  "a withdrawn photograph is still attachable to an enquiry",
);
const restored = await setPhotoPrintAvailable(env, ELIGIBLE, true);
check(restored.status === "ok", "re-offering a photograph returned " + restored.status);
check(
  (await repository.listPrintEligible()).some((photo) => photo.slug === ELIGIBLE),
  "re-offering a photograph did not restore it",
);
database.exec(`UPDATE photos SET print_available = 0 WHERE id = '${DRAFT}'`);

for (const [id, available, label] of [
  ["", true, "an empty photograph id"],
  ["x".repeat(129), true, "an overlong photograph id"],
  [42, true, "a non-string photograph id"],
  [DRAFT, "yes", "a non-boolean state"],
  [DRAFT, "on", "a form-shaped state rather than a boolean"],
  [DRAFT, 1, "a numeric state"],
]) {
  const outcome = await setPhotoPrintAvailable(env, id, available);
  check(outcome.status === "bad-request", `${label} was accepted by the eligibility write`);
}
check(
  (await setPhotoPrintAvailable(env, "no-such-photograph", true)).status === "not-found",
  "setting eligibility on an unknown photograph did not report not-found",
);
check(
  (await setPhotoPrintAvailable({}, ELIGIBLE, true)).status === "unavailable",
  "setting eligibility without a database did not fail closed",
);
note("print eligibility: drafts stay drafts, the write touches one column, and every refusal is explicit");

// --- H. Ecommerce non-goal ------------------------------------------------

/** Every sentence the site may show about enquiries, as values rather than labels. */
const publicCopy = [
  ...Object.values(ENQUIRY_COPY),
  ...Object.values(ENQUIRY_CATEGORY_LABELS),
  ...Object.values(PRINT_FORMAT_LABELS),
  ...Object.values(ENQUIRY_STATUS_LABELS),
];
for (const text of publicCopy) {
  const claim = forbiddenCommerceClaimIn(text);
  check(
    claim === null,
    `site copy makes a commercial claim it cannot keep (${claim?.label}): ${JSON.stringify(text)}`,
  );
}

// The detector must actually fire, or the loop above proves nothing.
for (const sample of [
  "Add to basket",
  "Proceed to checkout",
  "Buy now",
  "Pay now",
  "Place your order",
  "Your order number is 1234",
  "Order confirmed",
  "Free shipping options at checkout",
  "We will dispatch within two days",
  "Only 3 in stock",
]) {
  check(
    forbiddenCommerceClaimIn(sample) !== null,
    `the ecommerce-claim detector missed ${JSON.stringify(sample)}`,
  );
}
// The honest disclosure must NOT be mistaken for a claim. A page that says a
// capability is absent is telling the truth, and a check that rejected it would
// force the site to stop being honest.
for (const honest of [
  ENQUIRY_COPY.noCheckoutNotice,
  ENQUIRY_COPY.acknowledgementBody,
  ENQUIRY_COPY.acknowledgementBodyContact,
  "There is no basket, no checkout and no payment on this site.",
  "Nothing has been ordered and no payment has been taken.",
]) {
  check(
    forbiddenCommerceClaimIn(honest) === null,
    `truthful prose was rejected as a commercial claim: ${JSON.stringify(honest)}`,
  );
}
check(
  FORBIDDEN_COMMERCE_CLAIMS.length >= 10,
  `the commerce-claim vocabulary covers only ${FORBIDDEN_COMMERCE_CLAIMS.length} shapes`,
);

// The disclosure must actually be shown, not merely defined.
for (const [file, marker] of [
  ["app/routes/prints.tsx", "ENQUIRY_COPY.noCheckoutNotice"],
  ["app/routes/photo.tsx", "no basket, checkout or payment"],
  ["app/components/EnquiryForm.tsx", "ENQUIRY_COPY.noCheckoutNotice"],
]) {
  const source = readFileSync(resolve(root, file), "utf8");
  check(source.includes(marker), `${file} does not state the honest no-commerce boundary`);
}

// No payment affordance may exist in code: no card field, no password field, no
// payment SDK, and no link or form targeting a checkout.
const affordances = [
  ["a checkout route", /["'`]\/(?:checkout|basket|cart|order)(?:\/|["'`])/i],
  ["a pay-now control", /"pay\s*now"|"buy\s*now"|"add\s*to\s+(?:basket|cart)"/i],
  ["a card-number field", /card\s*-?\s*number|cvc|cvv|expiry/i],
  ["a password field", /type=["']password["']/i],
  ["card autofill hints", /autocomplete=["']cc-/i],
  ["a payment SDK", /stripe|paypal|braintree|klarna|worldpay|squareup|checkout\.com/i],
];
const scannedDirs = ["app/routes", "app/components", "app/enquiries"];
let scannedFiles = 0;
for (const directory of scannedDirs) {
  for (const entry of readdirSync(resolve(root, directory), { recursive: true })) {
    const name = String(entry);
    if (!/\.tsx?$/.test(name)) {
      continue;
    }
    scannedFiles += 1;
    const source = stripComments(readFileSync(resolve(root, directory, name), "utf8"));
    for (const [label, pattern] of affordances) {
      check(
        !pattern.test(source),
        `${directory}/${name} contains ${label}, which the site cannot honour`,
      );
    }
  }
}
note(`ecommerce non-goal: ${publicCopy.length} copy strings and ${scannedFiles} source files scanned`);

// --- Cleanup --------------------------------------------------------------

check(
  database.query("SELECT COUNT(*) AS total FROM enquiries WHERE id LIKE 'e-%'")[0]?.total === 0,
  "schema probes leaked rows into the fixture",
);
clearEnquiries();
database.close();

report(
  "Print/enquiry check passed: print eligibility is a stored decision that never publishes a draft, a " +
    "photograph is resolved (never trusted) before an enquiry stores it, one form render produces exactly " +
    "one enquiry under replay and concurrency, every malformed and unsupported value is refused, the stored " +
    "row carries nothing about the request, the operator surfaces are bounded and guarded, and no copy or " +
    "code offers commerce the site cannot perform.",
);
