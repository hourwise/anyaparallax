#!/usr/bin/env node
/**
 * Served operator CSRF check (REPAIR-09E, APV1-01).
 *
 * The independent audit's blocker was that an authenticated operator action had no
 * application-level origin check: Cloudflare Access proved an identity, and nothing
 * asked WHERE the request came from. A hostile page cannot read an authenticated
 * response, but it can make a browser send the request — form posts are not
 * preflighted — so a state change was reachable with the operator's own credentials
 * attached.
 *
 * This suite drives EVERY mutating operator action over real HTTP and asserts the
 * order the repair establishes:
 *
 *   authorization -> same-origin -> (size) -> body -> validation -> mutation
 *
 * For each action it proves the two ways a real form is accepted, the five ways a
 * cross-site request must be refused with the database and both object buckets
 * unchanged, and that the three authentication refusals still behave exactly as
 * they did (401 for no identity, 403 for an identity that is unknown, deactivated
 * or lacks the role). It then reproduces the audit's highest-risk scenario against a
 * real published photograph with a real `/media/...` URL, and the upload case where
 * parsing multipart data would be the expensive part.
 *
 * The inventory is exhaustive by construction: `/manager/*` exports no action at
 * all, and the five entries below are every `action` export under `app/routes/admin/`.
 * Section A fails if that stops being true, so a sixth action cannot be added
 * without being tested here.
 *
 * Local only: Wrangler's local D1/R2, loopback HTTP, no external service.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { withWorkerVariables } from "./dev-vars.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 4193;
const origin = `http://[::1]:${port}`;

/** The origin a hostile page is served from. It is never this site. */
const HOSTILE_ORIGIN = "https://evil.example";
const SAME_ORIGIN_REFERER = `${origin}/admin/photos`;
const HOSTILE_REFERER = `${HOSTILE_ORIGIN}/admin/photos`;

register("../ts-extension-hooks.mjs", import.meta.url);
const { FORM_ISSUED_AT_FIELD, FORM_TRAP_FIELD } = await import(
  "../../app/enquiries/abuse-guard.ts"
);
const { DEFAULT_WATERMARK_POSITION } = await import("../../app/images/image-processor.ts");
const { seed } = await import("../../app/data/seed.ts");
const { migrateLocalD1, queryLocalD1, seedLocalD1 } = await import("./local-d1.mjs");
const { runWrangler } = await import("./d1-harness.mjs");

await migrateLocalD1();
await seedLocalD1(seed);

const IDENTITY_HEADER = "x-anyaparallax-development-identity";
const PHOTOGRAPHER = "photographer@anyaparallax.test";
const INACTIVE = "deactivated@anyaparallax.test";
const UNKNOWN = "stranger@anyaparallax.test";

/** Role material a client might try to inject; none of it may change a decision. */
const FORGED_ROLE_HEADERS = {
  "x-anyaparallax-role": "manager",
  "cf-anyaparallax-role": "manager",
  role: "manager",
  "cf-access-authenticated-user-email": PHOTOGRAPHER,
};

/** A published photograph in a published gallery, and print-INELIGIBLE. */
const PUBLISHED_PHOTO = "closing-time";

/** The local R2 buckets, as Wrangler stores them, so "no object was created" is checkable. */
const IMAGES_BLOBS = resolve(root, ".wrangler", "state", "v3", "r2", "anyaparallax-images-dev", "blobs");
const MASTERS_BLOBS = resolve(root, ".wrangler", "state", "v3", "r2", "anyaparallax-masters-dev", "blobs");

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

/**
 * A form POST carrying EXACTLY the origin headers it is given.
 *
 * A key that is absent from `originHeaders` means the header is ABSENT from the
 * request — which is the whole point of the matrix: "no Origin and no Referer" is a
 * different request from "no Origin", and a helper that always added one would make
 * both indistinguishable.
 */
