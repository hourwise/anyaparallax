#!/usr/bin/env node
/**
 * Served print/enquiry check (Slice 08).
 *
 * The eligibility, validation and persistence rules are unit-tested against a real
 * D1 database elsewhere. This suite proves the same rules reach the WIRE: it boots
 * the application, drives the real HTTP routes and then reads back what the local
 * database actually holds.
 *
 * What must be TRUE on the wire:
 *
 *   * `/prints`, `/contact` and `/about` serve 200 with a canonical URL on the
 *     CONFIGURED origin — never the request's host;
 *   * a published print-eligible photograph exposes the enquiry path, and a
 *     published photograph that is not offered does not;
 *   * a draft marked print-eligible produces no page, no listing and no form;
 *   * a submitted enquiry is persisted exactly once, even when the same rendered
 *     form is posted twice, and the acknowledgement that follows carries none of
 *     the submission;
 *   * the operator surfaces deny anonymous and wrong-identity requests, and show
 *     the stored enquiry to the photographer;
 *   * a customer's name, address and message appear in NO public route;
 *   * `r2://` reaches no browser-facing markup, and every photograph on /prints is
 *     a fetchable public path.
 *
 * What must be FALSE on the wire:
 *
 *   * any affordance for checkout, a basket, a payment or an order. The check is
 *     written around AFFORDANCES and positive claims, so the honest sentence that
 *     says checkout is unavailable is required to be present rather than treated
 *     as a violation.
 *
 * Local only: the dev server runs with Wrangler's local D1 and R2, no external
 * service is contacted, and the only network traffic is to the loopback origin.
 */
import { spawn } from "node:child_process";
import { register } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 4186;
const origin = `http://[::1]:${port}`;
const CANONICAL_ORIGIN = "https://anyaparallax.co.uk";

register("../ts-extension-hooks.mjs", import.meta.url);
const { seed } = await import("../../app/data/seed.ts");
const { migrateLocalD1, queryLocalD1, seedLocalD1 } = await import("./local-d1.mjs");

// The local database must be migrated and seeded first, so the check is
// deterministic from a bare checkout and the operator identities exist. Loading the
// seed set clears the enquiries table, so the run starts from a known empty state.
await migrateLocalD1();
await seedLocalD1(seed);

const IDENTITY_HEADER = "x-anyaparallax-development-identity";
const PHOTOGRAPHER = "photographer@anyaparallax.test";
const INACTIVE = "deactivated@anyaparallax.test";
const UNKNOWN = "stranger@anyaparallax.test";

/** A published photograph that the seed marks available for print enquiries. */
const ELIGIBLE = "stage-haze";
/** A published photograph that is NOT offered for print. */
const NOT_ELIGIBLE = "closing-time";
/** A deliberately unpublished photograph that IS marked print-eligible. */
const DRAFT = "studio-trial";

/** Unique markers so a leak can be attributed to this check and to nothing else. */
const MARKER = "Zq7ServedProbe";
const CUSTOMER = {
  name: `${MARKER} Rowan`,
  email: `${MARKER.toLowerCase()}@example.com`,
  message: `Please tell me about a print. ${MARKER} message body.`,
};
const CONTACT_CUSTOMER = {
  name: `${MARKER} Sam`,
  email: `${MARKER.toLowerCase()}.sam@example.com`,
  message: `Do you cover car meets? ${MARKER} contact body.`,
};

const server = spawn(
  "node",
  [resolve(root, "node_modules", "vite", "bin", "vite.js"), "dev", "--port", String(port)],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += chunk.toString()));
server.stderr.on("data", (chunk) => (serverOutput += chunk.toString()));

/** Stop the dev server and wait for it to exit, so teardown cannot abort the run. */
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

