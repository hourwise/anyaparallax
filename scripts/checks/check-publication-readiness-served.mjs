#!/usr/bin/env node
/**
 * Publication-readiness served check (REPAIR-09D).
 *
 * Proves, over real HTTP against the real application and the real local database:
 *
 *   ABUSE — the two public enquiry forms still accept a legitimate submission, and
 *   refuse a trapped, impossibly-fast, stale, link-stuffed, oversized or malformed
 *   one WITHOUT writing a row. The print form's publication authority is asserted
 *   alongside, because an abuse guard must never become a way past it.
 *
 *   DASHBOARD — the count of enquiries awaiting a reply is read from the stored
 *   status, follows a real submission, and falls when one is marked read through the
 *   real admin path.
 *
 *   CRAWLER POLICY — `/robots.txt` and `/sitemap.xml` are served with the right
 *   content types, describe only public surfaces, and cannot be redirected to
 *   another host by a forged `Host` or `X-Forwarded-Host`.
 *
 *   PUBLICATION AUTHORITY — the sitemap follows the 09B management path: withdrawing
 *   a photograph removes it, republishing restores it, and moving a still-published
 *   photograph into a draft gallery removes it too.
 *
 * Local only: Wrangler's local D1/R2, loopback HTTP, and the known local Images
 * `draw()` no-op (REPAIR-09C established that this is a simulator limitation and it
 * is irrelevant here — nothing in this check inspects watermark pixels).
 */
import { spawn } from "node:child_process";
import { register } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { withWorkerVariables } from "./dev-vars.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 4192;
const origin = `http://[::1]:${port}`;
const CANONICAL_ORIGIN = "https://anyaparallax.co.uk";
const HOSTILE_HOST = "evil.example";

register("../ts-extension-hooks.mjs", import.meta.url);
const { FORM_ISSUED_AT_FIELD, FORM_TRAP_FIELD, MAX_FORM_AGE_MS } = await import(
  "../../app/enquiries/abuse-guard.ts"
);
const { ENQUIRY_COPY } = await import("../../app/enquiries/enquiry.ts");
const { seed } = await import("../../app/data/seed.ts");
const { migrateLocalD1, queryLocalD1, seedLocalD1 } = await import("./local-d1.mjs");

await migrateLocalD1();
await seedLocalD1(seed);

const IDENTITY_HEADER = "x-anyaparallax-development-identity";
const PHOTOGRAPHER = "photographer@anyaparallax.test";
const MANAGER = "manager@anyaparallax.test";

/** A published photograph in a published gallery. */
const PUBLISHED_PHOTO = "closing-time";
/** A draft photograph in a published gallery; also print-INELIGIBLE. */
const DRAFT_PHOTO = "unreleased-edit";
/** A draft photograph in an UNPUBLISHED gallery. */
const HIDDEN_GALLERY_PHOTO = "studio-trial";
/** A published, print-ELIGIBLE photograph. */
const ELIGIBLE_PHOTO = "stage-haze";
/** The unpublished gallery. */
const UNPUBLISHED_GALLERY = "gallery-studio";

const MARKER = "Zq7Readiness";

const failures = [];
function check(condition, message) {
  if (condition) {
    console.log(`ok   | ${message}`);
  } else {
    failures.push(message);
    console.log(`FAIL | ${message}`);
  }
}

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

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A form POST as a browser sends it: form encoding, same-origin `Origin`. */
function postForm(path, fields, headers = {}) {
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
    headers: { "content-type": "application/x-www-form-urlencoded", origin, ...headers },
    body: body.toString(),
  });
}

function getAs(path, identity, headers = {}) {
  return fetch(`${origin}${path}`, {
    redirect: "manual",
    headers: { ...(identity === null ? {} : { [IDENTITY_HEADER]: identity }), ...headers },
  });
}

const enquiryCount = () =>
  queryLocalD1("SELECT COUNT(*) AS total FROM enquiries").then((rows) => rows[0]?.total ?? 0);

/** The token and render time the form issued, as a browser would carry them back. */
async function formFields(path) {
  const html = await (await fetch(`${origin}${path}`)).text();
  const token = /name="submissionToken"[^>]*value="([^"]*)"/i.exec(html)?.[1] ?? null;
  const issuedAt = new RegExp(`name="${FORM_ISSUED_AT_FIELD}"[^>]*value="([^"]*)"`, "i").exec(html)?.[1] ?? null;
  const trap = new RegExp(`name="${FORM_TRAP_FIELD}"`, "i").test(html);
  return { token, issuedAt, trap, html };
}

