#!/usr/bin/env node
/**
 * Development-notice state check (REPAIR-09A).
 *
 * The repair did two different things to the site's development wording, and they
 * are verified differently on purpose:
 *
 *   REMOVED UNCONDITIONALLY — the placeholder caption on every photograph and the
 *   injected "Development placeholder …" prefix on every generated alt attribute.
 *   There is no configuration under which a real photograph is announced as a
 *   placeholder, so this check asserts their absence with the notices switched ON,
 *   which is the state in which a mistake would be hardest to see.
 *
 *   GATED BY CONFIGURATION — the footer, homepage, gallery and About notices and
 *   the preview meta-description suffixes. Their OFF state is asserted by
 *   `check-served-payload.mjs`, which also forces the switch off; this check boots
 *   the app with `SHOW_DEVELOPMENT_NOTICES` forced ON and proves the notices still
 *   render, so the gating did not amount to deleting them.
 *
 * WHY A `.dev.vars` OVERRIDE. Notice state is configuration, and the shipped
 * `wrangler.jsonc` value is the publication-safe "false". Wrangler's local
 * override file is the supported way to run the other state, it is gitignored, and
 * an existing developer file is restored afterwards (see `checks/dev-vars.mjs`).
 *
 * WHY THIS FILE ALSO ASSERTS THE SHIPPED CONFIGURATION. Forcing the switch in a
 * served check makes that check deterministic, but it also means the check would
 * pass whatever `wrangler.jsonc` said. The default state is therefore asserted
 * separately and deterministically, at the top of this file: the shipped value
 * must not enable the notices, and the reader must treat anything other than the
 * exact string "true" as off. Together with the served runs that is the complete
 * chain — shipped value is off, "off" means off, and off renders no notice.
 *
 * Local only: the dev server runs against Wrangler's local D1/R2 and no external
 * service is contacted.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { withWorkerVariables } from "./dev-vars.mjs";

register("../ts-extension-hooks.mjs", import.meta.url);
const { DEVELOPMENT_NOTICES_VARIABLE, developmentNoticesEnabled } = await import(
  "../../app/data/site.ts"
);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 4187;
const origin = `http://[::1]:${port}`;

const failures = [];
function check(condition, message) {
  if (condition) {
    console.log(`ok   | ${message}`);
  } else {
    failures.push(message);
    console.log(`FAIL | ${message}`);
  }
}

// --- The shipped default and the switch's own semantics --------------------

const wranglerConfig = readFileSync(resolve(root, "wrangler.jsonc"), "utf8");
const shippedValue = new RegExp(`"${DEVELOPMENT_NOTICES_VARIABLE}"\\s*:\\s*"([^"]*)"`).exec(
  wranglerConfig,
)?.[1];
check(
  shippedValue !== "true",
  `the SHIPPED configuration enables the development notices (${DEVELOPMENT_NOTICES_VARIABLE} = ` +
    `${JSON.stringify(shippedValue)}); a deployment must not inherit placeholder chrome`,
);
check(
  shippedValue === "false",
  `${DEVELOPMENT_NOTICES_VARIABLE} is ${JSON.stringify(shippedValue)} in wrangler.jsonc; ` +
    "the shipped value should be the explicit, publication-safe \"false\"",
);

// Only the exact string "true" may enable the notices — the same rule the two
// ALLOW_DEVELOPMENT_* switches use, so a case variant, a numeric flag or a
// whitespace-padded value cannot turn placeholder chrome on by accident.
for (const [value, expected] of [
  ["true", true],
  ["false", false],
  [undefined, false],
  ["", false],
  ["TRUE", false],
  ["True", false],
  [" true", false],
  ["true ", false],
  ["1", false],
  ["yes", false],
  ["on", false],
]) {
  check(
    developmentNoticesEnabled(value === undefined ? {} : { SHOW_DEVELOPMENT_NOTICES: value }) ===
      expected,
    `developmentNoticesEnabled(${JSON.stringify(value)}) should be ${expected}`,
  );
}
check(
  developmentNoticesEnabled(undefined) === false,
  "an absent environment did not default the development notices to off",
);

const restoreWorkerVariables = withWorkerVariables({ SHOW_DEVELOPMENT_NOTICES: "true" });

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
 * The notices that must come back when the switch is on, each with the page that
 * carries it. Every string is the notice the site showed before the repair, so the
 * development experience is unchanged rather than merely non-empty.
 */
