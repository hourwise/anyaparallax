#!/usr/bin/env node
/**
 * Served-payload check.
 *
 * Loader data is serialised into the HTML that reaches the browser, so this
 * script inspects real responses from the running application and fails if any
 * page leaks the private archival/print master identifier.
 *
 * Slice 05 extends it to the operator boundary: the protected `/admin` and
 * `/manager` routes are requested with and without a local development
 * identity, and each must return exactly the status its role allows (401
 * anonymous, 403 wrong role, 200 authorised). The local D1 database is
 * migrated and seeded first, so the check is deterministic from a bare
 * checkout — the placeholder operator accounts must exist for the boundary to
 * be exercisable.
 *
 * It runs the Vite development server (the same runtime as production, with
 * local D1/R2 bindings) because loaders need Cloudflare bindings; the
 * production build is still exercised by `pnpm run build` and the other checks.
 *
 * Checks, for every public route:
 * - the field name `originalStorageKey` must not appear
 * - the private masters storage scheme must not appear
 */
import { spawn } from "node:child_process";
import { register } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4174;
/** Match the host the dev server binds to; bracketed IPv6 form is explicit. */
const origin = `http://[::1]:${port}`;

register("./ts-extension-hooks.mjs", import.meta.url);
const { seed } = await import("../app/data/seed.ts");
const { migrateLocalD1, seedLocalD1 } = await import("./checks/local-d1.mjs");
const { withWorkerVariables } = await import("./checks/dev-vars.mjs");

// The operator routes read the authorised-user directory, so the local D1
// database must actually hold the placeholder accounts. Local only: wrangler
// `--local` writes to `.wrangler/state`.
await migrateLocalD1();
await seedLocalD1(seed);

/** Routes that carry photograph or gallery loader data. */
const routes = [
  "/",
  "/galleries",
  "/gallery/nightlife",
  "/gallery/live-music",
  "/gallery/black-white",
  "/photo/closing-time",
  "/photo/stage-haze",
  "/photo/blue-hour",
  // Slice 08: the new public surfaces carry the same photograph projection, so a
  // private-master leak there would be the same defect in a fourth place.
  "/prints",
  "/contact",
  "/about",
  "/prints/enquire",
  "/prints/enquire/received",
  "/contact/received",
];

/** Routes that must not exist publicly, including deliberately unpublished rows. */
const hiddenRoutes = ["/photo/studio-trial", "/photo/unreleased-edit", "/gallery/studio-work"];

/**
 * Public 404s a visitor can reach (REPAIR-09A). The catch-all render is chrome on
 * a public page, so it is held to the same wording rule as every other route.
 */
const notFoundRoutes = ["/no-such-page", "/galleries/no-such-gallery"];

const forbidden = [
  { label: "field name originalStorageKey", value: "originalStorageKey" },
  { label: "private masters storage scheme", value: "r2://masters/" },
];

// --- Development placeholder chrome (REPAIR-09A) --------------------------
//
// The audited finding was that the RUNNING SITE described real photographs and
// the whole site as development placeholders: a literal caption on every card,
// an injected prefix on every alt attribute, and unconditional preview notices in
// the footer and page copy. Those strings are checked on SERVED HTML, because
// every one of them reached the browser through markup and a helper-level test
// could not see it.
//
// WHY THESE PHRASES AND NOT THE WORD "placeholder". The development seed set
// truthfully describes itself as development material — its photograph
// descriptions end with "Development placeholder." — and REPAIR-09A must not be
// satisfied by sanitising that data. So the scan targets CHROME wording that the
// application generates or hard-codes, and never a record's own description:
//
//   * "development placeholder image" is the PhotoFigure caption, which is gone;
//   * the three notice phrases are hard-coded public copy, now gated behind
//     SHOW_DEVELOPMENT_NOTICES, which the served configuration sets to "false";
//   * `photo-figure__credit` is the element that carried the caption, so its
//     absence is asserted directly rather than inferred from the wording.
//
// A production page is therefore allowed to contain a seed record that calls
// itself development data (it is honest about its own provenance) and is not
// allowed to contain a single line of chrome that says so about the site.
const chromeForbidden = [
  [
    "injected development-placeholder alt wording or a caption",
    // The three shapes the application itself generated: the PhotoFigure caption
    // ("Development placeholder image"), the per-photograph alt prefix
    // ("Development placeholder for “X”."), the homepage alt forms
    // ("Development placeholder: …" / "Development placeholder photograph — …")
    // and the gallery-cover template ("… for the X cover photograph."). A seed
    // record's own sentence ends at "Development placeholder." and matches none
    // of them, which is exactly the distinction the repair turns on.
    /development placeholder (?:image|for|photograph)/i,
  ],
  ["development-preview wording", /development preview/i],
  ["provisional-placeholder-content wording", /provisional placeholder content/i],
  ["not-approved-final-content wording", /not approved final content/i],
  ["the photo-figure credit element", /photo-figure__credit/i],
];

