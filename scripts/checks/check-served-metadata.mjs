#!/usr/bin/env node
/**
 * Served social metadata check (Slice 07).
 *
 * The metadata builder is unit-tested elsewhere; this suite proves the tags
 * actually reach the WIRE. It boots the app and inspects the HTML a crawler would
 * receive, because a canonical link or an `og:image` that only exists in a test
 * double is not a social card.
 *
 * Two things are asserted with equal weight:
 *
 *   WHAT MUST BE THERE — the exact canonical URL on the configured origin, the
 *   OpenGraph and Twitter block, and a preview image on the PUBLIC media path.
 *
 *   WHAT MUST NOT — `r2://masters/`, `originalStorageKey`, `original_storage_key`,
 *   the MASTERS binding name, and any private object path. A social preview is the
 *   one place a private master would escape the site entirely, so the absence is
 *   as important as the presence.
 *
 * A draft is checked too: it must not produce a preview page at all, rather than
 * producing one with metadata for unpublished work.
 *
 * Local only: the dev server renders locally and no external service is contacted.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 4185;
const origin = `http://[::1]:${port}`;
const CANONICAL_ORIGIN = "https://anyaparallax.co.uk";

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

async function waitForServer(timeoutMs = 40000) {
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

/** The document title text. */
function documentTitle(html) {
  const match = /<title>([^<]*)<\/title>/i.exec(html);
  return match?.[1] ?? null;
}

/** Anything that would mean private data reached the markup. */
const FORBIDDEN = [
  ["the private masters scheme", "r2://masters/"],
  ["the private master field name", "originalStorageKey"],
  ["the private master column name", "original_storage_key"],
  ["the private bucket binding name", "MASTERS"],
  ["an originals object path", "originals/"],
];