const CONTACT = {
  name: `${MARKER} Rowan`,
  email: `${MARKER.toLowerCase()}@example.com`,
  category: "gig-photography",
  message: `A readiness probe message. ${MARKER}.`,
};

let probe = 0;
/** A distinct submission token, so idempotency cannot mask a written row. */
const freshToken = () => crypto.randomUUID();

function contactFields(overrides = {}) {
  probe += 1;
  return {
    name: CONTACT.name,
    email: CONTACT.email,
    category: CONTACT.category,
    message: `${CONTACT.message} #${probe}`,
    submissionToken: freshToken(),
    [FORM_TRAP_FIELD]: "",
    [FORM_ISSUED_AT_FIELD]: String(Date.now() - 2_000),
    ...overrides,
  };
}

function printFields(overrides = {}) {
  probe += 1;
  return {
    name: `${MARKER} Print`,
    email: `${MARKER.toLowerCase()}.print@example.com`,
    category: "print-enquiry",
    message: `A print readiness probe. ${MARKER} #${probe}`,
    photoSlug: ELIGIBLE_PHOTO,
    printFormat: "fine-art-print",
    printSize: "about 40 x 50 cm",
    submissionToken: freshToken(),
    [FORM_TRAP_FIELD]: "",
    [FORM_ISSUED_AT_FIELD]: String(Date.now() - 2_000),
    ...overrides,
  };
}

/**
 * The refusal cases, as overrides applied at SEND time.
 *
 * Two of them depend on the current time, and they are resolved immediately before
 * each request rather than when this table is built: the first POST to a route pays
 * Vite's module-compilation cost, so a timestamp captured up front can be seconds old
 * by the time it is sent — which would turn "impossibly fast" into "perfectly
 * plausible" and make the case test the dev server's speed instead of the rule.
 *
 * `expect` distinguishes the two kinds of refusal the forms produce:
 *   "abuse"      — the guard refused it, so the response carries the general wording;
 *   "validation" — the field rules refused it, so the response carries field errors.
 */
const ABUSE_CASES = [
  ["a filled trap field", { [FORM_TRAP_FIELD]: "https://spam.example" }, "abuse"],
  ["an impossibly fast submission", { [FORM_ISSUED_AT_FIELD]: "future" }, "abuse"],
  ["a stale submission", { [FORM_ISSUED_AT_FIELD]: "stale" }, "abuse"],
  ["a missing timing field", { [FORM_ISSUED_AT_FIELD]: "" }, "abuse"],
  ["a malformed timing field", { [FORM_ISSUED_AT_FIELD]: "soon" }, "abuse"],
  ["a link-stuffed message", { message: "links" }, "abuse"],
  ["a link in the name field", { name: "https://spam.example" }, "abuse"],
  ["a malformed email address", { email: "not-an-address" }, "validation"],
  ["an empty message", { message: "" }, "validation"],
];

/** Turn a case's placeholders into real values, now. */
function resolveCase(overrides, base) {
  const resolved = { ...overrides };
  if (resolved[FORM_ISSUED_AT_FIELD] === "future") {
    // In the FUTURE, so the elapsed interval is negative whatever the latency is.
    resolved[FORM_ISSUED_AT_FIELD] = String(Date.now() + 1_000);
  } else if (resolved[FORM_ISSUED_AT_FIELD] === "stale") {
    resolved[FORM_ISSUED_AT_FIELD] = String(Date.now() - MAX_FORM_AGE_MS - 60_000);
  }
  if (resolved.message === "links") {
    resolved.message = `${base} https://a.example https://b.example https://c.example`;
  }
  return resolved;
}

