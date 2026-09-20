#!/usr/bin/env node
/**
 * Photograph management check (REPAIR-09B).
 *
 * Driven against a REAL D1 database through the production module, the production
 * repository and the production publication gate, so what is proved is the SQL the
 * application runs rather than a double that agrees with it.
 *
 * The audited blocker had two halves, and both are covered here:
 *
 *   EDITING — metadata could be supplied at upload time and never corrected.
 *   Every editable field is changed and then read back through the PUBLIC
 *   projection, so "the edit persisted" means a visitor would see it.
 *
 *   WITHDRAWAL — a published photograph could not be taken down. The whole
 *   consequence chain is asserted: the public lookup stops resolving, the
 *   publication-gated derivative gate refuses the object, the gallery and homepage
 *   listings drop it, and print eligibility stops offering it — while the storage
 *   keys, the derivative objects and the private master are untouched, because
 *   unpublishing hides a photograph rather than destroying it.
 *
 * What this suite is also built to catch:
 *
 *   * an editor that reaches storage identity, image geometry or the slug;
 *   * a mutation that reports success without the row agreeing;
 *   * a tag edit that duplicates links, leaves obsolete ones behind, or touches
 *     another photograph's tags;
 *   * a gallery change that makes a photograph public through an unpublished
 *     gallery, or hides one by accident;
 *   * an unrecognised publication/featured string being treated as a state;
 *   * any deletion path at all — V1 withdraws by unpublishing.
 */
import { register } from "node:module";

register("../ts-extension-hooks.mjs", import.meta.url);

const { createD1TestDatabase } = await import("./d1-harness.mjs");
const { check, note, report } = await import("./report.mjs");
const { seed } = await import("../../app/data/seed.ts");
const { D1PortfolioRepository } = await import("../../app/data/repository.d1.server.ts");
const { isPublishedDerivative } = await import("../../app/images/media-publication.server.ts");
const {
  FEATURED_STATES,
  MANAGED_PHOTO_LIST_LIMIT,
  PHOTO_FIELD_LIMITS,
  PHOTO_INTENTS,
  PUBLICATION_STATES,
  REFUSED_STORAGE_FIELDS,
  isValidCaptureDate,
  parseFeaturedState,
  parsePhotoIntent,
  parsePublicationState,
  storageFieldsIn,
  targetStateFor,
  validatePhotoMetadata,
} = await import("../../app/data/photo-management.ts");
const { listManagedPhotos, managedPhotoEditorFor, photoManagerFor } = await import(
  "../../app/data/photo-management.server.ts"
);
const { readFileSync } = await import("node:fs");
const { dirname, resolve } = await import("node:path");
const { fileURLToPath } = await import("node:url");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// --- Fixture database -----------------------------------------------------

const database = await createD1TestDatabase({ seed, label: "photo-management" });
const env = { DB: database.binding };
const repository = new D1PortfolioRepository(database.binding);
const manager = photoManagerFor(env);
if (!manager) {
  console.error("No manager could be constructed from a D1 binding; the suite cannot run.");
  process.exit(1);
}

/** A published photograph in a published gallery. */
const PUBLISHED = "closing-time";
/** A draft photograph in a published gallery. */
const DRAFT = "unreleased-edit";
/** A draft photograph in an UNPUBLISHED gallery. */
const DRAFT_HIDDEN_GALLERY = "studio-trial";
/** The unpublished gallery. */
const UNPUBLISHED_GALLERY = "gallery-studio";

const NOW = "2026-09-21T09:00:00.000Z";

/**
 * A photograph whose derivatives are real `r2://images/...` keys.
 *
 * The seed set stores `/images/dev/*.svg` paths, which the storage gate rightly
 * treats as plain site paths — so it cannot exercise the publication-gated
 * `/media/...` boundary. This row can, and it is what makes the withdrawal evidence
 * meaningful rather than decorative.
 */
const DERIVATIVE_PHOTO = "p-managed-delivery";
database.exec(
  `INSERT INTO photos (id, title, slug, description, gallery_id, width, height,
     original_storage_key, web_storage_key, thumbnail_storage_key, watermark_enabled,
     watermark_position, featured, published, print_available, created_at, updated_at, published_at)
   VALUES ('${DERIVATIVE_PHOTO}', 'Managed delivery', 'managed-delivery', 'A fixture photograph.',
     'gallery-nightlife', 100, 100, 'r2://masters/originals/${DERIVATIVE_PHOTO}/master.jpg',
     'r2://images/web/${DERIVATIVE_PHOTO}/web.webp', 'r2://images/thumbs/${DERIVATIVE_PHOTO}/thumb.webp',
     0, 'bottom-right', 0, 1, 1, '${NOW}', '${NOW}', '${NOW}')`,
);
const DERIVATIVE_WEB_KEY = `r2://images/web/${DERIVATIVE_PHOTO}/web.webp`;