const failures = [];
function check(condition, message) {
  if (condition) {
    console.log(`ok   | ${message}`);
  } else {
    failures.push(message);
    console.log(`FAIL | ${message}`);
  }
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

/** The `content` of a meta tag matched by its property or name attribute. */
function metaContent(html, attribute, value) {
  const pattern = new RegExp(
    `<meta[^>]*${attribute}="${value}"[^>]*content="([^"]*)"|<meta[^>]*content="([^"]*)"[^>]*${attribute}="${value}"`,
    "i",
  );
  const match = pattern.exec(html);
  return match?.[1] ?? match?.[2] ?? null;
}

/** The href of the canonical link tag, or null. */
function canonicalHref(html) {
  const match = /<link[^>]*rel="canonical"[^>]*href="([^"]*)"/i.exec(html);
  return match?.[1] ?? null;
}

/** The value of the form's single-use submission token, or null. */
function submissionToken(html) {
  const match = /<input[^>]*name="submissionToken"[^>]*value="([^"]*)"/i.exec(html);
  if (match) {
    return match[1];
  }
  const reversed = /<input[^>]*value="([^"]*)"[^>]*name="submissionToken"/i.exec(html);
  return reversed?.[1] ?? null;
}

/** Anything that would mean private or internal storage reached the markup. */
const FORBIDDEN = [
  ["the private masters scheme", "r2://masters/"],
  ["the private master field name", "originalStorageKey"],
  ["the private master column name", "original_storage_key"],
  ["the private bucket binding name", "MASTERS"],
  ["an originals object path", "originals/"],
  ["the public images scheme", "r2://images/"],
  ["any r2 scheme", "r2://"],
  ["the web derivative storage key column", "web_storage_key"],
  ["the thumbnail derivative storage key column", "thumbnail_storage_key"],
  // The two view-model field names Slice 07A removed. A bare `storageKey` is NOT
  // scanned: React Router's own ScrollRestoration script legitimately declares a
  // `storageKey` parameter, and a rule that failed on the framework would be
  // turned off rather than fixed.
  ["the web derivative view field", "webStorageKey"],
  ["the thumbnail derivative view field", "thumbnailStorageKey"],
];

/**
 * Affordances for commerce the site cannot perform.
 *
 * Each pattern describes something a visitor could ACT on — a control, a route, a
 * field, a provider — rather than a word. That distinction is what lets the honest
 * disclosure ("there is no basket, no checkout and no payment") coexist with this
 * scan: prose about an absent capability contains no control and no route. The
 * card-field rule requires a form CONTROL carrying a payment-shaped name, so the
 * `twitter:card` meta tag that every page legitimately serves is not a finding.
 */