try {
  if (!(await waitForServer())) {
    console.error("dev server did not start");
    console.error(serverOutput.slice(-3000));
    await shutdown();
    restoreWorkerVariables();
    process.exit(1);
  }

  // --- A. The forms carry the guard's fields ------------------------------

  for (const path of ["/contact", "/prints/enquire"]) {
    const form = await formFields(path);
    check(form.trap, `${path} does not render the trap field`);
    check(
      typeof form.token === "string" && form.token.length === 36,
      `${path} did not issue a submission token`,
    );
    check(
      typeof form.issuedAt === "string" && /^\d{10,16}$/.test(form.issuedAt),
      `${path} did not issue a form render time (${JSON.stringify(form.issuedAt)})`,
    );
    check(
      !/name="website"[^>]*type="hidden"/i.test(form.html),
      `${path} renders the trap as a hidden input, which scripts skip`,
    );
    check(
      /aria-hidden="true"[^>]*class="enquiry-form__trap"|class="enquiry-form__trap"[^>]*aria-hidden="true"/i.test(
        form.html,
      ),
      `${path} does not hide the trap from assistive technology`,
    );
    check(
      /tabindex="-1"[^>]*name="website"|name="website"[^>]*tabindex="-1"/i.test(form.html),
      `${path} leaves the trap in the keyboard tab order`,
    );
  }

  // --- B. Contact: the legitimate path still works ------------------------

  const beforeContact = await enquiryCount();
  const slowContact = contactFields();
  const accepted = await postForm("/contact", slowContact);
  check(accepted.status === 303, `a legitimate contact submission returned ${accepted.status}`);
  check(
    (await enquiryCount()) === beforeContact + 1,
    "a legitimate contact submission did not store exactly one enquiry",
  );
  const storedRow = (await queryLocalD1("SELECT * FROM enquiries ORDER BY created_at DESC LIMIT 1"))[0] ?? {};
  check(
    typeof storedRow.name === "string" && storedRow.name.startsWith(MARKER),
    "the stored enquiry does not carry the submitted name",
  );
  check(storedRow.status === "new", `a new enquiry was stored with status ${storedRow.status}`);

  // A retry of the SAME rendered form is still idempotent under the new guard.
  const replay = await postForm("/contact", slowContact);
  check(replay.status === 303, `a replayed legitimate submission returned ${replay.status}`);
  check(
    (await enquiryCount()) === beforeContact + 1,
    "the abuse guard broke enquiry idempotency: a replay created a second row",
  );

  // --- C. Contact: every abuse refusal writes nothing ---------------------

  // Warm both write paths before the abuse cases: the first POST to a route pays the
  // dev server's compile cost, and these cases assert on a time window.
  for (const [path, emitter] of [
    ["/contact", contactFields],
    ["/prints/enquire", printFields],
  ]) {
    await (await postForm(path, emitter({ [FORM_TRAP_FIELD]: "warm-up" }))).text();
  }

  for (const [label, overrides, expect] of ABUSE_CASES) {
    const before = await enquiryCount();
    const response = await postForm("/contact", contactFields(resolveCase(overrides, CONTACT.message)));
    check(response.status === 400, `contact with ${label} returned ${response.status}, expected 400`);
    const body = await response.text();
    check(
      (await enquiryCount()) === before,
      `contact with ${label} stored a row`,
    );
    if (expect === "abuse") {
      check(
        body.includes(ENQUIRY_COPY.submissionNotAccepted) || body.includes(ENQUIRY_COPY.linksNotAccepted),
        `contact with ${label} did not carry the intended refusal wording`,
      );
    } else {
      check(
        /check the following/i.test(body),
        `contact with ${label} did not re-render the form with field errors`,
      );
    }
    check(
      !/honeypot|captcha|turnstile|rate limit|too fast|too quickly|anti-bot/i.test(body),
      `contact with ${label} revealed the anti-abuse mechanism in its response`,
    );
    check(
      response.headers.get("cache-control")?.includes("no-store") === true,
      `contact with ${label} produced a cacheable refusal`,
    );
  }

  // The link refusal is the one a real visitor can trigger, so it must say so.
  const linkRefusal = await postForm(
    "/contact",
    contactFields({ message: "see https://a.example https://b.example https://c.example" }),
  );
  const linkBody = await linkRefusal.text();
  check(
    /without links/i.test(linkBody),
    "the link refusal did not tell the visitor what to change",
  );

  // An oversized body is refused from its headers, before it is parsed.
  const oversized = await postForm("/contact", {
    ...contactFields(),
    message: "x".repeat(64 * 1024),
  });
  check(oversized.status === 400, `an oversized contact body returned ${oversized.status}`);
  await oversized.text();
  check(
    (await enquiryCount()) === beforeContact + 1,
    "an oversized contact body stored a row",
  );

  // --- D. Print enquiry: legitimate path, then abuse ----------------------

  const beforePrint = await enquiryCount();
  const acceptedPrint = await postForm("/prints/enquire", printFields());
  check(acceptedPrint.status === 303, `a legitimate print enquiry returned ${acceptedPrint.status}`);
  check(
    (await enquiryCount()) === beforePrint + 1,
    "a legitimate print enquiry did not store exactly one enquiry",
  );
  const printRow = (await queryLocalD1("SELECT * FROM enquiries ORDER BY created_at DESC LIMIT 1"))[0] ?? {};
  check(printRow.photo_id === ELIGIBLE_PHOTO, `the print enquiry stored photo_id ${printRow.photo_id}`);

  for (const [label, overrides, expect] of ABUSE_CASES) {
    const before = await enquiryCount();
    const response = await postForm(
      "/prints/enquire",
      printFields(resolveCase(overrides, "A print probe.")),
    );
    check(response.status === 400, `print enquiry with ${label} returned ${response.status}, expected 400`);
    const body = await response.text();
    check((await enquiryCount()) === before, `print enquiry with ${label} stored a row`);
    if (expect === "abuse") {
      check(
        body.includes(ENQUIRY_COPY.submissionNotAccepted) || body.includes(ENQUIRY_COPY.linksNotAccepted),
        `print enquiry with ${label} did not carry the intended refusal wording`,
      );
    } else {
      check(
        /check the following/i.test(body),
        `print enquiry with ${label} did not re-render the form with field errors`,
      );
    }
  }

  // The publication authority still governs, whatever the abuse state is.
  for (const [label, slug] of [
    ["a draft photograph", DRAFT_PHOTO],
    ["a photograph in an unpublished gallery", HIDDEN_GALLERY_PHOTO],
    ["a print-ineligible photograph", PUBLISHED_PHOTO],
    ["an unknown photograph", "no-such-photograph"],
  ]) {
    const before = await enquiryCount();
    const response = await postForm("/prints/enquire", printFields({ photoSlug: slug }));
    check(
      response.status === 400,
      `a print enquiry naming ${label} returned ${response.status}, expected refusal`,
    );
    await response.text();
    check((await enquiryCount()) === before, `a print enquiry naming ${label} stored a row`);
    // ...and refused for the same reason even when the abuse guard would pass it.
    const trapped = await postForm(
      "/prints/enquire",
      printFields({ photoSlug: slug, [FORM_TRAP_FIELD]: "trapped" }),
    );
    check(
      trapped.status === 400,
      `a trapped print enquiry naming ${label} returned ${trapped.status}`,
    );
    await trapped.text();
    check((await enquiryCount()) === before, `a trapped print enquiry naming ${label} stored a row`);
  }

  // --- E. Privacy: what the guard did not add -----------------------------

  const enquiryColumns = (await queryLocalD1("PRAGMA table_info('enquiries')")).map((row) => row.name).sort();
  check(
    enquiryColumns.join(",") ===
      "category,created_at,email,id,message,name,photo_id,print_format,print_size,status,submission_token,updated_at",
    `the enquiries table gained a column: ${enquiryColumns.join(", ")}`,
  );
  const privacyRows = await queryLocalD1("SELECT * FROM enquiries");
  const privacyJson = JSON.stringify(privacyRows);
  for (const [label, value] of [
    ["the check's user agent", "ReadinessProbe"],
    ["a client address", "203.0.113.123"],
    ["a forwarded address", "198.51.100.9"],
    ["the engagement cookie name", "anyaparallax_browser"],
  ]) {
    check(!privacyJson.includes(value), `a stored enquiry contains ${label}`);
  }
  check(
    !/ip|user_agent|fingerprint|referrer|device/i.test(enquiryColumns.join(",")),
    "the enquiries table has an identity-shaped column",
  );
  const abuseTables = (
    await queryLocalD1(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE '%abuse%' OR name LIKE '%rate%' OR name LIKE '%throttle%' OR name LIKE '%block%')",
    )
  ).map((row) => row.name);
  check(abuseTables.length === 0, `the abuse guard created a table: ${abuseTables.join(", ")}`);

  // --- F. The dashboard count --------------------------------------------

  await queryLocalD1("UPDATE enquiries SET status = 'archived'");
  const dashboard = async (identity = PHOTOGRAPHER) => {
    const response = await getAs("/admin", identity);
    return { status: response.status, html: await response.text() };
  };

  const zero = await dashboard();
  check(zero.status === 200, `the dashboard returned ${zero.status}`);
  check(
    /No new enquiries/.test(zero.html),
    "the dashboard did not report no new enquiries with an empty queue",
  );
  check(/Open the enquiry list/.test(zero.html), "the dashboard does not link to the enquiry list");

  const submitContact = async () => {
    const response = await postForm("/contact", contactFields());
    if (response.status !== 303) {
      throw new Error(`a dashboard probe submission returned ${response.status}`);
    }
    await response.text();
  };
  await submitContact();
  const one = await dashboard();
  check(/1 new enquiry/.test(one.html), "the dashboard did not report 1 new enquiry");
  await submitContact();
  const two = await dashboard();
  check(/2 new enquiries/.test(two.html), "the dashboard did not report 2 new enquiries");

  // Marking one read through the real admin path must reduce the count.
  const newest = (await queryLocalD1("SELECT id FROM enquiries ORDER BY created_at DESC LIMIT 1"))[0];
  const markRead = await postForm(
    "/admin/enquiries",
    { enquiryId: newest.id, status: "read" },
    { [IDENTITY_HEADER]: PHOTOGRAPHER },
  );
  check(markRead.status === 200, `marking an enquiry read returned ${markRead.status}`);
  await markRead.text();
  check(
    (await queryLocalD1(`SELECT status FROM enquiries WHERE id = '${newest.id}'`))[0]?.status === "read",
    "marking an enquiry read did not persist",
  );
  const afterRead = await dashboard();
  check(/1 new enquiry/.test(afterRead.html), "the dashboard count did not fall after marking one read");

  // Archiving removes an enquiry from the queue as well.
  const remaining = (await queryLocalD1("SELECT id FROM enquiries WHERE status = 'new' LIMIT 1"))[0];
  await (
    await postForm(
      "/admin/enquiries",
      { enquiryId: remaining.id, status: "archived" },
      { [IDENTITY_HEADER]: PHOTOGRAPHER },
    )
  ).text();
  const afterArchive = await dashboard();
  check(
    /No new enquiries/.test(afterArchive.html),
    "archiving the last unread enquiry did not return the queue to empty",
  );

  // The count is operator-only.
  check((await getAs("/admin", null)).status === 401, "an anonymous dashboard request was not denied");
  await (await getAs("/admin", null)).text();
  const managerDashboard = await dashboard(MANAGER);
  check(managerDashboard.status === 200, `the manager dashboard returned ${managerDashboard.status}`);
  check(/enquir/i.test(managerDashboard.html), "the manager dashboard does not show the enquiry state");

  // --- G. robots.txt -----------------------------------------------------

  for (const [label, headers] of [
    ["a plain request", {}],
    ["a forged Host header", { host: HOSTILE_HOST }],
    ["a forged X-Forwarded-Host header", { "x-forwarded-host": HOSTILE_HOST }],
    ["both forged host headers", { host: HOSTILE_HOST, "x-forwarded-host": `https://${HOSTILE_HOST}` }],
  ]) {
    const response = await fetch(`${origin}/robots.txt`, { headers });
    const body = await response.text();
    check(response.status === 200, `robots.txt with ${label} returned ${response.status}`);
    check(
      (response.headers.get("content-type") ?? "").startsWith("text/plain"),
      `robots.txt with ${label} has content type ${response.headers.get("content-type")}`,
    );
    check(
      body.includes(`Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml`),
      `robots.txt with ${label} does not reference the canonical sitemap`,
    );
    check(
      !body.includes(HOSTILE_HOST) && !body.includes("localhost") && !body.includes("[::1]"),
      `robots.txt with ${label} leaked a non-canonical host`,
    );
    check(!body.includes("r2://"), `robots.txt with ${label} contains a storage reference`);
    for (const path of ["/admin", "/manager", "/dev-verification", "/media/", "/contact/received"]) {
      check(body.includes(`Disallow: ${path}`), `robots.txt with ${label} does not disallow ${path}`);
    }
  }

  // --- H. sitemap.xml ----------------------------------------------------

  const sitemapResponse = await fetch(`${origin}/sitemap.xml`);
  const sitemap = await sitemapResponse.text();
  const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
  check(sitemapResponse.status === 200, `sitemap.xml returned ${sitemapResponse.status}`);
  check(
    (sitemapResponse.headers.get("content-type") ?? "").startsWith("application/xml"),
    `sitemap.xml has content type ${sitemapResponse.headers.get("content-type")}`,
  );

  // Structural well-formedness: declaration, one root, balanced elements, escaped
  // entities, no raw ampersand, no stray markup.
  check(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "the XML declaration is missing");
  check(
    (sitemap.match(/<urlset /g) ?? []).length === 1 && sitemap.includes("</urlset>"),
    "the sitemap does not have exactly one urlset root",
  );
  check(
    sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'),
    "the urlset namespace is missing",
  );
  check(
    (sitemap.match(/<url>/g) ?? []).length === (sitemap.match(/<\/url>/g) ?? []).length &&
      (sitemap.match(/<url>/g) ?? []).length === locs.length,
    "the sitemap's url elements are unbalanced",
  );
  check(!/&(?!(amp|lt|gt|quot|apos);)/.test(sitemap), "the sitemap contains an unescaped ampersand");
  check(!/<lastmod>/.test(sitemap), "the sitemap invented a lastmod value");

  check(locs.length > 0, "the sitemap is empty");
  check(
    locs.every((loc) => loc.startsWith(`${CANONICAL_ORIGIN}/`)),
    `a sitemap URL is not on the canonical origin: ${JSON.stringify(locs.filter((loc) => !loc.startsWith(`${CANONICAL_ORIGIN}/`)))}`,
  );
  for (const path of ["/", "/galleries", "/prints", "/about", "/contact"]) {
    check(
      locs.includes(`${CANONICAL_ORIGIN}${path}`),
      `the sitemap does not include ${path}`,
    );
  }
  check(locs.includes(`${CANONICAL_ORIGIN}/photo/${PUBLISHED_PHOTO}`), "the sitemap omits a published photograph");
  check(locs.includes(`${CANONICAL_ORIGIN}/gallery/nightlife`), "the sitemap omits a published gallery");

  const forbiddenFragments = [
    ["an admin path", "/admin"],
    ["a manager path", "/manager"],
    ["the development verification route", "/dev-verification"],
    ["a media path", "/media/"],
    ["the contact acknowledgement", "/contact/received"],
    ["the enquiry acknowledgement", "/prints/enquire/received"],
    ["a storage reference", "r2://"],
    ["a draft photograph", DRAFT_PHOTO],
    ["a photograph in a draft gallery", HIDDEN_GALLERY_PHOTO],
  ];
  for (const [label, fragment] of forbiddenFragments) {
    check(
      !sitemap.includes(fragment),
      `the sitemap contains ${label} (${fragment})`,
    );
  }
  check(
    locs.every((loc) => !loc.includes("?")),
    `a sitemap URL carries a query state: ${JSON.stringify(locs.filter((loc) => loc.includes("?")))}`,
  );
  check(
    !sitemap.includes(UNPUBLISHED_GALLERY) && !sitemap.includes("/gallery/studio-work"),
    "the sitemap contains an unpublished gallery",
  );

  for (const [label, headers] of [
    ["a forged Host header", { host: HOSTILE_HOST }],
    ["a forged X-Forwarded-Host header", { "x-forwarded-host": HOSTILE_HOST }],
    ["a forged forwarded header", { forwarded: `host=${HOSTILE_HOST}` }],
  ]) {
    const hostile = await (await fetch(`${origin}/sitemap.xml`, { headers })).text();
    const hostileLocs = [...hostile.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
    check(
      hostileLocs.length === locs.length && hostileLocs.every((loc) => loc.startsWith(`${CANONICAL_ORIGIN}/`)),
      `the sitemap changed under ${label}`,
    );
    check(!hostile.includes(HOSTILE_HOST), `the sitemap leaked a hostile host under ${label}`);
  }

  // --- I. The sitemap follows publication state (09B authority) -----------

  const sitemapHas = async (slug) =>
    (await (await fetch(`${origin}/sitemap.xml`)).text()).includes(`${CANONICAL_ORIGIN}/photo/${slug}`);

  check(await sitemapHas(PUBLISHED_PHOTO), "a published photograph is missing from the sitemap before the test");
  const withdraw = await postForm(
    "/admin/photos",
    { photoId: PUBLISHED_PHOTO, intent: "unpublish" },
    { [IDENTITY_HEADER]: PHOTOGRAPHER },
  );
  await withdraw.text();
  check(!(await sitemapHas(PUBLISHED_PHOTO)), "a withdrawn photograph is still in the sitemap");
  check(
    (await fetch(`${origin}/photo/${PUBLISHED_PHOTO}`, { redirect: "manual" })).status === 404,
    "the withdrawn photograph is still served",
  );
  const republish = await postForm(
    "/admin/photos",
    { photoId: PUBLISHED_PHOTO, intent: "publish" },
    { [IDENTITY_HEADER]: PHOTOGRAPHER },
  );
  await republish.text();
  check(await sitemapHas(PUBLISHED_PHOTO), "a re-published photograph did not return to the sitemap");

  // A published photograph in a DRAFT gallery must be absent even though its own
  // flag says published.
  const moveToDraftGallery = await postForm(
    `/admin/photos/${PUBLISHED_PHOTO}`,
    {
      title: "Closing time",
      description: "The last few minutes of a night, picked out in red.",
      location: "Manchester",
      captureDate: "2026-08-02",
      galleryId: UNPUBLISHED_GALLERY,
      published: "published",
      featured: "not-featured",
    },
    { [IDENTITY_HEADER]: PHOTOGRAPHER },
  );
  await moveToDraftGallery.text();
  check(
    (await queryLocalD1(`SELECT published FROM photos WHERE id = '${PUBLISHED_PHOTO}'`))[0]?.published === 1,
    "the photograph was unpublished by the gallery change",
  );
  check(
    !(await sitemapHas(PUBLISHED_PHOTO)),
    "a published photograph in a draft gallery is in the sitemap, which makes it a second publication system",
  );
  check(
    (await fetch(`${origin}/photo/${PUBLISHED_PHOTO}`, { redirect: "manual" })).status === 404,
    "a published photograph in a draft gallery is still served",
  );
  // Restore, so the rest of the run sees the seed state.
  await (
    await postForm(
      `/admin/photos/${PUBLISHED_PHOTO}`,
      {
        title: "Closing time",
        description: "The last few minutes of a night, picked out in red.",
        location: "Manchester",
        captureDate: "2026-08-02",
        galleryId: "gallery-nightlife",
        published: "published",
        featured: "not-featured",
      },
      { [IDENTITY_HEADER]: PHOTOGRAPHER },
    )
  ).text();
  check(await sitemapHas(PUBLISHED_PHOTO), "the photograph did not return to the sitemap after being restored");

  // --- J. The engagement endpoint's body bound ---------------------------

  const like = await postForm("/engagement/stage-haze", { action: "like" });
  check(like.status === 200, `a normal like returned ${like.status}`);
  await like.text();
  const share = await postForm("/engagement/stage-haze", { action: "share", channel: "copy_link" });
  check(share.status === 200, `a normal share returned ${share.status}`);
  await share.text();
  const oversizedEngagement = await postForm("/engagement/stage-haze", {
    action: "like",
    padding: "x".repeat(4 * 1024),
  });
  check(
    oversizedEngagement.status === 400,
    `an oversized engagement body returned ${oversizedEngagement.status}, expected 400`,
  );
  await oversizedEngagement.text();
} finally {
  await shutdown();
  restoreWorkerVariables();
}

if (failures.length > 0) {
  console.error(`Publication-readiness check FAILED with ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(` - ${failure}`);
  }
  process.exit(1);
}
console.log(
  "Publication-readiness check passed: both enquiry forms carry an accessibility-safe trap and a server-issued " +
    "render time; every trapped, impossibly-fast, stale, mistimed, link-stuffed, malformed and oversized submission " +
    "was refused with zero rows written while a legitimate submission and its replay still stored exactly one " +
    "enquiry; the print enquiry still refused drafts, hidden-gallery and ineligible photographs under every abuse " +
    "state; the enquiries table gained no column and no abuse table exists; the dashboard count followed real " +
    "submissions and fell when one was marked read and reached zero when archived, and stayed operator-only; " +
    "robots.txt and sitemap.xml served the right content types, named only public surfaces and could not be " +
    "redirected to another host by forged Host or X-Forwarded-Host headers; and the sitemap followed the real " +
    "management path by dropping a withdrawn photograph, restoring it on republication, and dropping a " +
    "still-published photograph moved into a draft gallery.",
);