/** Every photograph's storage identity, for the global invariant at the end. */
function storageIdentities() {
  return new Map(
    database
      .query(
        "SELECT id, original_storage_key, web_storage_key, thumbnail_storage_key, slug FROM photos ORDER BY id",
      )
      .map((row) => [
        row.id,
        `${row.original_storage_key}|${row.web_storage_key}|${row.thumbnail_storage_key}|${row.slug}`,
      ]),
  );
}

function photoRow(id) {
  return database.query("SELECT * FROM photos WHERE id = ?1", id)[0];
}

function tagIdsFor(id) {
  return database
    .query("SELECT tag_id FROM photo_tags WHERE photo_id = ?1 ORDER BY tag_id", id)
    .map((row) => row.tag_id);
}

const identitiesBefore = storageIdentities();
const photoCountBefore = database.query("SELECT COUNT(*) AS total FROM photos")[0]?.total;
/**
 * Another photograph's tag links, captured before any edit.
 *
 * Every tag mutation below belongs to a different photograph, so if any of them
 * changes this set, the tag replacement was not scoped by `photo_id` — which is the
 * failure that would quietly strip tags from unrelated photographs.
 */
const otherPhotoId = "stage-haze";
const otherPhotoTagsBefore = tagIdsFor(otherPhotoId);

// --- A. The library list --------------------------------------------------

const list = await listManagedPhotos(env);
check(list.available === true, "the management list reported itself unavailable with a database present");
const photos = list.available ? list.photos : [];
check(photos.length === seed.photos.length + 1, `the list showed ${photos.length} photographs, expected ${seed.photos.length + 1}`);
check(
  photos.some((photo) => photo.slug === PUBLISHED) && photos.some((photo) => photo.slug === DRAFT),
  "the list does not show both published photographs and drafts",
);
check(
  photos.some((photo) => photo.slug === DRAFT_HIDDEN_GALLERY),
  "the list hides drafts, so publication state cannot be managed from it",
);
check(
  photos[0]?.published === false,
  "drafts are not listed first, so an unpublished photograph is easy to miss",
);
check(
  photos.length <= MANAGED_PHOTO_LIST_LIMIT,
  "the list exceeded its own bound",
);

const bySlug = new Map(photos.map((photo) => [photo.slug, photo]));
const publishedSummary = bySlug.get(PUBLISHED);
const draftSummary = bySlug.get(DRAFT);
check(publishedSummary?.publiclyVisible === true, "a published photograph in a published gallery is not reported public");
check(draftSummary?.publiclyVisible === false, "a draft is reported publicly visible");
check(
  bySlug.get(DRAFT_HIDDEN_GALLERY)?.publiclyVisible === false,
  "a photograph in an unpublished gallery is reported publicly visible",
);
check(
  bySlug.get("stage-haze")?.printAvailable === true,
  "the list does not carry the existing print-availability flag for context",
);
const summaryKeys = Object.keys(publishedSummary ?? {}).sort().join(",");
check(
  summaryKeys ===
    "featured,galleryId,galleryName,galleryPublished,id,printAvailable,publiclyVisible,published,slug,title,updatedAt",
  `the summary exposes unexpected fields: ${summaryKeys}`,
);
check(
  !JSON.stringify(photos).includes("r2://") && !JSON.stringify(photos).includes("storage_key"),
  "the management list carries a storage reference",
);
note(`library: ${photos.length} photographs, drafts first, ${photos.filter((photo) => !photo.publiclyVisible).length} not publicly visible`);

check((await listManagedPhotos({})).available === false, "the list reported itself available with no database");
check(photoManagerFor({}) === null, "a manager was constructed without a database binding");
check(photoManagerFor(undefined) === null, "a manager was constructed from an undefined environment");

// --- B. The editor view ---------------------------------------------------

