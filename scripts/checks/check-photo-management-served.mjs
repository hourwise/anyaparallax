#!/usr/bin/env node
/**
 * Served photograph management check (REPAIR-09B).
 *
 * The management module is unit-checked against real D1 elsewhere. This suite proves
 * the same behaviour reaches the WIRE through the routes an operator and a visitor
 * actually use, because the audited blocker was operational rather than structural:
 * a published photograph could not be withdrawn, and a visitor-facing withdrawal has
 * to be observable as `/photo/...` and `/media/...` stopping.
 *
 * It drives the real admin routes over HTTP with the real identity boundary, then
 * reads back the local D1 database to confirm what was stored, and finally fetches
 * the PUBLIC routes to confirm what a visitor sees. The withdrawal chain is asserted
 * in both directions, including the exact `/media/...` URL that worked a moment
 * earlier.
 *
 * Local only: Wrangler's local D1/R2, loopback HTTP, no external service.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { withWorkerVariables } from "./dev-vars.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 4188;
const origin = `http://[::1]:${port}`;

// The seed set is imported to load the same fixture the local database gets, so
// Node needs the project's extensionless-import resolver.
register("../ts-extension-hooks.mjs", import.meta.url);
const { seed } = await import("../../app/data/seed.ts");
const { migrateLocalD1, queryLocalD1, seedLocalD1 } = await import("./local-d1.mjs");

await migrateLocalD1();
await seedLocalD1(seed);

const IDENTITY_HEADER = "x-anyaparallax-development-identity";
const PHOTOGRAPHER = "photographer@anyaparallax.test";
const MANAGER = "manager@anyaparallax.test";
const INACTIVE = "deactivated@anyaparallax.test";
const UNKNOWN = "stranger@anyaparallax.test";

/** Role material a client might try to inject; none of it may change a decision. */
const FORGED_ROLE_HEADERS = {
  "x-anyaparallax-role": "manager",
  "cf-anyaparallax-role": "manager",
  role: "manager",
  "cf-access-authenticated-user-email": MANAGER,
};

const failures = [];
function check(condition, message) {
  if (condition) {
    console.log(`ok   | ${message}`);
  } else {
    failures.push(message);
    console.log(`FAIL | ${message}`);
  }
}

// The served chrome state is forced off so this check is deterministic whatever a
// developer has in their own `.dev.vars`; it is restored in the `finally`.
const restoreWorkerVariables = withWorkerVariables({ SHOW_DEVELOPMENT_NOTICES: "false" });

const server = spawn(
  "node",
  [resolve(root, "node_modules", "vite", "bin", "vite.js"), "dev", "--port", String(port)],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += chunk.toString()));
server.stderr.on("data", (chunk) => (serverOutput += chunk.toString()));

function shutdown() {
  return new Promise((resolveShutdown) => {
    if (server.exitCode !== null || server.signalCode !== null) {
      server.stdout.removeAllListeners();
      server.stderr.removeAllListeners();
      resolveShutdown();
      return;
    }
    const done = () => {
      server.stdout.removeAllListeners();
      server.stderr.removeAllListeners();
      resolveShutdown();
    };
    server.once("close", done);
    server.once("error", done);
    server.kill();
    setTimeout(done, 5000);
  });
}

async function waitForServer(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/`, { redirect: "manual" });
      if (response.status < 500) {
        return true;
      }
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 300));
  }
  return false;
}

/** A GET carrying an operator identity, as the local sign-in header provides one. */
function getAs(path, identity, extraHeaders = {}) {
  return fetch(`${origin}${path}`, {
    redirect: "manual",
    headers: {
      ...(identity === null ? {} : { [IDENTITY_HEADER]: identity }),
      ...extraHeaders,
    },
  });
}

/**
 * A form POST, as a browser sends it: form encoding and a same-origin `Origin`.
 *
 * An array value becomes ONE FIELD PER ENTRY, which is how a multi-select submits —
 * a comma-joined value would arrive as a single unusable tag id.
 */
function postAs(path, fields, identity, extraHeaders = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        body.append(key, String(item));
      }
    } else {
      body.append(key, String(value));
    }
  }
  return fetch(`${origin}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin,
      ...(identity === null ? {} : { [IDENTITY_HEADER]: identity }),
      ...extraHeaders,
    },
    body: body.toString(),
  });
}