try {
  if (!(await waitForServer())) {
    console.error("dev server did not start");
    console.error(serverOutput.slice(-3000));
    await shutdown();
    process.exit(1);
  }

  // --- A published photograph --------------------------------------------
  const published = await fetch(`${origin}/photo/closing-time`);
  const html = await published.text();
  check(published.status === 200, `a published photograph returned ${published.status}`);

  const title = documentTitle(html);
  const canonical = canonicalHref(html);
  const ogUrl = metaContent(html, "property", "og:url");
  const ogImage = metaContent(html, "property", "og:image");
  const twitterCard = metaContent(html, "name", "twitter:card");
  const twitterImage = metaContent(html, "name", "twitter:image");
  const description = metaContent(html, "name", "description");

  check(
    canonical === `${CANONICAL_ORIGIN}/photo/closing-time`,
    `the canonical URL is ${JSON.stringify(canonical)}, expected ${CANONICAL_ORIGIN}/photo/closing-time`,
  );
  check(ogUrl === canonical, `og:url is ${JSON.stringify(ogUrl)}, expected the canonical URL`);
  check(
    typeof title === "string" && title.includes("Closing time"),
    `the document title does not name the photograph: ${JSON.stringify(title)}`,
  );
  check(typeof description === "string" && description.length > 0, "no meta description was served");
  check(
    metaContent(html, "property", "og:type") === "article",
    `og:type is ${JSON.stringify(metaContent(html, "property", "og:type"))}`,
  );
  check(
    metaContent(html, "property", "og:title")?.includes("Closing time") === true,
    "og:title does not name the photograph",
  );
  check(
    (metaContent(html, "property", "og:description") ?? "").length > 0,
    "og:description is missing",
  );
  check(twitterCard === "summary_large_image", `twitter:card is ${JSON.stringify(twitterCard)}`);
  check(
    metaContent(html, "name", "twitter:title")?.includes("Closing time") === true,
    "twitter:title does not name the photograph",
  );
  check(
    (metaContent(html, "name", "twitter:description") ?? "").length > 0,
    "twitter:description is missing",
  );

  // The preview image must be a PUBLIC path on the CANONICAL origin.
  //
  // Two shapes are legitimate and the check distinguishes them rather than
  // accepting either blindly: a production row stores an `r2://images/` key that
  // the media boundary turns into `/media/...`, while a development seed
  // photograph points at a placeholder asset under `/images/dev/`. Both are
  // public; a private reference is neither, and the forbidden-string scan below
  // is what catches that.
  for (const [label, value] of [
    ["og:image", ogImage],
    ["twitter:image", twitterImage],
  ]) {
    check(
      typeof value === "string" &&
        (value.startsWith(`${CANONICAL_ORIGIN}/media/`) ||
          value.startsWith(`${CANONICAL_ORIGIN}/images/dev/`)),
      `${label} is ${JSON.stringify(value)}, expected a public path on ${CANONICAL_ORIGIN}`,
    );
    check(
      typeof value === "string" && !value.includes("r2://"),
      `${label} leaks a storage scheme: ${JSON.stringify(value)}`,
    );
    check(
      typeof value === "string" && !/masters|originals/i.test(value),
      `${label} points at a private domain: ${JSON.stringify(value)}`,
    );
  }
  check(
    ogImage === twitterImage,
    "og:image and twitter:image disagree, so the same page would preview differently",
  );

  // --- Nothing private reached the markup --------------------------------
  for (const [label, needle] of FORBIDDEN) {
    check(!html.includes(needle), `the served photograph page contains ${label} (${needle})`);
  }
  // A request whose Host is not the canonical origin must not change the tags:
  // the canonical origin is configured, not derived from the request.
  check(
    !html.includes(`${origin}/media/`),
    "the preview image was built from the REQUEST origin rather than the canonical origin",
  );

  // --- The engagement controls are present -------------------------------
  check(html.includes("engagement__like"), "the like control was not rendered");
  check(html.includes("engagement__share"), "the share control was not rendered");
  check(
    /likes?</i.test(html),
    "no like count or label was rendered",
  );

  // --- No identity material in loader data or markup ---------------------
  //
  // The rule is about the ANONYMOUS BROWSER IDENTIFIER, not about any UUID:
  // uploaded photographs legitimately have `photo-<uuid>` ids, and asserting on
  // a bare UUID shape would fail on those while proving nothing about identity.
  // What must never appear is the cookie itself, the name it is stored under, or
  // a digest of its value.
  check(
    !/anyaparallax_browser/i.test(html),
    "the served page mentions the anonymous browser identifier cookie",
  );
  const cookieValuePattern = /anyaparallax_browser=([^;&"\\]+)/i.exec(html);
  check(cookieValuePattern === null, "the served page carries a browser identifier VALUE");
  check(
    !/[0-9a-f]{64}/.test(html),
    "the served page contains something shaped like a token digest",
  );
  check(!html.includes("share_events"), "the served page names the share_events table");
  check(
    !html.includes("likedByThisBrowser\":true"),
    "the served page asserts a like state outside the loader's own value",
  );

  // --- A draft produces no preview page ----------------------------------
  // Two deliberately unpublished photographs and one unpublished gallery exist
  // in the fixture data. None may produce social metadata, because none may
  // produce a page.
  for (const slug of ["studio-trial", "unreleased-edit"]) {
    const draft = await fetch(`${origin}/photo/${slug}`);
    const draftHtml = await draft.text();
    check(draft.status === 404, `the draft ${slug} returned ${draft.status}, expected 404`);
    check(!draftHtml.includes("og:image"), `the draft ${slug} served social metadata`);
    check(
      !draftHtml.includes(CANONICAL_ORIGIN),
      `the draft ${slug} served a canonical URL for unpublished work`,
    );
  }
  const hiddenGallery = await fetch(`${origin}/gallery/studio-work`);
  check(hiddenGallery.status === 404, `an unpublished gallery returned ${hiddenGallery.status}`);
} finally {
  await shutdown();
}

if (failures.length > 0) {
  console.error(`Served metadata check FAILED with ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
console.log(
  "Served metadata check passed: canonical, OpenGraph and Twitter tags served on the configured origin with a " +
    "public preview derivative, no private reference in the markup, and no metadata for drafts.",
);