const editor = await managedPhotoEditorFor(env, PUBLISHED);
check(editor.status === "ok", `the editor did not resolve a known photograph: ${editor.status}`);
const edited = editor.status === "ok" ? editor.photo : null;
check(edited?.title === "Closing time", `the editor returned the title ${JSON.stringify(edited?.title)}`);
check(
  edited?.description === photoRow(PUBLISHED).description,
  "the editor's description does not match the stored row",
);
check(
  JSON.stringify(edited?.tags) === JSON.stringify(tagIdsFor(PUBLISHED)),
  "the editor's tag set does not match the stored links",
);
check(
  (editor.status === "ok" ? editor.galleries : []).some((gallery) => gallery.published === false),
  "the editor does not offer unpublished galleries, so a draft cannot be filed into one",
);
check(
  (editor.status === "ok" ? editor.galleries : []).some((gallery) => gallery.published === true),
  "the editor does not offer published galleries",
);
for (const missing of ["no-such-photo", "", "x".repeat(129)]) {
  check(
    (await managedPhotoEditorFor(env, missing)).status === "not-found",
    `the editor resolved ${JSON.stringify(missing)}`,
  );
}
check(
  (await managedPhotoEditorFor({}, PUBLISHED)).status === "unavailable",
  "the editor resolved a photograph with no database",
);

// --- C. Metadata edits persist through the public projection --------------

const galleryOptions = editor.status === "ok" ? editor.galleries.map((gallery) => gallery.id) : [];
const tagOptions = seed.tags.map((tag) => tag.id);
const options = { galleryIds: galleryOptions, tagIds: tagOptions };

async function edit(photoId, overrides) {
  const row = photoRow(photoId);
  const current = {
    title: row.title,
    description: row.description,
    location: row.location,
    captureDate: row.capture_date,
    galleryId: row.gallery_id,
    tags: tagIdsFor(photoId),
    published: row.published === 1,
    featured: row.featured === 1,
    ...overrides,
  };
  return { result: await manager.updatePhoto(photoId, current, options), input: current };
}

const titleEdit = await edit(PUBLISHED, { title: "Closing time, re-edited" });
check(titleEdit.result.status === "ok", `a title edit failed: ${titleEdit.result.status}`);
check(
  photoRow(PUBLISHED).title === "Closing time, re-edited",
  "the title edit did not persist",
);
check(
  photoRow(PUBLISHED).slug === PUBLISHED,
  "editing the title regenerated the slug, which would break external links",
);
check(
  titleEdit.result.status === "ok" && titleEdit.result.persisted.title === "Closing time, re-edited",
  "the reported state is not the state read back from the database",
);

const descriptionEdit = await edit(PUBLISHED, { description: "A corrected description." });
check(descriptionEdit.result.status === "ok", "a description edit failed");
check(photoRow(PUBLISHED).description === "A corrected description.", "the description edit did not persist");

const locationEdit = await edit(PUBLISHED, { location: "Birkenhead" });
check(locationEdit.result.status === "ok", "a location edit failed");
check(photoRow(PUBLISHED).location === "Birkenhead", "the location edit did not persist");
const clearedLocation = await edit(PUBLISHED, { location: "   " });
check(
  clearedLocation.result.status === "ok" && photoRow(PUBLISHED).location === null,
  "clearing the location did not store NULL",
);

const dateEdit = await edit(PUBLISHED, { captureDate: "2025-03-04" });
check(dateEdit.result.status === "ok", "a capture-date edit failed");
check(photoRow(PUBLISHED).capture_date === "2025-03-04", "the capture-date edit did not persist");
const clearedDate = await edit(PUBLISHED, { captureDate: "" });
check(
  clearedDate.result.status === "ok" && photoRow(PUBLISHED).capture_date === null,
  "clearing the capture date did not store NULL",
);

const galleryEdit = await edit(PUBLISHED, { galleryId: "gallery-cars" });
check(galleryEdit.result.status === "ok", "a gallery change failed");
check(photoRow(PUBLISHED).gallery_id === "gallery-cars", "the gallery change did not persist");
// The REPORTED state must be the state the database holds. A module that answered
// "ok" from the submitted values would pass the row assertion above only by luck; this
// is the assertion that fails when a write is silently dropped but reported as saved.
check(
  galleryEdit.result.status === "ok" && galleryEdit.result.persisted.galleryId === "gallery-cars",
  "the reported state is not the state the database holds after a gallery change",
);
const backToOriginalGallery = await edit(PUBLISHED, { galleryId: "gallery-nightlife" });
check(backToOriginalGallery.result.status === "ok", "moving the photograph back failed");