function photoRow(id) {
  return queryLocalD1(`SELECT * FROM photos WHERE id = ${quote(id)}`).then((rows) => rows[0] ?? null);
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** The browser-facing URL for a stored derivative key. */
function mediaUrlFor(storageKey) {
  return `/${String(storageKey).replace("r2://images/", "media/")}`;
}

/** Anything that would mean a private or internal reference reached public markup. */
const PRIVATE_MARKERS = [
  ["the private masters scheme", "r2://masters/"],
  ["any r2 scheme", "r2://"],
  ["the private master column", "original_storage_key"],
  ["the web derivative column", "web_storage_key"],
  ["the thumbnail derivative column", "thumbnail_storage_key"],
  ["the web derivative view field", "webStorageKey"],
  ["the thumbnail derivative view field", "thumbnailStorageKey"],
  ["the private bucket binding", "MASTERS"],
  ["an originals object path", "originals/"],
];

let probe = null;

try {
  if (!(await waitForServer())) {
    console.error("dev server did not start");
    console.error(serverOutput.slice(-3000));
    await shutdown();
    restoreWorkerVariables();
    process.exit(1);
  }

  // --- A. The library is reachable and shows both states ------------------

  const library = await getAs("/admin/photos", PHOTOGRAPHER);
  const libraryHtml = await library.text();
  check(library.status === 200, `the photo library returned ${library.status} for the photographer`);
  check(
    libraryHtml.includes("Closing time") && libraryHtml.includes("Unreleased edit"),
    "the library does not list both a published photograph and a draft",
  );
  check(
    /Draft — not public/.test(libraryHtml),
    "the library does not mark a draft as not public, so an operator cannot tell one at a glance",
  );
  check(
    /Published — public/.test(libraryHtml),
    "the library does not mark a published photograph as public",
  );
  check(
    libraryHtml.includes("Unpublish") || libraryHtml.includes("Publish"),
    "the library does not offer a publication action",
  );
  check(
    /\/admin\/photos\/[^"]+/.test(libraryHtml),
    "the library does not link to the per-photograph editor",
  );

  // --- B. Authorisation, including the actions ----------------------------

  const authorityCases = [
    ["/admin/photos", null, 401, "anonymous"],
    ["/admin/photos", UNKNOWN, 403, "an unknown identity"],
    ["/admin/photos", INACTIVE, 403, "a deactivated account"],
    ["/admin/photos", PHOTOGRAPHER, 200, "the photographer"],
    ["/admin/photos", MANAGER, 200, "the manager"],
    ["/admin/photos/closing-time", null, 401, "anonymous"],
    ["/admin/photos/closing-time", UNKNOWN, 403, "an unknown identity"],
    ["/admin/photos/closing-time", INACTIVE, 403, "a deactivated account"],
    ["/admin/photos/closing-time", PHOTOGRAPHER, 200, "the photographer"],
    ["/admin/photos/closing-time", MANAGER, 200, "the manager"],
    ["/admin/photos?role=manager&published=true", null, 401, "anonymous with a forged role query"],
    ["/admin/photos", null, 401, "anonymous with forged role headers"],
  ];
  for (const [path, identity, expected, label] of authorityCases) {
    const forged = label.includes("forged") ? FORGED_ROLE_HEADERS : {};
    const response = await getAs(path, identity, forged);
    check(
      response.status === expected,
      `${path} for ${label} returned ${response.status}, expected ${expected}`,
    );
    const body = await response.text();
    // A DENIAL must not carry operator content. An allowed response legitimately
    // contains the controls, so this is asserted only where access was refused.
    if (expected !== 200) {
      check(
        !body.includes("r2://") && !body.includes("Unpublish") && !body.includes("Photo library"),
        `${path} for ${label} served admin content in a denial`,
      );
    }
  }

  // The ACTIONS are guarded too, and a refused action must not mutate anything.
  const draftRowBefore = await photoRow("unreleased-edit");
  const actionCases = [
    [null, 401, "anonymous"],
    [UNKNOWN, 403, "an unknown identity"],
    [INACTIVE, 403, "a deactivated account"],
  ];
  for (const [identity, expected, label] of actionCases) {
    const response = await postAs(
      "/admin/photos",
      { photoId: "unreleased-edit", intent: "publish" },
      identity,
    );
    check(
      response.status === expected,
      `the publication action for ${label} returned ${response.status}, expected ${expected}`,
    );
    await response.text();
    const editResponse = await postAs(
      "/admin/photos/unreleased-edit",
      { title: "Hijacked", published: "draft", featured: "not-featured", galleryId: "gallery-nightlife" },
      identity,
    );
    check(
      editResponse.status === expected,
      `the editor action for ${label} returned ${editResponse.status}, expected ${expected}`,
    );
    await editResponse.text();
  }
  const draftRowAfterRefusals = await photoRow("unreleased-edit");
  check(
    JSON.stringify(draftRowBefore) === JSON.stringify(draftRowAfterRefusals),
    "a refused action changed the photograph anyway",
  );

  // ...and a forged role header cannot elevate an identity that is not authorised.
  const forgedAction = await postAs(
    "/admin/photos",
    { photoId: "unreleased-edit", intent: "publish" },
    UNKNOWN,
    FORGED_ROLE_HEADERS,
  );
  check(
    forgedAction.status === 403,
    `a forged manager role header elevated an unknown identity (${forgedAction.status})`,
  );
  await forgedAction.text();
  check(
    JSON.stringify(await photoRow("unreleased-edit")) === JSON.stringify(draftRowBefore),
    "a forged role header caused a mutation",
  );

  // An unrecognised intent is refused even for an authorised operator.
  const badIntent = await postAs(
    "/admin/photos",
    { photoId: "unreleased-edit", intent: "delete" },
    PHOTOGRAPHER,
  );
  const badIntentHtml = await badIntent.text();
  check(
    /not recognised|nothing was changed/i.test(badIntentHtml),
    "an unrecognised action was not refused explicitly",
  );
  check(
    JSON.stringify(await photoRow("unreleased-edit")) === JSON.stringify(draftRowBefore),
    "an unrecognised action mutated the photograph",
  );

  // --- C. The end-to-end publication chain --------------------------------

  // A DB-backed photograph with real derivative keys, created through the production
  // upload pipeline, so the /media boundary has something genuine to serve.
  const fixture = new FormData();
  fixture.append(
    "photos",
    new Blob([new Uint8Array(readFileSync(resolve(root, "scripts", "fixtures", "photo.jpg")))], {
      type: "image/jpeg",
    }),
    "photo.jpg",
  );
  const uploaded = await fetch(
    `${origin}/dev-verification?title=Managed+Probe&published=false&watermark=off&position=none&gallery=gallery-nightlife`,
    { method: "POST", body: fixture },
  );
  const uploadedBody = await uploaded.json();
  const row = (uploadedBody.rows ?? []).find((candidate) => candidate.slug === "managed-probe");
  check(Boolean(row), "no DB-backed photograph could be created for the withdrawal chain");
  if (!row) {
    throw new Error("the served check could not create its fixture photograph");
  }
  probe = {
    id: row.id,
    slug: row.slug,
    media: mediaUrlFor(row.web_storage_key),
    originalStorageKey: row.original_storage_key,
    webStorageKey: row.web_storage_key,
    thumbnailStorageKey: row.thumbnail_storage_key,
  };
  check(
    String(row.web_storage_key).startsWith("r2://images/web/"),
    `the fixture does not hold an internal derivative key: ${row.web_storage_key}`,
  );

  // (14) A draft is not served.
  const draftPage = await fetch(`${origin}/photo/${probe.slug}`, { redirect: "manual" });
  check(draftPage.status === 404, `a draft photograph returned ${draftPage.status}, expected 404`);
  await draftPage.text();
  const draftMedia = await fetch(`${origin}${probe.media}`, { redirect: "manual" });
  check(draftMedia.status === 404, `a draft derivative returned ${draftMedia.status}, expected 404`);
  await draftMedia.text();

  // (15, 16, 17) Publish it, and it becomes a real public page with a real image.
  const publishResponse = await postAs(
    "/admin/photos",
    { photoId: probe.id, intent: "publish" },
    PHOTOGRAPHER,
  );
  const publishHtml = await publishResponse.text();
  check(publishResponse.status === 200, `the publish action returned ${publishResponse.status}`);
  check(
    /is now published/i.test(publishHtml),
    "the publish action did not report the confirmed new state",
  );
  const publishedRow = await photoRow(probe.id);
  check(publishedRow?.published === 1, "the publish action did not persist");
  check(
    typeof publishedRow?.published_at === "string" && publishedRow.published_at.length > 0,
    "a published photograph carries no publication timestamp",
  );
  const livePage = await fetch(`${origin}/photo/${probe.slug}`, { redirect: "manual" });
  const liveHtml = await livePage.text();
  check(livePage.status === 200, `a published photograph returned ${livePage.status}, expected 200`);
  const liveMedia = await fetch(`${origin}${probe.media}`, { redirect: "manual" });
  check(liveMedia.status === 200, `the published derivative returned ${liveMedia.status}, expected 200`);
  if (liveMedia.status === 200) {
    const bytes = new Uint8Array(await liveMedia.arrayBuffer());
    check(
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes.byteLength > 0,
      `the served derivative is not a real image (${bytes.byteLength} bytes)`,
    );
  }

  // (22) Make it print-eligible, so the withdrawal assertion below is meaningful.
  const printOn = await postAs(
    "/admin/prints",
    { photoId: probe.id, printAvailable: "on" },
    PHOTOGRAPHER,
  );
  await printOn.text();
  check((await photoRow(probe.id))?.print_available === 1, "the print-eligibility step did not persist");
  const printsBefore = await (await fetch(`${origin}/prints`)).text();
  check(
    printsBefore.includes(`/prints/enquire?photo=${probe.slug}`),
    "an eligible published photograph was not offered on the print page",
  );

  // (18) Withdraw it.
  const withdrawResponse = await postAs(
    "/admin/photos",
    { photoId: probe.id, intent: "unpublish" },
    PHOTOGRAPHER,
  );
  const withdrawHtml = await withdrawResponse.text();
  check(withdrawResponse.status === 200, `the unpublish action returned ${withdrawResponse.status}`);
  check(
    /is now a draft/i.test(withdrawHtml) && /no longer served/i.test(withdrawHtml),
    "the unpublish action did not report the withdrawal plainly",
  );

  const withdrawnRow = await photoRow(probe.id);
  check(withdrawnRow?.published === 0, "the unpublish action did not persist");
  check(withdrawnRow?.published_at === null, "a withdrawn photograph kept its publication timestamp");
  check(
    withdrawnRow?.original_storage_key === probe.originalStorageKey &&
      withdrawnRow?.web_storage_key === probe.webStorageKey &&
      withdrawnRow?.thumbnail_storage_key === probe.thumbnailStorageKey,
    "withdrawing the photograph changed its storage identity",
  );

  // (19) The public page stops.
  const gonePage = await fetch(`${origin}/photo/${probe.slug}`, { redirect: "manual" });
  const goneHtml = await gonePage.text();
  check(gonePage.status === 404, `a withdrawn photograph returned ${gonePage.status}, expected 404`);
  // The 404 must not describe the photograph. The slug itself is deliberately NOT
  // asserted absent: React Router serialises the requested location into the page's
  // own router state, so it appears on every 404 and proves nothing. What must be
  // absent is the photograph's content and any path to its image.
  check(
    !goneHtml.includes("Managed probe") && !goneHtml.includes("/media/"),
    "the withdrawn photograph's own content appeared in its 404 body",
  );

  // (20) THE CRITICAL ASSERTION: the exact URL that served a moment ago now does not.
  const goneMedia = await fetch(`${origin}${probe.media}`, { redirect: "manual" });
  check(
    goneMedia.status === 404,
    `THE REGRESSION: the withdrawn photograph's derivative still served ${goneMedia.status} at ${probe.media}`,
  );
  await goneMedia.text();

  // (21) It disappears from the public listings.
  const galleriesHtml = await (await fetch(`${origin}/galleries`)).text();
  const homeHtml = await (await fetch(`${origin}/`)).text();
  const galleryHtml = await (await fetch(`${origin}/gallery/nightlife`)).text();
  for (const [label, html] of [
    ["the galleries index", galleriesHtml],
    ["the homepage", homeHtml],
    ["its gallery", galleryHtml],
  ]) {
    check(!html.includes(probe.slug), `${label} still lists the withdrawn photograph`);
  }

  // (22) Print enquiries refuse it while it is unpublished, even though the flag is on.
  const printsAfter = await (await fetch(`${origin}/prints`)).text();
  check(
    !printsAfter.includes(probe.slug),
    "a withdrawn photograph is still offered on the print page",
  );
  const enquiryAfter = await fetch(`${origin}/prints/enquire?photo=${probe.slug}`, {
    redirect: "manual",
  });
  check(
    enquiryAfter.status === 404,
    `the print enquiry form resolved a withdrawn photograph (${enquiryAfter.status})`,
  );
  await enquiryAfter.text();
  check(
    (await photoRow(probe.id))?.print_available === 1,
    "the withdrawal cleared the print flag instead of relying on publication",
  );

  // (23) Re-publishing restores everything.
  const republishResponse = await postAs(
    "/admin/photos",
    { photoId: probe.id, intent: "publish" },
    PHOTOGRAPHER,
  );
  await republishResponse.text();
  check((await photoRow(probe.id))?.published === 1, "re-publishing did not persist");
  check(
    (await fetch(`${origin}/photo/${probe.slug}`, { redirect: "manual" })).status === 200,
    "the public page did not come back after re-publishing",
  );
  check(
    (await fetch(`${origin}${probe.media}`, { redirect: "manual" })).status === 200,
    "the derivative did not come back after re-publishing",
  );
  check(
    (await (await fetch(`${origin}/gallery/nightlife`)).text()).includes(probe.slug),
    "the photograph did not return to its public gallery",
  );

  // --- D. Editing over HTTP, and what a visitor then sees ------------------
  //
  // The metadata is changed from the editor route, which resolves the photograph from
  // the URL rather than from a submitted id.
  const editResponse = await postAs(
    `/admin/photos/${probe.id}`,
    {
      title: "Managed probe, corrected",
      description: "A corrected public description.",
      location: "New Brighton",
      captureDate: "2024-11-02",
      galleryId: "gallery-cars",
      tags: ["tag-cars", "tag-night"],
      published: "published",
      featured: "featured",
    },
    PHOTOGRAPHER,
  );
  const editHtml = await editResponse.text();
  check(editResponse.status === 200, `the editor action returned ${editResponse.status}`);
  check(/Saved\./.test(editHtml), "the editor action did not report a confirmed save");
  const editedRow = await photoRow(probe.id);
  check(editedRow?.title === "Managed probe, corrected", `the title was stored as ${editedRow?.title}`);
  check(editedRow?.description === "A corrected public description.", "the description was not stored");
  check(editedRow?.location === "New Brighton", "the location was not stored");
  check(editedRow?.capture_date === "2024-11-02", "the capture date was not stored");
  check(editedRow?.gallery_id === "gallery-cars", "the gallery change was not stored");
  check(editedRow?.featured === 1, "the featured change was not stored");
  check(editedRow?.published === 1, "the editor action withdrew the photograph");
  const storedTags = (
    await queryLocalD1(
      `SELECT tag_id FROM photo_tags WHERE photo_id = ${quote(probe.id)} ORDER BY tag_id`,
    )
  ).map((entry) => entry.tag_id);
  check(
    JSON.stringify(storedTags) === JSON.stringify(["tag-cars", "tag-night"]),
    `the tags were stored as ${JSON.stringify(storedTags)}`,
  );

  // (9, 42) A visitor sees the edits, and sees no internal reference.
  const editedPage = await fetch(`${origin}/photo/${probe.slug}`, { redirect: "manual" });
  const editedHtml = await editedPage.text();
  check(editedPage.status === 200, `the edited photograph returned ${editedPage.status}`);
  check(
    editedHtml.includes("Managed probe, corrected") &&
      editedHtml.includes("A corrected public description."),
    "the public page does not show the edited title and description",
  );
  check(
    /alt="A corrected public description\."/.test(editedHtml),
    "the edited description is not used as the photograph's alternative text",
  );
  for (const [label, marker] of PRIVATE_MARKERS) {
    check(!editedHtml.includes(marker), `the public page contains ${label} (${marker})`);
  }
  check(
    editedHtml.includes(probe.media.split("/").slice(0, -1).join("/")),
    "the public page does not use the browser-facing derivative path",
  );
  const cars = await (await fetch(`${origin}/gallery/cars`)).text();
  check(cars.includes(probe.slug), "the photograph did not appear in its new public gallery");
  const nightlife = await (await fetch(`${origin}/gallery/nightlife`)).text();
  check(!nightlife.includes(probe.slug), "the photograph is still listed in its previous gallery");

  // (37) A submission naming storage identity is refused, and changes nothing.
  const forgedEdit = await postAs(
    `/admin/photos/${probe.id}`,
    {
      title: "Forged",
      description: "",
      location: "",
      captureDate: "",
      galleryId: "gallery-cars",
      published: "published",
      featured: "not-featured",
      original_storage_key: "r2://masters/originals/evil/master.tif",
      web_storage_key: "r2://images/web/evil/web.webp",
    },
    PHOTOGRAPHER,
  );
  const forgedHtml = await forgedEdit.text();
  check(
    /cannot change/i.test(forgedHtml),
    "a submission naming storage identity was not refused explicitly",
  );
  const afterForged = await photoRow(probe.id);
  check(
    afterForged?.original_storage_key === probe.originalStorageKey &&
      afterForged?.web_storage_key === probe.webStorageKey &&
      afterForged?.thumbnail_storage_key === probe.thumbnailStorageKey,
    "a client-supplied storage key was honoured",
  );
  check(afterForged?.title === "Managed probe, corrected", "a refused submission still changed the title");
  check(
    JSON.stringify(afterForged) === JSON.stringify(editedRow),
    "a refused submission changed the stored row",
  );

  // (34, 35, 36) Invalid values are refused over HTTP and change nothing.
  const beforeInvalid = await photoRow(probe.id);
  for (const [label, fields] of [
    [
      "an impossible capture date",
      { captureDate: "2026-02-30", published: "published", featured: "not-featured" },
    ],
    ["an unknown gallery", { galleryId: "gallery-nope" }],
    ["an overlong title", { title: "x".repeat(400) }],
  ]) {
    const response = await postAs(
      `/admin/photos/${probe.id}`,
      {
        title: "Managed probe, corrected",
        description: "A corrected public description.",
        location: "New Brighton",
        captureDate: "2024-11-02",
        galleryId: "gallery-cars",
        tags: ["tag-cars", "tag-night"],
        published: "published",
        featured: "featured",
        ...fields,
      },
      PHOTOGRAPHER,
    );
    const html = await response.text();
    check(
      /Nothing was saved|correct the fields|does not exist|real date|characters or fewer/i.test(html),
      `${label} was not refused with a reason`,
    );
  }
  check(
    JSON.stringify(await photoRow(probe.id)) === JSON.stringify(beforeInvalid),
    "an invalid submission changed the stored row",
  );

  // A draft gallery hides a published photograph — the gallery rule still governs.
  const intoDraftGallery = await postAs(
    `/admin/photos/${probe.id}`,
    {
      title: "Managed probe, corrected",
      description: "A corrected public description.",
      location: "New Brighton",
      captureDate: "2024-11-02",
      galleryId: "gallery-studio",
      published: "published",
      featured: "not-featured",
    },
    PHOTOGRAPHER,
  );
  const intoDraftHtml = await intoDraftGallery.text();
  check(
    /still a draft/i.test(intoDraftHtml) && /not visible on the public site/i.test(intoDraftHtml),
    "the editor did not warn that a draft gallery keeps a published photograph off the site",
  );
  check(
    (await fetch(`${origin}/photo/${probe.slug}`, { redirect: "manual" })).status === 404,
    "a published photograph in an unpublished gallery was still served",
  );
  check(
    (await fetch(`${origin}${probe.media}`, { redirect: "manual" })).status === 404,
    "a published photograph in an unpublished gallery served its derivative",
  );
  await postAs(
    `/admin/photos/${probe.id}`,
    {
      title: "Managed probe, corrected",
      description: "A corrected public description.",
      location: "New Brighton",
      captureDate: "2024-11-02",
      galleryId: "gallery-cars",
      tags: ["tag-cars", "tag-night"],
      published: "published",
      featured: "not-featured",
    },
    PHOTOGRAPHER,
  );

  // The private master stayed private throughout.
  check(
    (await fetch(`${origin}/media/originals/${probe.id}/master.jpg`, { redirect: "manual" })).status === 404,
    "a master-shaped media path was served",
  );
  check(
    !(await (await fetch(`${origin}/photo/${probe.slug}`)).text()).includes(probe.originalStorageKey),
    "the private master key reached the public page",
  );
} finally {
  await shutdown();
  restoreWorkerVariables();
}

if (failures.length > 0) {
  console.error(`Served photograph management check FAILED with ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(` - ${failure}`);
  }
  process.exit(1);
}
console.log(
  "Served photograph management check passed: the library listed drafts and published photographs and marked " +
    "each state; every operator route and BOTH actions denied anonymous, unknown and deactivated identities while " +
    "allowing the photographer and the manager, and no forged role header or query value changed a decision; a " +
    "draft uploaded through the production pipeline returned 404 and its derivative 404, publishing made both " +
    "serve, and UNPUBLISHING made the public page and the exact previously-working /media URL return 404 again on " +
    "the next request, removed it from the galleries, homepage and print enquiries while its print flag and " +
    "storage identity stayed intact, and re-publishing restored all of it; edits persisted, appeared to a visitor " +
    "and in the new gallery, and a submission naming storage identity was refused with nothing changed.",
);
