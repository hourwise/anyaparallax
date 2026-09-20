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

import { withWorkerVariables } from "./dev-vars.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 4185;
const origin = `http://[::1]:${port}`;
const CANONICAL_ORIGIN = "https://anyaparallax.co.uk";

// The development valves ship "false"; this served check is local development, so it
// opts into the seed the way a developer's gitignored `.dev.vars` does, before the
// dev server starts and reads it. Restored in the `finally`.
const restoreWorkerVariables = withWorkerVariables({});

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

/**
 * Anything that would mean an internal PUBLIC storage reference reached markup.
 *
 * This is the Slice 07A defect: `r2://images/...` is an internal reference a
 * browser cannot fetch, and it used to be copied into `src` attributes by the
 * public projection. It is checked on every served route below.
 */
const FORBIDDEN_PUBLIC_STORAGE = [
  ["the public images scheme", "r2://images/"],
  ["any r2 scheme", "r2://"],
  ["the web derivative storage key", "web_storage_key"],
  ["the thumbnail derivative storage key", "thumbnail_storage_key"],
];

/** Every `src`/`href` value in the markup that looks like an image reference. */
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

/** The `og:image` content of a page, or null. */
function ogImageFrom(html) {
  return metaContent(html, "property", "og:image");
}

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
  // Slice 07A: no INTERNAL public storage reference either. The two scans are
  // deliberately separate, because they fail for different reasons — one is a
  // confidentiality breach, the other is a broken image.
  for (const [label, needle] of FORBIDDEN_PUBLIC_STORAGE) {
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

  // --- A DATABASE-BACKED photograph (Slice 07A) ---------------------------
  //
  // The defect this slice repairs was invisible with the development seed set,
  // because a seed photograph stores `/images/dev/*.svg` — already a public path.
  // It only appeared once a row held a real `r2://images/...` reference. So the
  // check creates exactly that: it uploads a photograph through the production
  // pipeline, so local D1 holds a row whose derivative keys are internal
  // references, and then inspects the HTML a browser would receive.
  //
  // A helper passing while a component bypasses it is the defect being guarded
  // against, which is why this asserts on SERVED MARKUP and then actually
  // fetches the URL it finds.
  const fixture = new FormData();
  fixture.append(
    "photos",
    new Blob([new Uint8Array(readFileSync(resolve(root, "scripts", "fixtures", "photo.jpg")))], {
      type: "image/jpeg",
    }),
    "photo.jpg",
  );
  const draftFixture = new FormData();
  draftFixture.append(
    "photos",
    new Blob([new Uint8Array(readFileSync(resolve(root, "scripts", "fixtures", "greyscale.jpg")))], {
      type: "image/jpeg",
    }),
    "greyscale.jpg",
  );

  const uploaded = await fetch(
    `${origin}/dev-verification?title=Delivery+Probe&published=true&watermark=off&position=none`,
    { method: "POST", body: fixture },
  );
  const draftUploaded = await fetch(
    `${origin}/dev-verification?title=Delivery+Draft&published=false&watermark=off&position=none`,
    { method: "POST", body: draftFixture },
  );
  const uploadedBody = await uploaded.json();
  const draftBody = await draftUploaded.json();
  const dbRows = uploadedBody.rows ?? [];
  const publishedRow = dbRows.find((row) => row.published === 1 && row.web_storage_key?.startsWith("r2://images/"));
  const draftRow = (draftBody.rows ?? []).find(
    (row) => row.published === 0 && row.web_storage_key?.startsWith("r2://images/"),
  );
  check(Boolean(publishedRow), "no DB-backed published photograph could be created for this check");
  check(Boolean(draftRow), "no DB-backed draft photograph could be created for this check");
  // The premise of the check: the row genuinely holds an INTERNAL reference.
  check(
    publishedRow?.web_storage_key?.startsWith("r2://images/web/") === true,
    `the fixture row does not hold an internal web reference: ${publishedRow?.web_storage_key}`,
  );
  check(
    publishedRow?.thumbnail_storage_key?.startsWith("r2://images/thumbs/") === true,
    `the fixture row does not hold an internal thumbnail reference: ${publishedRow?.thumbnail_storage_key}`,
  );

  if (publishedRow) {
    const expectedWeb = `/${String(publishedRow.web_storage_key).replace("r2://images/", "media/")}`;
    const expectedThumb = `/${String(publishedRow.thumbnail_storage_key).replace("r2://images/", "media/")}`;

    const dbPage = await fetch(`${origin}/photo/${publishedRow.slug}`);
    const dbHtml = await dbPage.text();
    check(dbPage.status === 200, `the DB-backed photograph returned ${dbPage.status}`);

    // (1) No internal public storage reference anywhere in the markup.
    for (const [label, needle] of FORBIDDEN_PUBLIC_STORAGE) {
      check(!dbHtml.includes(needle), `a DB-backed photograph page contains ${label} (${needle})`);
    }
    for (const [label, needle] of FORBIDDEN) {
      check(!dbHtml.includes(needle), `a DB-backed photograph page contains ${label} (${needle})`);
    }

    // (2) The detail image is the converted PUBLIC path.
    const detailSrc = /<img[^>]*class="photo-detail__image"[^>]*src="([^"]*)"/i.exec(dbHtml)?.[1] ?? null;
    check(
      detailSrc === expectedWeb,
      `the detail image src is ${JSON.stringify(detailSrc)}, expected ${JSON.stringify(expectedWeb)}`,
    );

    // (2b) REPAIR-09A: the REAL photograph's own alternative text and metadata.
    //
    // This page is the representative DB-backed photograph the repair is verified
    // against: its description comes from the upload pipeline, not from the
    // development seed set, so any development wording on it can only have been
    // injected by the application. The assertions are therefore exact rather than
    // a blanket word scan — a RELATED photograph in the same gallery is a seed
    // record whose own description legitimately mentions that it is development
    // material, and a scan that forbade the word outright would only pass by
    // rewriting the seed data.
    const detailAlt = /<img[^>]*class="photo-detail__image"[^>]*alt="([^"]*)"/i.exec(dbHtml)?.[1] ?? null;
    check(
      detailAlt === "platform verification",
      `the DB-backed photograph's alt is ${JSON.stringify(detailAlt)}, expected the record's own description`,
    );
    for (const [label, value] of [
      ["the alt attribute", detailAlt],
      ["the document title", documentTitle(dbHtml)],
      ["the meta description", metaContent(dbHtml, "name", "description")],
      ["og:description", metaContent(dbHtml, "property", "og:description")],
      ["twitter:description", metaContent(dbHtml, "name", "twitter:description")],
    ]) {
      check(
        typeof value !== "string" ||
          !/development placeholder|development preview|provisional|placeholder/i.test(value),
        `${label} of the DB-backed photograph carries injected development wording: ${JSON.stringify(value)}`,
      );
    }
    check(
      !/photo-figure__credit/.test(dbHtml),
      "the DB-backed photograph page still renders the development-placeholder credit",
    );
    check(
      !detailAlt?.startsWith("Development placeholder"),
      "the DB-backed photograph's alt still begins with the injected placeholder prefix",
    );

    // (3) The URL it names actually serves a real image, so "loadable" is proved
    //     rather than assumed. The fetch is guarded so that a regression produces
    //     a readable failure instead of a URL-parse crash: when the projection is
    //     broken the value is an `r2://` URI, and the assertion above has already
    //     reported it.
    if (typeof detailSrc === "string" && detailSrc.startsWith("/")) {
      const servedImage = await fetch(`${origin}${detailSrc}`);
      check(servedImage.status === 200, `the detail image URL returned ${servedImage.status}`);
      const servedBytes = new Uint8Array(await servedImage.arrayBuffer());
      check(servedBytes.byteLength > 0, "the detail image URL served an empty body");
      check(
        servedBytes[0] === 0x52 && servedBytes[1] === 0x49 && servedBytes[8] === 0x57,
        `the detail image is not a RIFF/WEBP container: ${[...servedBytes.slice(0, 12)].join(",")}`,
      );
    } else {
      check(false, `the detail image source is not a fetchable public path: ${JSON.stringify(detailSrc)}`);
    }

    // (4) Every image reference on the page is a public path, not a storage URI.
    const references = imageReferences(dbHtml);
    check(references.length > 0, "the DB-backed page rendered no image references at all");
    check(
      references.every((value) => value.startsWith("/") || value.startsWith("https://")),
      `an image reference is not a browser URL: ${JSON.stringify(references.filter((value) => !value.startsWith("/") && !value.startsWith("https://")))}`,
    );
    check(
      references.every((value) => !value.includes("r2:")),
      `an image reference is an internal storage URI: ${JSON.stringify(references.filter((value) => value.includes("r2:")))}`,
    );
    check(
      references.includes(expectedWeb) || references.includes(expectedThumb),
      "the converted derivative path does not appear among the page's image references",
    );

    // (5) The social preview uses the public path as well.
    check(
      ogImageFrom(dbHtml) === null ||
        (ogImageFrom(dbHtml)?.endsWith(expectedWeb.split("/").slice(1).join("/")) ?? false),
      `og:image is ${JSON.stringify(ogImageFrom(dbHtml))}, expected to end with the public derivative path`,
    );
  }

  // --- The other DB-backed surfaces --------------------------------------
  //
  // A gallery grid and the homepage both render photographs from the same
  // projection, so a raw reference there would be the same defect in a second
  // place. Both are scanned for internal references.
  const galleryPage = await fetch(`${origin}/gallery/nightlife`);
  const galleryHtml = await galleryPage.text();
  check(galleryPage.status === 200, `a gallery page returned ${galleryPage.status}`);
  if (publishedRow) {
    check(
      galleryHtml.includes(`/photo/${publishedRow.slug}`) ||
        !galleryHtml.includes("photo-figure__image"),
      "the gallery did not list the uploaded photograph, so the scan proves nothing",
    );
  }
  for (const [label, needle] of FORBIDDEN_PUBLIC_STORAGE) {
    check(!galleryHtml.includes(needle), `a gallery page contains ${label} (${needle})`);
  }

  for (const route of ["/", "/galleries"]) {
    const response = await fetch(`${origin}${route}`);
    const routeHtml = await response.text();
    check(response.status === 200, `${route} returned ${response.status}`);
    for (const [label, needle] of FORBIDDEN_PUBLIC_STORAGE) {
      check(!routeHtml.includes(needle), `${route} contains ${label} (${needle})`);
    }
    check(
      imageReferences(routeHtml).every((value) => !value.includes("r2:")),
      `${route} renders an internal storage reference into an image attribute`,
    );
  }

  // --- The draft stays unreachable ---------------------------------------
  if (draftRow) {
    const draftPage = await fetch(`${origin}/photo/${draftRow.slug}`);
    check(draftPage.status === 404, `a DB-backed draft returned ${draftPage.status}, expected 404`);
    const draftHtml = await draftPage.text();
    check(!draftHtml.includes("og:image"), "a DB-backed draft served social metadata");
    // Its derivative must also be refused, which is the Slice 06 publication rule
    // still holding for a row that genuinely exists in the bucket.
    const draftDerivative = `/${String(draftRow.web_storage_key).replace("r2://images/", "media/")}`;
    const draftMedia = await fetch(`${origin}${draftDerivative}`);
    check(
      draftMedia.status === 404,
      `an unpublished derivative returned ${draftMedia.status}, expected 404`,
    );
  }
} finally {
  await shutdown();
  restoreWorkerVariables();
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