const tagEdit = await edit(PUBLISHED, { tags: ["tag-night", "tag-red"] });
check(tagEdit.result.status === "ok", "a tag edit failed");
check(
  JSON.stringify(tagIdsFor(PUBLISHED)) === JSON.stringify(["tag-night", "tag-red"]),
  `the tag edit stored ${JSON.stringify(tagIdsFor(PUBLISHED))}`,
);
check(
  database.query("SELECT COUNT(*) AS total FROM photo_tags WHERE photo_id = ?1 AND tag_id = 'tag-club'", PUBLISHED)[0]
    ?.total === 0,
  "a removed tag left its link behind",
);
const noTags = await edit(PUBLISHED, { tags: [] });
check(noTags.result.status === "ok" && tagIdsFor(PUBLISHED).length === 0, "clearing every tag failed");
const duplicates = await edit(PUBLISHED, { tags: ["tag-night", "tag-night", "tag-rain"] });
check(
  duplicates.result.status === "ok" && tagIdsFor(PUBLISHED).length === 2,
  `a duplicated tag produced ${JSON.stringify(tagIdsFor(PUBLISHED))}`,
);
check(
  database.query("SELECT COUNT(*) AS total FROM photo_tags WHERE photo_id != ?1 AND tag_id IN ('tag-night','tag-rain')", PUBLISHED)[0]
    ?.total > 0,
  "the tag edit removed links belonging to other photographs",
);

// The change must be visible to a VISITOR, through the public projection.
const publicPhoto = await repository.getPhoto(PUBLISHED);
check(publicPhoto !== null, "the edited photograph no longer resolves publicly");
check(
  publicPhoto?.title === "Closing time, re-edited" &&
    publicPhoto.description === "A corrected description." &&
    publicPhoto.location === null &&
    publicPhoto.captureDate === null &&
    publicPhoto.galleryId === "gallery-nightlife",
  `the public projection does not show the edits: ${JSON.stringify(publicPhoto)}`,
);
check(
  JSON.stringify(await repository.resolveTags(publicPhoto?.tags ?? [])) ===
    JSON.stringify([
      { name: "Night", slug: "night" },
      { name: "Rain", slug: "rain" },
    ]),
  "the public tag projection does not show the edited tags",
);
check(
  typeof publicPhoto?.webImagePath === "string" && typeof publicPhoto?.thumbnailImagePath === "string",
  "the edited photograph lost its browser-facing image paths",
);
note("edits: title, description, location, capture date, gallery and tags all persisted and are visible publicly");

// --- D. Validation and adversarial input ---------------------------------

const cases = [
  ["an unknown gallery", PUBLISHED, { galleryId: "gallery-nope" }, "invalid"],
  ["an empty gallery", PUBLISHED, { galleryId: "" }, "invalid"],
  ["an unknown tag", PUBLISHED, { tags: ["no-such-tag"] }, "invalid"],
  ["an empty title", PUBLISHED, { title: "   " }, "invalid"],
  ["an overlong title", PUBLISHED, { title: "x".repeat(PHOTO_FIELD_LIMITS.title + 1) }, "invalid"],
  ["an overlong description", PUBLISHED, { description: "x".repeat(PHOTO_FIELD_LIMITS.description + 1) }, "invalid"],
  ["an overlong location", PUBLISHED, { location: "x".repeat(PHOTO_FIELD_LIMITS.location + 1) }, "invalid"],
  ["a malformed capture date", PUBLISHED, { captureDate: "2026-02-30" }, "invalid"],
  ["an impossible month", PUBLISHED, { captureDate: "2026-13-01" }, "invalid"],
  ["a non-ISO date", PUBLISHED, { captureDate: "31/12/2026" }, "invalid"],
];
for (const [label, photoId, overrides, expected] of cases) {
  const before = photoRow(photoId);
  const attempted = await edit(photoId, overrides);
  check(
    attempted.result.status === expected,
    `${label} returned ${attempted.result.status}, expected ${expected}`,
  );
  const after = photoRow(before.id);
  check(
    JSON.stringify(before) === JSON.stringify(after),
    `${label} changed the stored row`,
  );
}

// An unknown photograph cannot be edited at all. Checked separately because there is
// no row to build an edit from and none to compare against.
const unknownEdit = await manager.updatePhoto(
  "no-such-photograph",
  {
    title: "Anything",
    description: "",
    location: "",
    captureDate: "",
    galleryId: "gallery-nightlife",
    tags: [],
    published: true,
    featured: false,
  },
  options,
);
check(
  unknownEdit.status === "not-found",
  `an unknown photograph returned ${unknownEdit.status}, expected not-found`,
);
for (const unknown of ["", "x".repeat(129), 42, null]) {
  const outcome = await manager.updatePhoto(
    unknown,
    {
      title: "x",
      description: "",
      location: "",
      captureDate: "",
      galleryId: "gallery-nightlife",
      tags: [],
      published: true,
      featured: false,
    },
    options,
  );
  check(
    outcome.status === "bad-request" || outcome.status === "not-found",
    `an unusable photograph id (${JSON.stringify(unknown)}) returned ${outcome.status}`,
  );
}