function postForm(path, fields, { identity = PHOTOGRAPHER, ...originHeaders } = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    body.append(key, String(value));
  }
  return fetch(`${origin}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(identity === null ? {} : { [IDENTITY_HEADER]: identity }),
      ...originHeaders,
    },
    body: body.toString(),
  });
}

/** A multipart upload the way the operator's own form sends it. */
function postUpload(path, fields, { identity = PHOTOGRAPHER, ...originHeaders } = {}) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    body.append(key, String(value));
  }
  body.append(
    "photos",
    new Blob([new Uint8Array(readFileSync(resolve(root, "scripts", "fixtures", "photo.jpg")))], {
      type: "image/jpeg",
    }),
    "photo.jpg",
  );
  return fetch(`${origin}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      ...(identity === null ? {} : { [IDENTITY_HEADER]: identity }),
      ...originHeaders,
    },
    body,
  });
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function photoRow(id) {
  return queryLocalD1(`SELECT * FROM photos WHERE id = ${quote(id)}`).then((rows) => rows[0] ?? null);
}

/** Files currently stored in a local R2 bucket, or null when the bucket has no state. */
function storedObjects(directory) {
  if (!existsSync(directory)) {
    return null;
  }
  return readdirSync(directory, { recursive: true }).length;
}

/**
 * What the database and both buckets hold right now, as one comparable string.
 *
 * One Wrangler invocation reads every statement, so a before/after pair is one
 * round trip rather than four. The digest covers every table a mutating operator
 * action could touch plus both object buckets, because "zero mutation" has to mean
 * the whole of the stored state and not merely the row the request named.
 */
async function stateDigest() {
  const statements = [
    "SELECT id, title, published, published_at, featured, print_available, gallery_id FROM photos ORDER BY id",
    "SELECT id, status FROM enquiries ORDER BY id",
    "SELECT COUNT(*) AS total FROM photo_tags",
  ];
  const { stdout } = await runWrangler([
    "d1",
    "execute",
    "anyaparallax",
    "--local",
    "--yes",
    "--json",
    "--command",
    statements.join(";"),
  ]);
  const lines = stdout.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "[");
  if (start === -1) {
    throw new Error(`Wrangler did not return JSON for the state digest\n${stdout.slice(-2000)}`);
  }
  const parsed = JSON.parse(lines.slice(start).join("\n"));
  return JSON.stringify({
    rows: parsed.map((entry) => entry?.results ?? []),
    images: storedObjects(IMAGES_BLOBS),
    masters: storedObjects(MASTERS_BLOBS),
  });
}

/** The photograph editor's form, as its own page renders it. */
function editorFields(overrides = {}) {
  return {
    title: "Closing time",
    description: "The last few minutes of a night, picked out in red.",
    location: "Manchester",
    captureDate: "2026-08-02",
    galleryId: "gallery-nightlife",
    published: "published",
    featured: "not-featured",
    ...overrides,
  };
}

/** An upload form, with a title that decides the slug the pipeline derives. */
function uploadFields(title) {
  return {
    title,
    description: "An operator CSRF probe uploaded through the real pipeline.",
    galleryId: "gallery-nightlife",
    watermarkEnabled: "on",
    watermarkPosition: DEFAULT_WATERMARK_POSITION,
    published: "on",
  };
}

/** The two ways a real form is accepted: an exact Origin, or a same-origin Referer. */
const ACCEPTED_CASES = [
  ["an exact same-origin Origin", { origin }],
  ["no Origin but a same-origin Referer", { referer: SAME_ORIGIN_REFERER }],
];

/**
 * The six ways a request that did not come from this site is refused.
 *
 * The expected status says WHICH layer may refuse it, because React Router has an
 * origin check of its own: it compares a PRESENT `Origin` header with the request URL
 * — an opaque `Origin: null` included — and answers 400 before the route runs. What
 * it never does is look at `Referer`, so a request with no `Origin` at all reaches
 * the action. That gap is the audited blocker, and it is why the three cases below
 * that the framework lets through must be refused with exactly 403 by OUR guard. A
 * `[400, 403]` case is refused either way; a `[403]` case proves which check is
 * load-bearing.
 */