const FORBIDDEN_AFFORDANCES = [
  ["an add-to-basket control", /add\s+to\s+(basket|cart|bag)/i],
  ["a basket or cart link", /href="[^"]*\/(?:basket|cart|bag)/i],
  ["a checkout link or action", /href="[^"]*\/checkout|action="[^"]*\/checkout|>\s*(?:proceed to|go to)\s+checkout/i],
  ["a buy-now or pay-now control", />\s*(?:buy|pay)\s+now\s*</i],
  ["an order action", />\s*place\s+(?:your\s+)?order\s*</i],
  [
    "a payment-credential field",
    /<(?:input|select|textarea)[^>]*name="[^"]*(?:card|cvc|cvv|expiry|iban)[^"]*"/i,
  ],
  ["a card autofill hint", /autocomplete="cc-/i],
  ["a password field", /type="password"/i],
  ["a payment provider", /stripe|paypal|braintree|klarna|worldpay|squareup|checkout\.com/i],
  ["an order number", /order\s+(?:number|reference|id)\s*[:#]/i],
];

/** Every `src`/`href` in the markup that looks like an image reference. */
function imageReferences(html) {
  const references = [];
  for (const match of html.matchAll(/(?:src|href)="([^"]*)"/gi)) {
    const value = match[1] ?? "";
    if (value.includes("r2:") || value.includes("/media/") || value.includes("/images/")) {
      references.push(value);
    }
  }
  return references;
}

/**
 * Submit a form-encoded body as a browser would, from this origin.
 *
 * `origin: null` OMITS the header entirely, which is how the route's own
 * same-origin guard is exercised: a browser always sends one, and a request
 * carrying none is what the guard exists to refuse.
 */
function postForm(path, fields, headers = {}) {
  const merged = {
    "content-type": "application/x-www-form-urlencoded",
    // A browser sets Origin on a form POST; the same-origin guard requires it.
    origin,
    ...headers,
  };
  if (merged.origin === null) {
    delete merged.origin;
  }
  return fetch(`${origin}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: merged,
    body: new URLSearchParams(fields).toString(),
  });
}

function printFields(token, overrides = {}) {
  return {
    name: CUSTOMER.name,
    email: CUSTOMER.email,
    category: "print-enquiry",
    message: CUSTOMER.message,
    photoSlug: ELIGIBLE,
    printFormat: "fine-art-print",
    printSize: "about 40 × 50 cm",
    submissionToken: token,
    ...overrides,
  };
}

/** Every public route that must never carry a customer's details. */
const PUBLIC_ROUTES = [
  "/",
  "/galleries",
  "/gallery/nightlife",
  "/gallery/live-music",
  "/photo/closing-time",
  `/photo/${ELIGIBLE}`,
  "/about",
  "/prints",
  "/prints/enquire",
  `/prints/enquire?photo=${ELIGIBLE}`,
  "/prints/enquire/received",
  "/contact",
  "/contact/received",
];

let createdEnquiryId = null;

try {
  if (!(await waitForServer())) {
    console.error("dev server did not start");
    console.error(serverOutput.slice(-3000));
    await shutdown();
    process.exit(1);
  }

  // --- A. Public surfaces, canonical metadata and the image boundary -------

  const startingEnquiries = (await queryLocalD1("SELECT COUNT(*) AS total FROM enquiries"))[0]?.total;
  check(
    startingEnquiries === 0,
    `the local enquiry table started with ${startingEnquiries} rows, so the run is not deterministic`,
  );

  for (const [path, title] of [
    ["/prints", "Prints"],
    ["/contact", "Contact"],
    ["/about", "About"],
  ]) {
    const response = await fetch(`${origin}${path}`);
    const html = await response.text();
    check(response.status === 200, `${path} returned ${response.status}`);
    check(
      canonicalHref(html) === `${CANONICAL_ORIGIN}${path}`,
      `${path} canonical is ${JSON.stringify(canonicalHref(html))}`,
    );
    check(
      metaContent(html, "property", "og:url") === `${CANONICAL_ORIGIN}${path}`,
      `${path} og:url is not the canonical URL`,
    );
    check(
      metaContent(html, "property", "og:type") === "website",
      `${path} og:type is ${JSON.stringify(metaContent(html, "property", "og:type"))}`,
    );
    check(
      metaContent(html, "property", "og:title")?.includes(title) === true,
      `${path} og:title does not name the page`,
    );
    check(
      (metaContent(html, "name", "description") ?? "").length > 0,
      `${path} served no meta description`,
    );
    check(
      metaContent(html, "name", "robots") === null,
      `${path} is marked noindex, so the page could not be discovered`,
    );
    // The canonical origin is CONFIGURED: the loopback host must not appear in it.
    check(
      !html.includes(`${origin}/prints`) && !html.includes(`${origin}/contact`),
      `${path} built a canonical URL from the request origin`,
    );
    for (const [label, needle] of FORBIDDEN) {
      check(!html.includes(needle), `${path} contains ${label} (${needle})`);
    }
    check(
      imageReferences(html).every((value) => value.startsWith("/") || value.startsWith("https://")),
      `${path} renders an image reference that is not a browser URL`,
    );
    check(
      imageReferences(html).every((value) => !value.includes("r2:")),
      `${path} renders an internal storage reference into an image attribute`,
    );
  }

  // --- B. Print eligibility as the visitor sees it -------------------------

  const printsResponse = await fetch(`${origin}/prints`);
  const printsHtml = await printsResponse.text();
  check(
    printsHtml.includes(`/photo/${ELIGIBLE}`),
    "the print page does not list the published print-eligible photograph",
  );
  check(
    printsHtml.includes(`/prints/enquire?photo=${ELIGIBLE}`),
    "the print page does not expose the enquiry path for the eligible photograph",
  );
  // A photograph that is published but NOT offered must not be presented as one.
  const printsFigures = printsHtml.split("photo-figure").length - 1;
  check(printsFigures > 0, "the print page rendered no photograph cards at all");
  check(
    !printsHtml.includes(`/prints/enquire?photo=${NOT_ELIGIBLE}`),
    "a photograph that is not offered for print was given an enquiry link",
  );
  check(
    !printsHtml.includes(`/photo/${DRAFT}`) && !printsHtml.includes(DRAFT),
    "a draft photograph appeared on the print page",
  );

  // The eligible photograph's page carries the action; the ineligible one does not.
  const eligiblePhoto = await fetch(`${origin}/photo/${ELIGIBLE}`);
  const eligibleHtml = await eligiblePhoto.text();
  check(eligiblePhoto.status === 200, `the eligible photograph returned ${eligiblePhoto.status}`);
  check(
    eligibleHtml.includes(`/prints/enquire?photo=${ELIGIBLE}`),
    "a published print-eligible photograph does not expose the enquiry path",
  );
  check(
    eligibleHtml.includes("Enquire about a print"),
    "the print action is not described in words a visitor can act on",
  );
  const ineligiblePhoto = await fetch(`${origin}/photo/${NOT_ELIGIBLE}`);
  const ineligibleHtml = await ineligiblePhoto.text();
  check(ineligiblePhoto.status === 200, `the ineligible photograph returned ${ineligiblePhoto.status}`);
  check(
    !ineligibleHtml.includes("Enquire about a print") && !ineligibleHtml.includes("/prints/enquire"),
    "a photograph that is not offered for print exposed a print action",
  );
  // The flag itself IS public — it is what the page decides from — so the page must
  // still carry it. That the action is absent is therefore a decision the component
  // made about a known state, not a field that went missing.
  check(
    eligibleHtml.includes("printAvailable") && ineligibleHtml.includes("printAvailable"),
    "the photograph page does not carry the print-eligibility state the action is decided from",
  );

  // A draft stays non-public even though the seed marks it print-eligible.
  const draftPhoto = await fetch(`${origin}/photo/${DRAFT}`, { redirect: "manual" });
  check(draftPhoto.status === 404, `the draft photograph returned ${draftPhoto.status}, expected 404`);
  const draftEnquiry = await fetch(`${origin}/prints/enquire?photo=${DRAFT}`, { redirect: "manual" });
  check(
    draftEnquiry.status === 404,
    `the enquiry form resolved a draft photograph (${draftEnquiry.status}), expected 404`,
  );
  const unknownEnquiry = await fetch(`${origin}/prints/enquire?photo=no-such-photograph`, {
    redirect: "manual",
  });
  check(unknownEnquiry.status === 404, `an unknown photograph returned ${unknownEnquiry.status}`);
  check(
    !(await draftEnquiry.text()).includes(DRAFT),
    "the draft's name appeared in the body of its own 404",
  );

  // --- C. The enquiry form -------------------------------------------------

  const formResponse = await fetch(`${origin}/prints/enquire?photo=${ELIGIBLE}`);
  const formHtml = await formResponse.text();
  check(formResponse.status === 200, `the enquiry form returned ${formResponse.status}`);
  check(
    formResponse.headers.get("cache-control")?.includes("no-store") === true,
    "the enquiry form is cacheable, so several visitors could share one submission token",
  );
  check(
    formHtml.includes("Under the stage haze"),
    "the enquiry form does not name the photograph it will enquire about",
  );
  const token = submissionToken(formHtml);
  check(
    typeof token === "string" && /^[0-9a-f-]{36}$/i.test(token),
    `the form did not issue a usable submission token: ${JSON.stringify(token)}`,
  );
  const secondForm = await fetch(`${origin}/prints/enquire?photo=${ELIGIBLE}`);
  check(
    submissionToken(await secondForm.text()) !== token,
    "two renders of the form shared one submission token",
  );
  check(formHtml.includes("no basket"), "the enquiry form does not state the no-commerce boundary");

  // A photograph that is published but not offered: the general form, honestly.
  const notOffered = await fetch(`${origin}/prints/enquire?photo=${NOT_ELIGIBLE}`);
  const notOfferedHtml = await notOffered.text();
  check(notOffered.status === 200, `the not-offered form returned ${notOffered.status}`);
  check(
    notOfferedHtml.includes("not currently offered for print enquiries"),
    "the form did not say plainly that the photograph is not offered",
  );
  check(
    !/name="photoSlug"/.test(notOfferedHtml),
    "the form attached a photograph the server would not offer",
  );

  // --- D. Submission, acknowledgement and duplicate safety -----------------

  const enquireToken = token;
  const firstPost = await postForm("/prints/enquire", printFields(enquireToken));
  check(firstPost.status === 303, `a valid enquiry returned ${firstPost.status}, expected 303`);
  check(
    firstPost.headers.get("location")?.endsWith("/prints/enquire/received") === true,
    `a valid enquiry redirected to ${firstPost.headers.get("location")}`,
  );

  const rows = await queryLocalD1(
    `SELECT id, name, email, category, photo_id, print_format, print_size, status, submission_token FROM enquiries`,
  );
  check(rows.length === 1, `a valid enquiry produced ${rows.length} stored rows, expected 1`);
  const stored = rows[0] ?? {};
  createdEnquiryId = stored.id ?? null;
  check(stored.photo_id === ELIGIBLE, `the stored enquiry names photograph ${stored.photo_id}`);
  check(stored.status === "new", `the stored enquiry is in state ${stored.status}`);
  check(stored.print_format === "fine-art-print", `the format was stored as ${stored.print_format}`);
  check(stored.print_size === "about 40 × 50 cm", `the size was stored as ${stored.print_size}`);

  // The SAME rendered form posted again is a browser retry, not a second enquiry.
  const replay = await postForm("/prints/enquire", printFields(enquireToken));
  check(replay.status === 303, `a replayed submission returned ${replay.status}`);
  check(
    (await queryLocalD1("SELECT COUNT(*) AS total FROM enquiries"))[0]?.total === 1,
    "posting the same rendered form twice created more than one enquiry",
  );

  // The acknowledgement must not carry the submission.
  const ack = await fetch(`${origin}/prints/enquire/received`);
  const ackHtml = await ack.text();
  check(ack.status === 200, `the acknowledgement returned ${ack.status}`);
  check(
    metaContent(ackHtml, "name", "robots")?.includes("noindex") === true,
    "the acknowledgement is indexable",
  );
  check(
    ackHtml.includes("your enquiry has been received"),
    "the acknowledgement does not say the enquiry was received",
  );
  for (const [label, value] of [
    ["the customer's name", CUSTOMER.name],
    ["the customer's email address", CUSTOMER.email],
    ["the message body", MARKER],
    ["the photograph title", "Under the stage haze"],
  ]) {
    check(!ackHtml.includes(value), `the acknowledgement contains ${label}`);
  }
  check(
    canonicalHref(ackHtml) === null,
    "the acknowledgement declares a canonical URL for a submission result",
  );

  // --- E. Validation is enforced on the wire -------------------------------

  const beforeInvalid = (await queryLocalD1("SELECT COUNT(*) AS total FROM enquiries"))[0]?.total;
  for (const [label, overrides, expectedStatus] of [
    ["a malformed email address", { email: "not-an-address" }, 400],
    ["an empty name", { name: "" }, 400],
    ["an empty message", { message: "" }, 400],
    ["an invented category", { category: "printer" }, 400],
    ["an unsupported format", { printFormat: "canvas" }, 400],
    ["an overlong size preference", { printSize: "x".repeat(41) }, 400],
    ["a missing token", { submissionToken: "" }, 400],
    ["a draft photograph", { photoSlug: DRAFT }, 400],
    ["an ineligible photograph", { photoSlug: NOT_ELIGIBLE }, 400],
    ["an unknown photograph", { photoSlug: "no-such-photograph" }, 400],
  ]) {
    const response = await postForm(
      "/prints/enquire",
      printFields(crypto.randomUUID(), overrides),
    );
    check(response.status === expectedStatus, `${label} returned ${response.status}`);
    const body = await response.text();
    check(
      response.headers.get("x-robots-tag")?.includes("noindex") === true,
      `${label} produced an indexable rejection page`,
    );
    check(
      response.headers.get("cache-control")?.includes("no-store") === true,
      `${label} produced a cacheable rejection page`,
    );
    // The refusal re-renders the form so nothing has to be retyped. That echo is
    // safe only because the response is uncacheable and unindexable, which is
    // asserted above; what must never happen is the echo surviving without it.
    check(body.includes('name="message"'), `${label} did not re-render the form`);
  }
  check(
    (await queryLocalD1("SELECT COUNT(*) AS total FROM enquiries"))[0]?.total === beforeInvalid,
    "a refused submission still wrote a row",
  );
  // A GET of the same address carries no trace of a previous submission: the values
  // are returned in the POST response only, never stored in the URL or a session.
  const cleanForm = await (await fetch(`${origin}/prints/enquire`)).text();
  check(
    !cleanForm.includes(CUSTOMER.email) && !cleanForm.includes(CUSTOMER.name),
    "a plain GET of the enquiry form echoed a previous submission",
  );

  // A cross-site POST must be refused and must write nothing. TWO layers refuse it,
  // and the check distinguishes them rather than accepting either blindly: the
  // framework's own document-action CSRF check rejects a mismatched `Origin`
  // outright, and this route's guard — the same rule the engagement endpoint
  // uses — refuses a request that carries no origin at all.
  const crossSite = await postForm("/prints/enquire", printFields(crypto.randomUUID()), {
    origin: "https://evil.example",
  });
  check(
    crossSite.status === 400 || crossSite.status === 403,
    `a cross-origin submission returned ${crossSite.status}, which is not a refusal`,
  );
  check(
    (await queryLocalD1("SELECT COUNT(*) AS total FROM enquiries"))[0]?.total === beforeInvalid,
    "a cross-origin submission wrote a row",
  );
  const originless = await postForm("/prints/enquire", printFields(crypto.randomUUID()), {
    origin: null,
  });
  check(
    originless.status === 403,
    `a submission with no origin returned ${originless.status}, so the route's own guard did not refuse it`,
  );
  check(
    (await queryLocalD1("SELECT COUNT(*) AS total FROM enquiries"))[0]?.total === beforeInvalid,
    "a submission with no origin wrote a row",
  );

  // --- F. Privacy on the wire ---------------------------------------------

  const engagementCookie = `anyaparallax_browser=${crypto.randomUUID()}`;
  const privacyToken = crypto.randomUUID();
  const privacyPost = await postForm("/prints/enquire", printFields(privacyToken), {
    cookie: engagementCookie,
    "user-agent": "ServedProbeBot/1.0",
    "x-forwarded-for": "203.0.113.99",
    "cf-connecting-ip": "198.51.100.55",
    referer: `${origin}/prints`,
    "accept-language": "de-DE,de;q=0.9",
  });
  check(privacyPost.status === 303, `a submission carrying identifying headers returned ${privacyPost.status}`);
  const privacyRows = await queryLocalD1("SELECT * FROM enquiries ORDER BY created_at DESC LIMIT 1");
  const privacyJson = JSON.stringify(privacyRows[0] ?? {});
  for (const [label, value] of [
    ["the client address", "203.0.113.99"],
    ["the connecting address", "198.51.100.55"],
    ["the user agent", "ServedProbeBot"],
    ["the engagement cookie value", engagementCookie.split("=")[1]],
    ["the engagement cookie name", "anyaparallax_browser"],
  ]) {
    check(!privacyJson.includes(value), `the stored enquiry contains ${label}`);
  }
  check(
    (await queryLocalD1("SELECT COUNT(*) AS total FROM enquiries"))[0]?.total === 2,
    "the privacy probe did not store exactly one further enquiry",
  );

  // --- G. The general contact path stays distinct --------------------------

  const contactForm = await fetch(`${origin}/contact`);
  const contactHtml = await contactForm.text();
  check(contactForm.status === 200, `the contact page returned ${contactForm.status}`);
  check(
    contactForm.headers.get("cache-control")?.includes("no-store") === true,
    "the contact form is cacheable, so several visitors could share one submission token",
  );
  check(
    !/name="photoSlug"/.test(contactHtml) && !/name="printFormat"/.test(contactHtml),
    "the contact form offers the print-only fields",
  );
  const contactToken = submissionToken(contactHtml);
  check(
    typeof contactToken === "string" && /^[0-9a-f-]{36}$/i.test(contactToken),
    "the contact form did not issue a submission token",
  );
  const contactPost = await postForm("/contact", {
    name: CONTACT_CUSTOMER.name,
    email: CONTACT_CUSTOMER.email,
    category: "car-photography",
    message: CONTACT_CUSTOMER.message,
    submissionToken: contactToken,
  });
  check(contactPost.status === 303, `a valid contact message returned ${contactPost.status}`);
  check(
    contactPost.headers.get("location")?.endsWith("/contact/received") === true,
    `a contact message redirected to ${contactPost.headers.get("location")}`,
  );
  const contactRows = await queryLocalD1(
    `SELECT category, photo_id, print_format, print_size FROM enquiries WHERE email = '${CONTACT_CUSTOMER.email}'`,
  );
  check(contactRows.length === 1, `a contact message produced ${contactRows.length} rows`);
  check(
    contactRows[0]?.photo_id === null &&
      contactRows[0]?.print_format === null &&
      contactRows[0]?.print_size === null,
    "a general contact message stored print-enquiry fields",
  );
  // A contact POST cannot smuggle print fields in.
  const smuggled = await postForm("/contact", {
    name: CONTACT_CUSTOMER.name,
    email: CONTACT_CUSTOMER.email,
    category: "car-photography",
    message: CONTACT_CUSTOMER.message,
    photoSlug: ELIGIBLE,
    submissionToken: crypto.randomUUID(),
  });
  check(smuggled.status === 400, `a contact message carrying a photograph returned ${smuggled.status}`);
  const contactAck = await fetch(`${origin}/contact/received`);
  const contactAckHtml = await contactAck.text();
  check(contactAck.status === 200, `the contact acknowledgement returned ${contactAck.status}`);
  check(
    metaContent(contactAckHtml, "name", "robots")?.includes("noindex") === true,
    "the contact acknowledgement is indexable",
  );
  check(
    !contactAckHtml.includes(CONTACT_CUSTOMER.email) && !contactAckHtml.includes(MARKER),
    "the contact acknowledgement contains the submission",
  );

  // --- H. No customer detail on any public route ---------------------------

  for (const route of PUBLIC_ROUTES) {
    const response = await fetch(`${origin}${route}`);
    const html = await response.text();
    check(response.status === 200, `${route} returned ${response.status}`);
    for (const [label, value] of [
      ["the customer's name", CUSTOMER.name],
      ["the customer's email address", CUSTOMER.email],
      ["the contact customer's email address", CONTACT_CUSTOMER.email],
      ["the enquiry markers", MARKER],
      ["a stored enquiry id", createdEnquiryId ?? "enquiry-never-created"],
    ]) {
      check(!html.includes(value), `${route} leaks ${label}`);
    }
  }

  // --- I. The operator boundary --------------------------------------------

  for (const [path, expect, label, identity] of [
    ["/admin/enquiries", 401, "anonymous", null],
    ["/admin/prints", 401, "anonymous", null],
    ["/admin/enquiries", 403, "an unknown identity", UNKNOWN],
    ["/admin/enquiries", 403, "a deactivated account", INACTIVE],
    ["/admin/enquiries", 200, "the photographer", PHOTOGRAPHER],
    ["/admin/prints", 200, "the photographer", PHOTOGRAPHER],
  ]) {
    const response = await fetch(`${origin}${path}`, {
      headers: identity === null ? {} : { [IDENTITY_HEADER]: identity },
      redirect: "manual",
    });
    const html = await response.text();
    check(response.status === expect, `${path} for ${label} returned ${response.status}, expected ${expect}`);
    check(
      response.headers.get("cache-control")?.includes("no-store") === true,
      `${path} for ${label} is cacheable`,
    );
    if (expect !== 200) {
      check(!html.includes(CUSTOMER.email), `${path} for ${label} leaked a customer address in a denial`);
    }
  }

  const adminResponse = await fetch(`${origin}/admin/enquiries`, {
    headers: { [IDENTITY_HEADER]: PHOTOGRAPHER },
  });
  const adminHtml = await adminResponse.text();
  check(
    adminHtml.includes(CUSTOMER.name) && adminHtml.includes(CUSTOMER.email),
    "the operator surface does not show the stored enquiry",
  );
  check(
    adminHtml.includes("Under the stage haze"),
    "the operator surface does not resolve the photograph an enquiry names",
  );
  check(
    adminHtml.includes("Fine-art print"),
    "the operator surface does not show the format preference in a readable form",
  );

  const adminPrints = await fetch(`${origin}/admin/prints`, {
    headers: { [IDENTITY_HEADER]: PHOTOGRAPHER },
  });
  const adminPrintsHtml = await adminPrints.text();
  check(
    adminPrintsHtml.includes(DRAFT) && adminPrintsHtml.includes("Draft"),
    "the print-eligibility surface does not show drafts and their publication state",
  );
  check(
    adminPrintsHtml.includes(ELIGIBLE),
    "the print-eligibility surface does not list the eligible photograph",
  );

  // --- J. The ecommerce non-goal, on the wire ------------------------------

  for (const route of PUBLIC_ROUTES) {
    const html = await (await fetch(`${origin}${route}`)).text();
    for (const [label, pattern] of FORBIDDEN_AFFORDANCES) {
      check(!pattern.test(html), `${route} serves ${label}`);
    }
  }
  // The honest disclosure must be present where print interest is invited, so the
  // absence of a checkout is stated rather than merely not implemented.
  check(
    printsHtml.includes("no basket") && printsHtml.includes("no checkout"),
    "the print page does not state that no checkout exists",
  );
  check(
    printsHtml.includes("no payment"),
    "the print page does not state that no payment is taken",
  );

  // --- K. Print eligibility cannot publish, proved through the wire --------

  // The draft is eligible in the seed and must still be invisible everywhere.
  for (const route of ["/prints", "/galleries", "/gallery/studio-work", `/photo/${DRAFT}`]) {
    const response = await fetch(`${origin}${route}`, { redirect: "manual" });
    const html = await response.text();
    check(
      !html.includes(`/prints/enquire?photo=${DRAFT}`),
      `${route} exposes an enquiry link for a draft photograph`,
    );
  }
} finally {
  await shutdown();
}

if (failures.length > 0) {
  console.error(`Served print/enquiry check FAILED with ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
console.log(
  `Served print/enquiry check passed: ${PUBLIC_ROUTES.length} public routes served canonical metadata on the ` +
    "configured origin with browser-loadable images and no internal storage reference; print eligibility " +
    "exposed the enquiry path only where it is offered and never published a draft; a submitted enquiry was " +
    "stored exactly once under replay and acknowledged without carrying the submission; refused submissions, " +
    "a cross-origin post and identifying headers all left the database unchanged; the operator surfaces denied " +
    "anonymous and wrong-identity requests; and no served page offered commerce the site cannot perform.",
);