for (const [value, expected] of [
  ["2026-09-21", true],
  ["2024-02-29", true],
  ["2026-02-29", false],
  ["2026-04-31", false],
  ["2026-00-10", false],
  ["2026-12-00", false],
  ["0050-01-01", false],
  ["2026-9-1", false],
  ["2026-09-21T00:00:00Z", false],
  ["", false],
  ["not-a-date", false],
]) {
  check(
    isValidCaptureDate(value) === expected,
    `isValidCaptureDate(${JSON.stringify(value)}) should be ${expected}`,
  );
}

/**
 * The state contracts are STRING ALLOW-LISTS, not booleans.
 *
 * The list page's intents and the editor's two-option selects submit words, so the
 * only accepted values are the words this application defines. Everything else —
 * including "true"/"false", which a different design might have used — is `null`,
 * which every caller turns into a refusal rather than a guess.
 */
const validationOptions = { galleryIds: ["gallery-nightlife"], tagIds: ["tag-night"] };
check(parsePublicationState("published") === true, "the publication contract rejected 'published'");
check(parsePublicationState("draft") === false, "the publication contract rejected 'draft'");
check(parseFeaturedState("featured") === true, "the featured contract rejected 'featured'");
check(parseFeaturedState("not-featured") === false, "the featured contract rejected 'not-featured'");
for (const unrecognised of [
  "true",
  "false",
  "yes",
  "on",
  "1",
  "0",
  "TRUE",
  "True",
  " true",
  "published ",
  "draft,",
  "",
  null,
  undefined,
  0,
  42,
  true,
  false,
]) {
  check(
    parsePublicationState(unrecognised) === null,
    `the publication contract accepted ${JSON.stringify(unrecognised)}`,
  );
  check(
    parseFeaturedState(unrecognised) === null,
    `the featured contract accepted ${JSON.stringify(unrecognised)}`,
  );
}
check(
  validatePhotoMetadata({ title: "T", description: "", location: "", captureDate: "", galleryId: "gallery-nightlife", tags: [] }, validationOptions).ok === true,
  "a minimal valid edit was refused",
);
check(
  validatePhotoMetadata({ title: "T", description: "", location: "", captureDate: "2026-02-30", galleryId: "gallery-nightlife", tags: [] }, validationOptions).ok === false,
  "an impossible date passed validation",
);

// The publication and featured contracts are allow-lists, never guesses.
for (const bad of ["yes", "on", "1", "TRUE", "True", " true", "published ", "draft,", null, 42, ""]) {
  check(parsePublicationState(bad) === null, `the publication contract accepted ${JSON.stringify(bad)}`);
  check(parseFeaturedState(bad) === null, `the featured contract accepted ${JSON.stringify(bad)}`);
}
for (const intent of PHOTO_INTENTS) {
  const target = targetStateFor(intent);
  check(
    (intent === "publish" || intent === "unpublish") === (target.field === "published"),
    `the intent ${intent} maps to the wrong field`,
  );
  check(
    target.value === (intent === "publish" || intent === "feature"),
    `the intent ${intent} maps to the wrong value`,
  );
}
for (const bad of ["delete", "unpublish ", "PUBLISH", "remove", null, 42]) {
  check(parsePhotoIntent(bad) === null, `the intent allow-list accepted ${JSON.stringify(bad)}`);
}
check(PUBLICATION_STATES.length === 2 && FEATURED_STATES.length === 2, "a state vocabulary changed size");