const REFUSED_CASES = [
  ["a hostile Origin", { origin: HOSTILE_ORIGIN }, [400, 403]],
  [
    "a hostile Origin with a friendly Referer",
    { origin: HOSTILE_ORIGIN, referer: SAME_ORIGIN_REFERER },
    [400, 403],
  ],
  ["an opaque origin (`Origin: null`)", { origin: "null" }, [400, 403]],
  ["no Origin and a hostile Referer", { referer: HOSTILE_REFERER }, [403]],
  ["no Origin and no Referer", {}, [403]],
  ["a malformed Referer", { referer: "not a url" }, [403]],
];

/** Authentication must stay a separate decision from origin. */
const AUTH_CASES = [
  [null, 401, "an anonymous request", {}],
  [UNKNOWN, 403, "an unknown identity", {}],
  [INACTIVE, 403, "a deactivated account", {}],
  [UNKNOWN, 403, "an unknown identity presenting forged role material", FORGED_ROLE_HEADERS],
];

/**
 * EVERY mutating operator action.
 *
 * `accepted` runs first and holds the two bodies a real operator form sends — the
 * second undoes the first, so the run leaves the state as it found it. `refused` is
 * a body that WOULD change something if it got through, which is what makes the
 * refusals meaningful: a request that changes nothing anyway proves nothing.
 */
const ACTIONS = [
  {
    label: "the photo library's state actions",
    path: "/admin/photos",
    accepted: [
      { fields: { photoId: PUBLISHED_PHOTO, intent: "unpublish" }, expect: /is now a draft/i },
      { fields: { photoId: PUBLISHED_PHOTO, intent: "publish" }, expect: /is now published/i },
    ],
    refused: { photoId: PUBLISHED_PHOTO, intent: "unpublish" },
  },
  {
    label: "the photograph editor",
    path: `/admin/photos/${PUBLISHED_PHOTO}`,
    accepted: [
      { fields: editorFields(), expect: /Saved\./ },
      { fields: editorFields(), expect: /Saved\./ },
    ],
    refused: editorFields({ title: "Hostile rewrite" }),
  },
  {
    label: "print eligibility",
    path: "/admin/prints",
    accepted: [
      { fields: { photoId: PUBLISHED_PHOTO, printAvailable: "on" }, expect: /now offered for print/i },
      { fields: { photoId: PUBLISHED_PHOTO }, expect: /no longer offered for print/i },
    ],
    refused: { photoId: PUBLISHED_PHOTO, printAvailable: "on" },
  },
  {
    label: "the enquiry queue",
    path: "/admin/enquiries",
    accepted: [
      { fields: { enquiryId: null, status: "read" }, expect: /Marked as/i },
      { fields: { enquiryId: null, status: "new" }, expect: /Marked as/i },
    ],
    refused: { enquiryId: null, status: "read" },
  },
  {
    label: "the upload pipeline",
    path: "/admin/upload",
    multipart: true,
    accepted: [
      { fields: uploadFields("CSRF Probe A"), expect: /accepted/i },
      { fields: uploadFields("CSRF Probe B"), expect: /accepted/i },
    ],
    refused: uploadFields("CSRF Attack"),
  },
];