// --- REPAIR-09E (APV1-02): the footer must not advertise unfinished work ---

/**
 * Wording that described the SITE's setup process rather than its content.
 *
 * The footer rendered "Anya's social accounts are added once the operator confirms
 * the exact links. Nothing is linked here yet." unconditionally, outside the
 * development-notice gate: it told every visitor that accounts were still being
 * arranged, which is operator process and reads as an unfinished site. The block is
 * now gated with the notices, so in the shipped configuration these shapes must not
 * appear anywhere in the footer — and neither may an equivalent sentence.
 *
 * The scan is confined to the footer's own markup, because a seed record is allowed
 * to be honest about its provenance: what a published page must not do is describe
 * the site itself as unfinished.
 */
const footerForbidden = [
  ["operator-confirmation wording", /operator confirms/i],
  ["social-accounts-are-added wording", /social accounts are added/i],
  ["nothing-is-linked-here-yet wording", /nothing is linked here yet/i],
  ["awaiting-setup wording", /awaiting/i],
  ["not-yet-added wording", /not (?:yet )?(?:added|linked|confirmed|finalis|finaliz)/i],
  ["unfinished-site wording", /unfinished|work in progress|coming soon|still being (?:built|set up)/i],
  ["placeholder wording", /placeholder/i],
  ["development-preview wording", /development preview/i],
];

// --- Operator boundary (Slice 05) ----------------------------------------

/** Header the application accepts on loopback while ALLOW_DEVELOPMENT_IDENTITY is on. */
const IDENTITY_HEADER = "x-anyaparallax-development-identity";
const PHOTOGRAPHER = "photographer@anyaparallax.test";
const MANAGER = "manager@anyaparallax.test";
const INACTIVE = "deactivated@anyaparallax.test";
const UNKNOWN = "stranger@anyaparallax.test";

/** Role material a client might try to inject; none of it may change a decision. */
const forgedRoleHeaders = {
  "x-anyaparallax-role": "manager",
  "cf-anyaparallax-role": "manager",
  role: "manager",
  cookie: "anyaparallax-role=manager; role=manager",
  "cf-access-authenticated-user-email": MANAGER,
};

/**
 * `status` is what the boundary must return; `identity` (when present) is the
 * development identity to present. `includes` optionally asserts a marker in
 * the authorised page so a 200 cannot be an empty shell.
 */
const protectedCases = [
  { path: "/admin", expect: 401, label: "anonymous" },
  { path: "/manager", expect: 401, label: "anonymous" },
  { path: "/admin/photos", expect: 401, label: "anonymous" },
  { path: "/admin/upload", expect: 401, label: "anonymous" },
  { path: "/admin/unknown-path", expect: 401, label: "anonymous unknown admin path" },
  { path: "/manager/diagnostics", expect: 401, label: "anonymous" },
  { path: "/manager/unknown-path", expect: 401, label: "anonymous unknown manager path" },
  {
    path: "/manager",
    expect: 401,
    label: "anonymous with forged manager headers",
    headers: forgedRoleHeaders,
  },
  {
    path: "/admin",
    expect: 401,
    label: "anonymous with a forged Access email header",
    headers: { "cf-access-authenticated-user-email": PHOTOGRAPHER },
  },
  {
    path: "/admin",
    expect: 200,
    label: "photographer",
    identity: PHOTOGRAPHER,
    includes: PHOTOGRAPHER,
  },
  { path: "/admin/photos", expect: 200, label: "photographer", identity: PHOTOGRAPHER },
  { path: "/admin/upload", expect: 200, label: "photographer", identity: PHOTOGRAPHER },
  { path: "/admin/galleries", expect: 200, label: "photographer", identity: PHOTOGRAPHER },
  // Slice 08: the enquiry list holds customers' details, so its boundary is
  // checked here as well as in the Slice 08 served check.
  { path: "/admin/enquiries", expect: 401, label: "anonymous" },
  { path: "/admin/prints", expect: 401, label: "anonymous" },
  {
    path: "/admin/enquiries",
    expect: 403,
    label: "unknown account",
    identity: UNKNOWN,
  },
  { path: "/admin/enquiries", expect: 200, label: "photographer", identity: PHOTOGRAPHER },
  { path: "/admin/prints", expect: 200, label: "photographer", identity: PHOTOGRAPHER },
  {
    path: "/admin/enquiries",
    expect: 200,
    label: "manager using the shared /admin area",
    identity: MANAGER,
  },
  { path: "/admin/settings", expect: 200, label: "photographer", identity: PHOTOGRAPHER },
  {
    path: "/admin/unknown-path",
    expect: 200,
    label: "photographer unknown admin path",
    identity: PHOTOGRAPHER,
    includes: "does not exist",
  },
  { path: "/manager", expect: 403, label: "photographer", identity: PHOTOGRAPHER },
  {
    path: "/manager?role=manager",
    expect: 403,
    label: "photographer with a forged role query parameter",
    identity: PHOTOGRAPHER,
  },
  {
    path: "/manager",
    expect: 403,
    label: "photographer with forged manager headers",
    identity: PHOTOGRAPHER,
    headers: forgedRoleHeaders,
  },
  {
    path: "/manager/diagnostics",
    expect: 403,
    label: "photographer",
    identity: PHOTOGRAPHER,
  },
  {
    path: "/manager/settings",
    expect: 403,
    label: "photographer",
    identity: PHOTOGRAPHER,
  },
  {
    path: "/manager/maintenance",
    expect: 403,
    label: "photographer",
    identity: PHOTOGRAPHER,
  },
  { path: "/manager", expect: 200, label: "manager", identity: MANAGER, includes: MANAGER },
  { path: "/manager/diagnostics", expect: 200, label: "manager", identity: MANAGER },
  { path: "/manager/settings", expect: 200, label: "manager", identity: MANAGER },
  { path: "/manager/maintenance", expect: 200, label: "manager", identity: MANAGER },
  {
    path: "/admin",
    expect: 200,
    label: "manager using the shared /admin area",
    identity: MANAGER,
    includes: MANAGER,
  },
  { path: "/admin", expect: 403, label: "deactivated account", identity: INACTIVE },
  { path: "/admin", expect: 403, label: "unknown account", identity: UNKNOWN },
  { path: "/manager", expect: 403, label: "unknown account", identity: UNKNOWN },
];