// Storage identity is outside the contract, and a submission naming it is refused.
const forgedForm = new FormData();
forgedForm.set("title", "Forged");
forgedForm.set("original_storage_key", "r2://masters/originals/evil/master.tif");
forgedForm.set("web_storage_key", "r2://images/web/evil/web.webp");
forgedForm.set("width", "1");
const refusedFields = storageFieldsIn(forgedForm);
check(
  refusedFields.includes("original_storage_key") &&
    refusedFields.includes("web_storage_key") &&
    refusedFields.includes("width"),
  `the storage-field refusal missed: ${JSON.stringify(refusedFields)}`,
);
check(
  REFUSED_STORAGE_FIELDS.length >= 8,
  `only ${REFUSED_STORAGE_FIELDS.length} storage-identity field names are refused`,
);
const honestForm = new FormData();
for (const field of ["title", "description", "location", "captureDate", "galleryId", "tags"]) {
  honestForm.set(field, "x");
}
check(storageFieldsIn(honestForm).length === 0, "the storage-field refusal rejects the editor's own form");
check(
  storageFieldsIn(new FormData()).length === 0,
  "the storage-field refusal fires on an empty form",
);
// Even if such values reach the module as extra keys, they are not read.
const keysBefore = [photoRow(PUBLISHED).original_storage_key, photoRow(PUBLISHED).web_storage_key, photoRow(PUBLISHED).thumbnail_storage_key];
const forgedEdit = await manager.updatePhoto(
  PUBLISHED,
  {
    title: "Forged but harmless",
    description: "x",
    location: null,
    captureDate: null,
    galleryId: "gallery-nightlife",
    tags: [],
    published: true,
    featured: false,
    original_storage_key: "r2://masters/originals/evil/master.tif",
    webStorageKey: "r2://images/web/evil/web.webp",
    width: 1,
    height: 1,
  },
  options,
);
check(forgedEdit.status === "ok", `a submission with extra keys was refused outright: ${forgedEdit.status}`);
const keysAfter = [photoRow(PUBLISHED).original_storage_key, photoRow(PUBLISHED).web_storage_key, photoRow(PUBLISHED).thumbnail_storage_key];
check(
  JSON.stringify(keysBefore) === JSON.stringify(keysAfter),
  "storage identity was altered by a submission that named it",
);
check(
  !JSON.stringify(keysAfter).includes("evil"),
  "a client-supplied storage key reached the database",
);
note("validation: unknown records, galleries, tags, impossible dates, overlong text and forged states are all refused");

// --- E. Featured state ----------------------------------------------------

const featuredBefore = (await repository.listFeatured()).map((photo) => photo.slug);
check(!featuredBefore.includes(PUBLISHED), "the fixture photograph started featured, so the test is not meaningful");
const featureOn = await manager.setFeatured(PUBLISHED, true);
check(featureOn.status === "ok", `featuring failed: ${featureOn.status}`);
check(photoRow(PUBLISHED).featured === 1, "featuring did not persist");
check(
  (await repository.listFeatured()).map((photo) => photo.slug).includes(PUBLISHED),
  "a featured photograph does not participate in the homepage selection",
);
const featureOff = await manager.setFeatured(PUBLISHED, false);
check(featureOff.status === "ok", "unfeaturing failed");
check(photoRow(PUBLISHED).featured === 0, "unfeaturing did not persist");
check(
  !(await repository.listFeatured()).map((photo) => photo.slug).includes(PUBLISHED),
  "an unfeatured photograph is still in the homepage selection",
);
check(
  (await manager.setFeatured(PUBLISHED, "yes")).status === "bad-request",
  "a non-boolean featured state was accepted",
);
check(
  (await manager.setFeatured("no-such-photograph", true)).status === "not-found",
  "featuring an unknown photograph did not report not-found",
);
note("featured: both directions persist and the homepage selection follows them");

// --- F. Publication and withdrawal ----------------------------------------

// A draft in a published gallery: invisible, then published, then withdrawn.
check((await repository.getPhoto(DRAFT)) === null, "a draft resolved publicly before the test began");
const publish = await manager.setPublication(DRAFT, true);
check(publish.status === "ok", `publishing failed: ${publish.status}`);
check(photoRow(DRAFT).published === 1, "publishing did not persist");
check(
  typeof photoRow(DRAFT).published_at === "string" && photoRow(DRAFT).published_at.length > 0,
  "a published photograph carries no publication timestamp",
);
check((await repository.getPhoto(DRAFT)) !== null, "a published photograph does not resolve publicly");
check(
  (await repository.listRecent(50)).some((photo) => photo.slug === DRAFT),
  "a published photograph is missing from the recent listing",
);

const publishedAtStamp = photoRow(DRAFT).published_at;
const republish = await manager.setPublication(DRAFT, true);
check(republish.status === "ok", "an idempotent publish failed");
check(
  photoRow(DRAFT).published_at === publishedAtStamp,
  "an idempotent publish restamped the publication time, which would reorder the site",
);