try {
  if (!(await waitForServer())) {
    console.error("dev server did not start");
    console.error(serverOutput.slice(-3000));
    await shutdown();
    restoreWorkerVariables();
    process.exit(1);
  }

  // --- A. The inventory and the single definition of the guard -------------

  const appFiles = readdirSync(resolve(root, "app"), { recursive: true })
    .map((entry) => String(entry).replace(/\\/g, "/"))
    .filter((name) => /\.tsx?$/.test(name));

  const definers = appFiles.filter((name) =>
    /export\s+(async\s+)?function\s+isSameOriginRequest/.test(
      readFileSync(resolve(root, "app", name), "utf8"),
    ),
  );
  check(
    definers.length === 1 && definers[0] === "lib/same-origin.ts",
    `the same-origin guard must have exactly one definition in app/lib/same-origin.ts, found ${JSON.stringify(definers)}`,
  );

  // Every mutating operator action uses the shared guard, imported from that module.
  const OPERATOR_ACTIONS = [
    "routes/admin/photos.tsx",
    "routes/admin/photos.$photoId.tsx",
    "routes/admin/upload.tsx",
    "routes/admin/enquiries.tsx",
    "routes/admin/prints.tsx",
  ];
  for (const file of OPERATOR_ACTIONS) {
    const source = readFileSync(resolve(root, "app", file), "utf8");
    const guarded =
      source.includes('from "../../lib/same-origin"') &&
      source.includes("isSameOriginRequest(request)");
    check(guarded, `${file} uses the shared same-origin guard: ${guarded}`);
  }
  // ...and so do the public mutation paths the guard was moved for.
  for (const file of [
    "routes/contact.tsx",
    "routes/prints.enquire.tsx",
    "routes/engagement.$slug.tsx",
  ]) {
    const source = readFileSync(resolve(root, "app", file), "utf8");
    const guarded =
      source.includes('from "../lib/same-origin"') &&
      source.includes("isSameOriginRequest(request)");
    check(guarded, `${file} keeps the shared same-origin guard after the move: ${guarded}`);
  }
  // The inventory is exhaustive: a NEW action export under app/routes/admin/ must be
  // added to this check rather than be silently untested.
  const adminActionFiles = appFiles
    .filter((name) => name.startsWith("routes/admin/"))
    .filter((name) =>
      /export\s+(async\s+)?function\s+action/.test(readFileSync(resolve(root, "app", name), "utf8")),
    );
  check(
    adminActionFiles.length === OPERATOR_ACTIONS.length &&
      adminActionFiles.every((name) => OPERATOR_ACTIONS.includes(name)),
    `the mutating operator action inventory is ${JSON.stringify(adminActionFiles)}, and this check tests ` +
      `${JSON.stringify(OPERATOR_ACTIONS)}`,
  );
  // `/manager/*` has no write path at all, which is why it appears in no case below.
  const managerActionFiles = appFiles.filter(
    (name) =>
      name.startsWith("routes/manager/") &&
      /export\s+(async\s+)?function\s+action/.test(readFileSync(resolve(root, "app", name), "utf8")),
  );
  check(
    managerActionFiles.length === 0,
    `manager routes with a mutating action: ${JSON.stringify(managerActionFiles)} (none exist, so none is covered here)`,
  );

  // --- B. An enquiry to act on ---------------------------------------------

  const contactSubmission = await postForm(
    "/contact",
    {
      name: "CSRF probe",
      email: "csrf.probe@example.com",
      category: "gig-photography",
      message: "An enquiry created so the operator queue has a row to change.",
      submissionToken: crypto.randomUUID(),
      [FORM_TRAP_FIELD]: "",
      [FORM_ISSUED_AT_FIELD]: String(Date.now() - 2_000),
    },
    { origin },
  );
  await contactSubmission.text();
  check(
    contactSubmission.status === 303,
    `the contact form answered the fixture enquiry with ${contactSubmission.status}`,
  );
  const enquiryRow = (
    await queryLocalD1("SELECT id, status FROM enquiries ORDER BY created_at DESC LIMIT 1")
  )[0];
  check(
    typeof enquiryRow?.id === "string" && enquiryRow.status === "new",
    `the fixture enquiry row for the queue action is ${JSON.stringify(enquiryRow)}`,
  );
  if (!enquiryRow) {
    throw new Error("the served check could not create its enquiry fixture");
  }
  for (const action of ACTIONS) {
    if (action.path === "/admin/enquiries") {
      for (const entry of [...action.accepted, { fields: action.refused }]) {
        entry.fields.enquiryId = enquiryRow.id;
      }
    }
  }

  // --- C. The matrix, for every mutating operator action -------------------

  for (const action of ACTIONS) {
    const send = (body, headers) =>
      action.multipart
        ? postUpload(action.path, body.fields, { identity: PHOTOGRAPHER, ...headers })
        : postForm(action.path, body.fields, { identity: PHOTOGRAPHER, ...headers });

    // (1, 2) Both accepted forms reach the action's normal behaviour: the first
    // request through an exact origin, the second — its inverse — through a
    // same-origin Referer with no Origin, which also leaves the state as it was.
    for (const [index, [label, headers]] of ACCEPTED_CASES.entries()) {
      const attempt = action.accepted[index];
      const response = await send(attempt, headers);
      const body = await response.text();
      check(response.status === 200, `${action.label} with ${label} returned ${response.status}`);
      check(
        attempt.expect.test(body),
        `${action.label} with ${label} did not report the action's outcome`,
      );
    }

    // (3-7) Every cross-site shape is refused, and refuses to change anything.
    for (const [label, headers, expected] of REFUSED_CASES) {
      const before = await stateDigest();
      const response = await send({ fields: action.refused }, headers);
      const body = await response.text();
      check(
        expected.includes(response.status),
        `${action.label} with ${label} returned ${response.status}, expected ${expected.join(" or ")}`,
      );
      const plain =
        !body.includes("Saved") &&
        !/is now (published|a draft)/i.test(body) &&
        !/accepted/i.test(body) &&
        !body.includes("r2://") &&
        !body.includes(PHOTOGRAPHER) &&
        !/jwt|bearer/i.test(body);
      check(
        plain,
        `${action.label} with ${label} answered with a refusal carrying no action output or internal detail: ${plain}`,
      );
      const unchanged = (await stateDigest()) === before;
      check(unchanged, `${action.label} with ${label} left the stored state unchanged: ${unchanged}`);
    }

    // (8-10) Authentication remains an independent decision, checked FIRST: an
    // authenticated request is refused by the origin guard, and an unauthenticated
    // one by the guard it has always been refused by.
    const beforeAuth = await stateDigest();
    for (const [identity, expected, label, extra] of AUTH_CASES) {
      const response = await send({ fields: action.refused }, { origin, identity, ...extra });
      await response.text();
      check(
        response.status === expected,
        `${action.label} for ${label} returned ${response.status}, expected ${expected}`,
      );
    }
    // Authorization precedes the origin check, so an anonymous request keeps its 401
    // rather than becoming a 403 that hides which guard refused it.
    const anonymousOriginless = await send({ fields: action.refused }, { identity: null });
    await anonymousOriginless.text();
    check(
      anonymousOriginless.status === 401,
      `${action.label} refused an anonymous originless request with ${anonymousOriginless.status}, expected 401 before the origin check`,
    );
    // ...and a hostile origin is refused by the framework before authentication is
    // even consulted, which is the layer that already existed for that shape.
    const anonymousHostile = await send({ fields: action.refused }, { origin: HOSTILE_ORIGIN, identity: null });
    await anonymousHostile.text();
    check(
      [400, 401].includes(anonymousHostile.status),
      `${action.label} refused an anonymous hostile-origin request with ${anonymousHostile.status}, expected 400 or the unchanged 401`,
    );
    const authUnchanged = (await stateDigest()) === beforeAuth;
    check(
      authUnchanged,
      `${action.label} left the stored state unchanged during the authentication cases: ${authUnchanged}`,
    );
  }

  // --- D. The audit's highest-risk scenario --------------------------------

  // A real photograph created through the real pipeline by the upload case above,
  // so there is a genuine `/media/...` URL whose behaviour can be observed.
  const probeRow = (
    await queryLocalD1("SELECT * FROM photos WHERE title = 'CSRF Probe A' LIMIT 1")
  )[0];
  check(Boolean(probeRow), `the upload case stored a photograph to attack: ${Boolean(probeRow)}`);
  if (!probeRow) {
    throw new Error("the served check could not find its uploaded fixture photograph");
  }
  const probeMedia = `/${String(probeRow.web_storage_key).replace("r2://images/", "media/")}`;

  const established = await photoRow(probeRow.id);
  check(
    established?.published === 1,
    `the fixture photograph's stored published flag is ${established?.published}`,
  );
  const pageBefore = await fetch(`${origin}/photo/${probeRow.slug}`, { redirect: "manual" });
  await pageBefore.text();
  check(
    pageBefore.status === 200,
    `the fixture photograph's page returned ${pageBefore.status} before the attack`,
  );
  const mediaBefore = await fetch(`${origin}${probeMedia}`, { redirect: "manual" });
  await mediaBefore.arrayBuffer();
  check(mediaBefore.status === 200, `the published derivative returned ${mediaBefore.status} before the attack`);

  // Both shapes of the attack: one that a hostile page's form post produces (a
  // contradicted `Origin`, refused by the framework's own check), and the one the
  // framework never looks at — no `Origin` at all with a hostile `Referer`, which
  // reaches the action and can only be refused by this repair's guard.
  for (const [label, headers, expected] of [
    ["a hostile Origin", { origin: HOSTILE_ORIGIN, referer: SAME_ORIGIN_REFERER }, [400, 403]],
    ["no Origin and a hostile Referer", { referer: HOSTILE_REFERER }, [403]],
  ]) {
    const attack = await postForm(
      "/admin/photos",
      { photoId: probeRow.id, intent: "unpublish" },
      headers,
    );
    const attackBody = await attack.text();
    check(
      expected.includes(attack.status),
      `a withdrawal with ${label} returned ${attack.status}, expected ${expected.join(" or ")}`,
    );
    const reportedSuccess = /is now a draft/i.test(attackBody);
    check(
      reportedSuccess === false,
      `the refused withdrawal with ${label} reported success: ${reportedSuccess}`,
    );
    const rowUnchanged = JSON.stringify(await photoRow(probeRow.id)) === JSON.stringify(established);
    check(rowUnchanged, `the stored row after the withdrawal with ${label} is unchanged: ${rowUnchanged}`);
    const pageAfterAttack = await fetch(`${origin}/photo/${probeRow.slug}`, { redirect: "manual" });
    await pageAfterAttack.text();
    check(
      pageAfterAttack.status === 200,
      `the fixture photograph's page returned ${pageAfterAttack.status} after the withdrawal with ${label}`,
    );
    const mediaAfterAttack = await fetch(`${origin}${probeMedia}`, { redirect: "manual" });
    await mediaAfterAttack.arrayBuffer();
    check(
      mediaAfterAttack.status === 200,
      `/media returned ${mediaAfterAttack.status} for the published derivative after the withdrawal with ${label}`,
    );
  }

  // The same state, on a photograph that existed before this check ran, attacked in
  // the shape only the guard refuses.
  const seedBefore = await photoRow(PUBLISHED_PHOTO);
  const seedAttack = await postForm(
    "/admin/photos",
    { photoId: PUBLISHED_PHOTO, intent: "unpublish" },
    { referer: HOSTILE_REFERER },
  );
  await seedAttack.text();
  const seedRowUnchanged = JSON.stringify(await photoRow(PUBLISHED_PHOTO)) === JSON.stringify(seedBefore);
  check(
    seedAttack.status === 403 && seedRowUnchanged,
    `an originless hostile-referer withdrawal of a seed photograph returned ${seedAttack.status} and left its row unchanged: ${seedRowUnchanged}`,
  );

  // ...and the equivalent SAME-ORIGIN action does succeed, so the refusal is the
  // origin check and not a broken endpoint.
  const legitimate = await postForm(
    "/admin/photos",
    { photoId: probeRow.id, intent: "unpublish" },
    { origin },
  );
  const legitimateBody = await legitimate.text();
  const legitimateReported = /is now a draft/i.test(legitimateBody);
  check(
    legitimate.status === 200 && legitimateReported,
    `the same-origin withdrawal returned ${legitimate.status} and reported the withdrawal: ${legitimateReported}`,
  );
  const withdrawnFlag = (await photoRow(probeRow.id))?.published;
  check(withdrawnFlag === 0, `the stored published flag after the same-origin withdrawal is ${withdrawnFlag}`);
  const pageAfterWithdrawal = await fetch(`${origin}/photo/${probeRow.slug}`, { redirect: "manual" });
  await pageAfterWithdrawal.text();
  check(
    pageAfterWithdrawal.status === 404,
    `the withdrawn fixture photograph's page returned ${pageAfterWithdrawal.status}`,
  );
  const mediaAfterWithdrawal = await fetch(`${origin}${probeMedia}`, { redirect: "manual" });
  await mediaAfterWithdrawal.arrayBuffer();
  check(
    mediaAfterWithdrawal.status === 404,
    `the withdrawn derivative returned ${mediaAfterWithdrawal.status}, expected 404`,
  );

  // --- E. The upload path, where parsing is the expensive part -------------

  const imagesBefore = storedObjects(IMAGES_BLOBS);
  const mastersBefore = storedObjects(MASTERS_BLOBS);
  check(
    typeof imagesBefore === "number" && typeof mastersBefore === "number",
    `the local buckets hold ${imagesBefore} images objects and ${mastersBefore} masters objects to compare`,
  );

  for (const [label, headers, expected] of REFUSED_CASES) {
    const response = await postUpload("/admin/upload", uploadFields("CSRF Attack"), headers);
    const body = await response.text();
    check(
      expected.includes(response.status),
      `an upload with ${label} returned ${response.status}, expected ${expected.join(" or ")}`,
    );
    const accepted = /accepted/i.test(body);
    check(accepted === false, `an upload with ${label} reported an accepted upload: ${accepted}`);
    const attackRows = (
      await queryLocalD1("SELECT COUNT(*) AS total FROM photos WHERE title = 'CSRF Attack'")
    )[0]?.total;
    check(attackRows === 0, `an upload with ${label} created ${attackRows} photograph row(s)`);
    const objectsUnchanged =
      storedObjects(IMAGES_BLOBS) === imagesBefore && storedObjects(MASTERS_BLOBS) === mastersBefore;
    check(
      objectsUnchanged,
      `an upload with ${label} left both buckets unchanged: ${objectsUnchanged}`,
    );
  }

  // The positive control: the same request from this site DOES store an object, so
  // "the count did not change" above is evidence rather than an artefact of a scan
  // that never detects anything.
  const controlUpload = await postUpload("/admin/upload", uploadFields("CSRF Probe C"), { origin });
  const controlBody = await controlUpload.text();
  const controlAccepted = /accepted/i.test(controlBody);
  check(
    controlUpload.status === 200 && controlAccepted,
    `the control upload returned ${controlUpload.status} and reported an accepted upload: ${controlAccepted}`,
  );
  const storedNew = storedObjects(IMAGES_BLOBS) - imagesBefore;
  check(
    typeof imagesBefore === "number" && storedNew > 0,
    `the control upload stored ${storedNew} new object(s), so the unchanged counts above are evidence`,
  );
} finally {
  await shutdown();
  restoreWorkerVariables();
}

if (failures.length > 0) {
  console.error(`Operator CSRF check FAILED with ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
console.log(
  "Operator CSRF check passed: the same-origin guard has exactly one definition, every one of the five mutating " +
    "operator actions (photo library, editor, print eligibility, enquiry queue and upload) uses it, and no manager " +
    "route has a write path; for each action an exact same-origin Origin and a same-origin Referer reached normal " +
    "behaviour, while a hostile Origin, a hostile Origin beside a friendly Referer, an opaque `Origin: null`, a " +
    "hostile Referer alone, the absence of both headers and a malformed Referer were all refused with an unchanged " +
    "database and object storage — the framework's own origin check answering 400 for a contradicted Origin and this " +
    "guard answering 403 for the three shapes it lets through; anonymous, unknown, deactivated and forged-role " +
    "identities kept their existing 401/403 refusals; a hostile-origin withdrawal of a real published photograph " +
    "left its row, its page and its exact /media URL untouched while the same-origin withdrawal succeeded and " +
    "stopped both; and a hostile-origin upload created no row and no object in either bucket, while the same upload " +
    "from this site did.",
);