const failures = [];

// REPAIR-09A: this check asserts the PRODUCTION state of the public chrome, so the
// development-notice switch is forced OFF for its dev server rather than inherited.
// Without this, a developer's own `.dev.vars` (which the shipped configuration
// documents as the way to preview the notices locally) would make the gate fail
// for a legitimate local setting. `.dev.vars` is gitignored, any existing file is
// restored in the `finally` below, and nothing tracked is written.
const restoreWorkerVariables = withWorkerVariables({ SHOW_DEVELOPMENT_NOTICES: "false" });

const server = spawn(
  process.platform === "win32" ? "node.exe" : "node",
  [
    resolve(root, "node_modules", "vite", "bin", "vite.js"),
    "dev",
    "--port",
    String(port),
    "--strictPort",
  ],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/`, { redirect: "manual" });
      if (response.status < 500) {
        return true;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function shutdown() {
  if (!server.killed) {
    server.kill();
  }
}

try {
  const ready = await waitForServer();
  if (!ready) {
    console.error("Preview server did not become ready.");
    console.error(serverOutput.slice(-2000));
    shutdown();
    restoreWorkerVariables();
    process.exit(1);
  }

  for (const route of routes) {
    const response = await fetch(`${origin}${route}`);
    const body = await response.text();
    for (const rule of forbidden) {
      if (body.includes(rule.value)) {
        failures.push(`${route} (${response.status}) leaks ${rule.label}`);
      }
    }
    if (!response.ok) {
      failures.push(`${route} returned unexpected status ${response.status}`);
    }

    // REPAIR-09A: no development placeholder chrome in a served public page.
    //
    // The served configuration sets SHOW_DEVELOPMENT_NOTICES to "false", so this
    // is the production state: no caption, no injected alt prefix and no preview
    // notice may reach a visitor.
    for (const [label, pattern] of chromeForbidden) {
      const match = pattern.exec(body);
      if (match) {
        failures.push(
          `${route} serves ${label} (${JSON.stringify(match[0])}); production output must not ` +
            "describe the site or its photographs as placeholder or preview content",
        );
      }
    }
    // The scan above only means something if the chrome it looks for is actually
    // rendered, so the footer is asserted present on the same response.
    if (!body.includes("site-footer")) {
      failures.push(`${route} rendered no footer, so the chrome scan proves nothing`);
    }
  }

  // REPAIR-09E (APV1-02): the public footer carries no unfinished-site process
  // wording, on every representative page, and keeps truthful navigation.
  for (const route of ["/", "/galleries", "/photo/closing-time", "/prints", "/about", "/contact"]) {
    const html = await (await fetch(`${origin}${route}`)).text();
    const footer = /<footer[\s\S]*?<\/footer>/i.exec(html)?.[0] ?? "";
    if (footer.length === 0) {
      failures.push(`${route} rendered no footer element, so the footer scan proves nothing`);
      continue;
    }
    for (const [label, pattern] of footerForbidden) {
      const match = pattern.exec(footer);
      if (match) {
        failures.push(
          `${route}'s footer serves ${label} (${JSON.stringify(match[0])}); a published footer ` +
            "must not describe the site's setup as unfinished",
        );
      }
    }
    // A heading with nothing under it would be the same defect in another shape:
    // the social block is omitted entirely rather than left empty.
    if (footer.includes("footer__social")) {
      failures.push(`${route}'s footer still renders the social block with the notices off`);
    }
    // ...and the truthful navigation is retained, so removing the block cost the
    // footer nothing a visitor needs.
    for (const link of ['href="/contact"', 'href="/prints"']) {
      if (!footer.includes(link)) {
        failures.push(`${route}'s footer no longer links ${link}`);
      }
    }
  }

  // REPAIR-09A: gallery-cover alternative text.
  //
  // The covers used to be announced as "Development placeholder for the {gallery}
  // cover photograph." — a generated string describing every collection cover on
  // the site as a placeholder. The covers are now described with the cover
  // photograph's own words, so the assertion is about the INJECTED PREFIX and the
  // injected template, not about the words a record uses about itself.
  const galleriesHtml = await (await fetch(`${origin}/galleries`)).text();
  const coverAlts = [...galleriesHtml.matchAll(/<img[^>]*class="collection-card__image"[^>]*alt="([^"]*)"/gi)].map(
    (match) => match[1] ?? "",
  );
  if (coverAlts.length === 0) {
    failures.push("the galleries page rendered no cover images, so the cover alt scan proves nothing");
  }
  for (const alt of coverAlts) {
    if (alt.length === 0) {
      failures.push(
        "a gallery cover has empty alternative text while its photograph has a description or title",
      );
    }
    if (/^development placeholder/i.test(alt)) {
      failures.push(
        `a gallery-cover alt begins with the injected development placeholder prefix: ${JSON.stringify(alt)}`,
      );
    }
    if (/cover photograph/i.test(alt)) {
      failures.push(
        `a gallery-cover alt still uses the generated cover template: ${JSON.stringify(alt)}`,
      );
    }
  }

  // Unpublished and unknown rows must stay indistinguishable publicly.
  for (const route of hiddenRoutes) {
    const response = await fetch(`${origin}${route}`);
    if (response.status !== 404) {
      failures.push(`${route} should be 404 but returned ${response.status}`);
    }
  }

  // REPAIR-09A: the 404 a visitor actually reaches is public chrome too. It used
  // to tell every visitor the site was a development preview, so it is scanned
  // like any other served page.
  for (const route of notFoundRoutes) {
    const response = await fetch(`${origin}${route}`, { redirect: "manual" });
    const body = await response.text();
    if (response.status !== 404) {
      failures.push(`${route} should be 404 but returned ${response.status}`);
    }
    for (const [label, pattern] of chromeForbidden) {
      const match = pattern.exec(body);
      if (match) {
        failures.push(`${route} serves ${label} (${JSON.stringify(match[0])})`);
      }
    }
  }

  // The operator boundary: exactly the status each identity allows.
  for (const testCase of protectedCases) {
    const headers = { ...(testCase.headers ?? {}) };
    if (testCase.identity) {
      headers[IDENTITY_HEADER] = testCase.identity;
    }
    const response = await fetch(`${origin}${testCase.path}`, { headers, redirect: "manual" });
    const body = await response.text();

    if (response.status !== testCase.expect) {
      failures.push(
        `${testCase.path} for ${testCase.label} returned ${response.status}, expected ${testCase.expect}`,
      );
    }
    if (!(response.headers.get("cache-control") ?? "").includes("no-store")) {
      failures.push(
        `${testCase.path} for ${testCase.label} is missing cache-control: no-store`,
      );
    }
    if (body.includes(forbidden[0].value) || body.includes(forbidden[1].value)) {
      failures.push(`${testCase.path} for ${testCase.label} leaks a private-master identifier`);
    }
    if (testCase.includes && !body.includes(testCase.includes)) {
      failures.push(
        `${testCase.path} for ${testCase.label} does not show ${JSON.stringify(testCase.includes)}`,
      );
    }
  }
} finally {
  shutdown();
  // Restore the workspace even when an assertion failed: the check's own local
  // override must not outlive it.
  restoreWorkerVariables();
}

if (failures.length > 0) {
  console.error(`Served-payload check FAILED with ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(` - ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Served-payload check passed: ${routes.length} public routes inspected, no private-master identifiers in served HTML and no ` +
    `development placeholder/preview chrome; the footer on six representative pages carried no operator-process or ` +
    `unfinished-site wording, omitted the social block entirely rather than leaving an empty heading, and kept its ` +
    `truthful contact and print links; ${hiddenRoutes.length} hidden routes and ${notFoundRoutes.length} public 404s ` +
    `returned 404 without preview wording; ` +
    `${protectedCases.length} operator-route cases enforced the expected 401/403/200 boundary.`,
);