const withdraw = await manager.setPublication(DRAFT, false);
check(withdraw.status === "ok", `unpublishing failed: ${withdraw.status}`);
check(photoRow(DRAFT).published === 0, "unpublishing did not persist");
// The withdrawal must be reported only from the row that now holds it.
check(
  withdraw.status === "ok" && withdraw.persisted.published === false,
  "the withdrawal was reported from something other than the stored publication state",
);
check(
  withdraw.status === "ok" && withdraw.persisted.publiclyVisible === false,
  "a withdrawn photograph was still reported publicly visible",
);
check(photoRow(DRAFT).published_at === null, "an unpublished photograph kept its publication timestamp");
check((await repository.getPhoto(DRAFT)) === null, "a withdrawn photograph still resolves publicly");
check(
  !(await repository.listPhotos()).some((photo) => photo.slug === DRAFT),
  "a withdrawn photograph is still in the public photograph list",
);
check(
  !(await repository.listRecent(50)).some((photo) => photo.slug === DRAFT),
  "a withdrawn photograph is still in the recent listing",
);
const galleryAfterWithdrawal = await repository.getGallery("nightlife");
check(
  galleryAfterWithdrawal !== null &&
    !galleryAfterWithdrawal.photos.some((photo) => photo.slug === DRAFT),
  "a withdrawn photograph is still listed in its public gallery",
);
// ...and comes back.
const republishAfterWithdrawal = await manager.setPublication(DRAFT, true);
check(republishAfterWithdrawal.status === "ok", "re-publishing a withdrawn photograph failed");
check((await repository.getPhoto(DRAFT)) !== null, "a re-published photograph does not resolve publicly");
check(
  (await repository.listPhotos()).some((photo) => photo.slug === DRAFT),
  "a re-published photograph is not back in the public photograph list",
);
await manager.setPublication(DRAFT, false);
note("publication: draft → published → withdrawn → re-published, with the public listings following each step");

// The publication-gated derivative boundary.
check(
  (await isPublishedDerivative(database.binding, DERIVATIVE_WEB_KEY)) === true,
  "a published photograph's derivative was not servable before the test",
);
const withdrawDerivative = await manager.setPublication(DERIVATIVE_PHOTO, false);
check(withdrawDerivative.status === "ok", "withdrawing the derivative fixture failed");
check(
  (await isPublishedDerivative(database.binding, DERIVATIVE_WEB_KEY)) === false,
  "THE REGRESSION: a withdrawn photograph's derivative is still served through /media",
);
check(
  (await isPublishedDerivative(database.binding, `r2://masters/originals/${DERIVATIVE_PHOTO}/master.jpg`)) === false,
  "the private master is servable through the public gate",
);
const restoreDerivative = await manager.setPublication(DERIVATIVE_PHOTO, true);
check(restoreDerivative.status === "ok", "re-publishing the derivative fixture failed");
check(
  (await isPublishedDerivative(database.binding, DERIVATIVE_WEB_KEY)) === true,
  "re-publishing did not restore the derivative",
);

// Print eligibility must follow publication even when the print flag is set.
database.exec(`UPDATE photos SET print_available = 1 WHERE id = '${DERIVATIVE_PHOTO}'`);
check(
  (await repository.listPrintEligible()).some((photo) => photo.slug === "managed-delivery"),
  "an eligible published photograph is missing from the print list",
);
await manager.setPublication(DERIVATIVE_PHOTO, false);
check(
  !(await repository.listPrintEligible()).some((photo) => photo.slug === "managed-delivery"),
  "a withdrawn photograph is STILL offered for print enquiries despite print_available = 1",
);
check(
  photoRow(DERIVATIVE_PHOTO).print_available === 1,
  "the print flag was cleared rather than the photograph being withdrawn",
);
await manager.setPublication(DERIVATIVE_PHOTO, true);
check(
  (await repository.listPrintEligible()).some((photo) => photo.slug === "managed-delivery"),
  "re-publishing did not restore print eligibility",
);

// --- G. The gallery-publication rule --------------------------------------

check(
  (await repository.getPhoto("studio-trial")) === null,
  "the unpublished-gallery fixture resolved publicly before the test",
);
const intoDraftGallery = await edit(DERIVATIVE_PHOTO, { galleryId: UNPUBLISHED_GALLERY });
check(intoDraftGallery.result.status === "ok", "moving a photograph into a draft gallery failed");
check(
  photoRow(DERIVATIVE_PHOTO).published === 1,
  "moving a photograph between galleries changed its publication state",
);
check(
  (await repository.getPhoto("managed-delivery")) === null,
  "a published photograph in an UNPUBLISHED gallery resolved publicly",
);
check(
  (await isPublishedDerivative(database.binding, DERIVATIVE_WEB_KEY)) === false,
  "a published photograph in an unpublished gallery served its derivative",
);
const backToPublishedGallery = await edit(DERIVATIVE_PHOTO, { galleryId: "gallery-nightlife" });
check(backToPublishedGallery.result.status === "ok", "moving the photograph back failed");
check(
  (await repository.getPhoto("managed-delivery")) !== null,
  "the photograph did not become public again after returning to a published gallery",
);
note("galleries: the published-gallery rule still decides visibility, independently of the photograph's own flag");