const EXPECTED_NOTICES = [
  [
    "/",
    "Development preview — photography, copy and galleries are placeholders.",
    "the homepage hero notice",
  ],
  [
    "/",
    "Provisional collections, counts and imagery.",
    "the homepage collections notice",
  ],
  [
    "/",
    "Provisional placeholder content: wording, imagery and links are not approved final content.",
    "the footer's provisional note",
  ],
  ["/", "Development preview. Not approved final content.", "the footer's preview note"],
  [
    "/",
    "social accounts are added once the operator confirms",
    "the footer's social note (REPAIR-09E: gated, not deleted)",
  ],
  ["/", "Development preview.", "the homepage meta-description suffix"],
  [
    "/galleries",
    "Development preview — gallery names and metadata are provisional seed data",
    "the galleries notice",
  ],
  [
    "/galleries",
    "Development preview with placeholder imagery.",
    "the galleries meta-description suffix",
  ],
  ["/gallery/nightlife", "photographs are placeholder assets", "the gallery notice"],
  ["/about", "Provisional wording.", "the About notice"],
  ["/about", "Portrait placeholder", "the About portrait label"],
  ["/about", "Provisional introduction and development preview", "the About meta description"],
  ["/no-such-page", "this development preview", "the 404 preview sentence"],
];

/**
 * Wording that must stay absent EVEN WITH THE NOTICES ON.
 *
 * These are the unconditional repairs: a photograph is never announced as a
 * placeholder and never carries the generated caption, whatever the configuration
 * says. The seed records' own descriptions are deliberately not scanned for the
 * bare word — a seed photograph saying it is development material is data
 * telling the truth about itself, which this repair must not sanitise.
 */
const ALWAYS_FORBIDDEN = [
  ["the development-placeholder credit element", /photo-figure__credit/i],
  ["injected development-placeholder alt wording", /development placeholder (?:image|for|photograph)/i],
];

/** The `content` of a meta tag matched by its property or name attribute. */
function metaContent(html, attribute, value) {
  const pattern = new RegExp(
    `<meta[^>]*${attribute}="${value}"[^>]*content="([^"]*)"|<meta[^>]*content="([^"]*)"[^>]*${attribute}="${value}"`,
    "i",
  );
  const match = pattern.exec(html);
  return match?.[1] ?? match?.[2] ?? null;
}

try {
  if (!(await waitForServer())) {
    console.error("dev server did not start");
    console.error(serverOutput.slice(-3000));
    await shutdown();
    restoreWorkerVariables();
    process.exit(1);
  }

  // The switch is genuinely on for this run: the assertion below would otherwise
  // be testing the off state twice and prove nothing about the gating.
  const home = await (await fetch(`${origin}/`)).text();
  check(
    home.includes("Development preview"),
    "the development notices did not render with SHOW_DEVELOPMENT_NOTICES=true, so the switch is not reaching the app",
  );

  for (const [path, text, label] of EXPECTED_NOTICES) {
    const html = await (await fetch(`${origin}${path}`, { redirect: "manual" })).text();
    check(html.includes(text), `${path} does not render ${label}`);
  }

  // The About preview suffix must reach the served meta description, not only the
  // component tree.
  const aboutHtml = await (await fetch(`${origin}/about`)).text();
  check(
    (metaContent(aboutHtml, "name", "description") ?? "").includes("Provisional introduction"),
    "the About meta description did not carry the preview wording while notices are on",
  );

  // The unconditional repairs hold in this state too.
  for (const [path] of [["/"], ["/galleries"], ["/gallery/nightlife"], ["/about"], ["/prints"]]) {
    const html = await (await fetch(`${origin}${path}`)).text();
    for (const [label, pattern] of ALWAYS_FORBIDDEN) {
      const match = pattern.exec(html);
      check(
        match === null,
        `${path} serves ${label} even with notices enabled (${JSON.stringify(match?.[0] ?? "")})`,
      );
    }
  }

  // A real photograph still carries its own words as its alternative text, not a
  // placeholder announcement, in this state.
  const galleryHtml = await (await fetch(`${origin}/gallery/nightlife`)).text();
  const figureAlts = [...galleryHtml.matchAll(/class="photo-figure__image"[^>]*alt="([^"]*)"/gi)].map(
    (match) => match[1] ?? "",
  );
  check(figureAlts.length > 0, "the gallery rendered no photograph figures, so the alt scan proves nothing");
  for (const alt of figureAlts) {
    check(
      !/^development placeholder/i.test(alt),
      `a photograph's alt still begins with the injected placeholder prefix: ${JSON.stringify(alt)}`,
    );
  }
} finally {
  await shutdown();
  restoreWorkerVariables();
}

if (failures.length > 0) {
  console.error(`Development-notice check FAILED with ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
console.log(
  `Development-notice check passed: the shipped configuration leaves the notices off and only the exact string "true" ` +
    `enables them; with SHOW_DEVELOPMENT_NOTICES=true all ${EXPECTED_NOTICES.length} development notices rendered ` +
    "again, including the footer, homepage, gallery, About and 404 notices and the preview meta descriptions; and with " +
    "the notices ON the placeholder caption and the injected alt prefix were still absent, so those repairs are " +
    "unconditional rather than configuration-dependent.",
);