// --- H. Storage identity, no deletion, and the SQL contract ---------------

const identitiesAfter = storageIdentities();
for (const [id, value] of identitiesBefore) {
  check(
    identitiesAfter.get(id) === value,
    `photograph ${id} had its storage identity or slug changed by an edit`,
  );
}
check(
  storageIdentities().size === identitiesBefore.size,
  "the number of photographs changed during the run",
);
check(
  database.query("SELECT COUNT(*) AS total FROM photos")[0]?.total === photoCountBefore,
  "a photograph was deleted during the run",
);
check(
  JSON.stringify(tagIdsFor(otherPhotoId)) === JSON.stringify(otherPhotoTagsBefore),
  `another photograph's tags were changed by edits to a different photograph: ${JSON.stringify(tagIdsFor(otherPhotoId))}`,
);

/** Source with comments removed, so the scan tests code rather than prose. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}
const moduleSource = stripComments(
  readFileSync(resolve(root, "app/data/photo-management.server.ts"), "utf8"),
);
for (const [label, pattern] of [
  ["deletes photographs", /DELETE\s+FROM\s+photos/i],
  ["deletes storage objects", /\.delete\s*\(|deleteMaster|deleteDerivative/],
]) {
  check(!pattern.test(moduleSource), `the management module ${label}`);
}

/**
 * Every `UPDATE photos` statement, examined as a whole.
 *
 * A blanket search for `slug = ?` would match the READ in `photoRowBySlug`
 * (`WHERE p.slug = ?1`), so the assertion is scoped to what each statement ASSIGNS:
 * everything between `SET` and its `WHERE`. That is the precise property — an edit
 * must never write the slug, a storage key or the image geometry — and it holds for
 * future statements too.
 */
const updateStatements = moduleSource.match(/UPDATE photos[\s\S]*?WHERE id = \?\d+/gi) ?? [];
check(
  updateStatements.length >= 3,
  `only ${updateStatements.length} photograph update statements were found, expected at least 3`,
);
for (const statement of updateStatements) {
  const assignment = statement.replace(/\s+/g, " ");
  for (const [label, pattern] of [
    ["the slug", /\bslug\s*=/i],
    ["a storage key", /_storage_key\s*=/i],
    ["the image geometry", /\b(width|height)\s*=/i],
    ["the photograph id", /\bid\s*=\s*\?/i],
  ]) {
    // `WHERE id = ?N` is the scope, not an assignment, so the id check looks only at
    // the assignment half of the statement.
    const scopeAt = assignment.search(/WHERE id = \?\d+/i);
    const assignments = assignment.slice(0, scopeAt);
    check(
      !pattern.test(assignments),
      `a photograph update assigns ${label}: ${assignment.slice(0, 160)}`,
    );
  }
}
note(`invariants: ${updateStatements.length} update statements assign neither slug, storage keys nor geometry`);

check(
  /DELETE FROM photo_tags WHERE photo_id = \?1/.test(moduleSource),
  "the tag replacement is not scoped to one photograph",
);
// The tag links are written through a batch, which is what makes them atomic.
check(
  /this\.#db\.batch\(statements\)/.test(moduleSource),
  "the tag edit is not committed as one atomic batch",
);
// The database itself refuses an unknown tag, so validation has a backstop.
const [orphanTag] = database.probe([
  `INSERT INTO photo_tags (photo_id, tag_id) VALUES ('${PUBLISHED}', 'no-such-tag')`,
]);
check(
  /FOREIGN KEY constraint failed/i.test(orphanTag ?? ""),
  "the schema accepted a tag link that refers to no tag",
);
note("invariants: storage identity, slug, geometry and row count unchanged; no deletion path exists");

database.close();

report(
  "Photograph management check passed: the library lists drafts first and derives public visibility from both flags; " +
    "title, description, location, capture date, gallery and tags all persist and appear through the public " +
    "projection; featuring and unfeaturing move a photograph in and out of the homepage selection; publishing and " +
    "WITHDRAWING flip the single authority every public read consults, so the public page, the publication-gated " +
    "derivative, the gallery and recent listings and print eligibility all follow on the next read while storage " +
    "identity, the slug, the geometry and every stored object are untouched; and unknown records, galleries, tags, " +
    "dates, states and forged storage fields are all refused.",
);
