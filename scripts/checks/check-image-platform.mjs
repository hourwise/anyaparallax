#!/usr/bin/env node
/**
 * Platform image pipeline check (Slice 06 repair 01).
 *
 * Boots the app and drives the REAL Cloudflare Images binding, the REAL R2
 * buckets and the REAL local D1 through the production upload path. Everything
 * here is a measurement of platform behaviour, which is why it cannot be a fake:
 * the questions are "does the binding decode JPEG and PNG", "does it refuse to
 * upscale", "is a WebP derivative actually produced at the right size", "does an
 * unpublished derivative 404 through the real serving boundary".
 *
 * Local only: Wrangler's offline Images implementation is used, so no Cloudflare
 * API is contacted and nothing is billed. The dev server is started on its own
 * port because the served-payload check runs its own on another.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 4183;
const origin = `http://[::1]:${port}`;

const server = spawn(
  "node",
  [resolve(root, "node_modules", "vite", "bin", "vite.js"), "dev", "--port", String(port)],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += chunk.toString()));
server.stderr.on("data", (chunk) => (serverOutput += chunk.toString()));

/**
 * Stop the dev server and wait for it to actually exit.
 *
 * `kill()` alone is not enough on Windows: the child's stdio pipes are still
 * referenced when the parent tears down, and Node aborts with a libuv assertion
 * (`UV_HANDLE_CLOSING`) instead of exiting normally. Detaching the listeners and
 * awaiting the `close` event makes the shutdown orderly, which matters because a
 * crash after a passing run is indistinguishable from a failing run.
 */
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
    // A dev server that ignores SIGTERM must not hang the check forever.
    setTimeout(done, 5000);
  });
}

const failures = [];
function check(condition, message) {
  if (!condition) {
    failures.push(message);
    console.log(`FAIL | ${message}`);
  } else {
    console.log(`ok   | ${message}`);
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

/** POST one or more fixtures through the production upload pipeline. */
async function upload({ fixtures, query }) {
  const form = new FormData();
  for (const fixture of fixtures) {
    const bytes = readFileSync(resolve(root, "scripts", "fixtures", fixture));
    // The declared type must match the bytes: the pipeline refuses a mismatch on
    // purpose, so the harness must not create one.
    const type = fixture.endsWith(".png") ? "image/png" : "image/jpeg";
    form.append("photos", new Blob([new Uint8Array(bytes)], { type }), fixture);
  }
  const response = await fetch(`${origin}/dev-verification?${query}`, {
    method: "POST",
    body: form,
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: { raw: text.slice(0, 2000) } };
  }
}

try {
  if (!(await waitForServer())) {
    console.error("dev server did not start");
    console.error(serverOutput.slice(-3000));
    process.exit(1);
  }

  const bound = await (await fetch(`${origin}/dev-verification`)).json();
  console.log(`bound: ${JSON.stringify(bound.bound)}`);
  check(bound.bound.imageProcessor, "the IMAGE_TRANSFORMS (Cloudflare Images) binding is present");
  check(bound.bound.mastersBucket && bound.bound.imagesBucket, "both R2 buckets are bound");
  check(bound.bound.database, "D1 is bound");

  // --- JPEG and PNG through the real adapter ------------------------------
  const jpegRun = await upload({ fixtures: ["photo.jpg"], query: "title=Platform+JPEG&published=true" });
  check(jpegRun.status === 200, `JPEG upload returned HTTP ${jpegRun.status}`);
  const jpegOutcome = jpegRun.body.report?.outcomes?.[0];
  check(jpegOutcome?.ok === true, `JPEG accepted: ${JSON.stringify(jpegOutcome?.error ?? null)}`);
  check(
    jpegOutcome?.photo?.width === 320 && jpegOutcome?.photo?.height === 240,
    `JPEG geometry is ${jpegOutcome?.photo?.width}x${jpegOutcome?.photo?.height}, expected 320x240`,
  );

  const pngRun = await upload({ fixtures: ["photo.png"], query: "title=Platform+PNG&published=true" });
  const pngOutcome = pngRun.body.report?.outcomes?.[0];
  check(pngOutcome?.ok === true, `PNG accepted: ${JSON.stringify(pngOutcome?.error ?? null)}`);
  check(
    pngOutcome?.photo?.width === 320 && pngOutcome?.photo?.height === 240,
    `PNG geometry is ${pngOutcome?.photo?.width}x${pngOutcome?.photo?.height}, expected 320x240`,
  );

  // --- 1600 / 480 and no upscale ------------------------------------------
  const largeRun = await upload({ fixtures: ["large.jpg"], query: "title=Platform+Large&published=true" });
  const largeOutcome = largeRun.body.report?.outcomes?.[0];
  check(largeOutcome?.ok === true, `large JPEG accepted: ${JSON.stringify(largeOutcome?.error ?? null)}`);
  check(
    largeOutcome?.photo?.webWidth === 1600,
    `1600x1200 source produced a ${largeOutcome?.photo?.webWidth}px web derivative, expected 1600`,
  );
  check(
    largeOutcome?.photo?.webHeight === 1200,
    `1600x1200 source produced a ${largeOutcome?.photo?.webHeight}px web derivative height, expected 1200`,
  );

  const smallRun = await upload({ fixtures: ["greyscale.jpg"], query: "title=Platform+Small&published=true" });
  const smallOutcome = smallRun.body.report?.outcomes?.[0];
  check(smallOutcome?.ok === true, "small JPEG accepted");
  check(
    smallOutcome?.photo?.webWidth === 200 && smallOutcome?.photo?.webHeight === 150,
    `a 200x150 source produced ${smallOutcome?.photo?.webWidth}x${smallOutcome?.photo?.webHeight}; it must NOT be enlarged`,
  );

  // A PORTRAIT source above the limit: the longest edge must come down to 1600
  // (giving 800x1600), which is the case that catches a resize clipping one edge
  // instead of scaling the whole image.
  const portraitRun = await upload({
    fixtures: ["portrait.jpg"],
    query: "title=Platform+Portrait&published=true",
  });
  const portraitOutcome = portraitRun.body.report?.outcomes?.[0];
  check(portraitOutcome?.ok === true, "portrait JPEG accepted");
  check(
    portraitOutcome?.photo?.width === 1200 && portraitOutcome?.photo?.height === 2400,
    `portrait source recorded as ${portraitOutcome?.photo?.width}x${portraitOutcome?.photo?.height}, expected 1200x2400`,
  );
  check(
    portraitOutcome?.photo?.webWidth === 800 && portraitOutcome?.photo?.webHeight === 1600,
    `a 1200x2400 source produced ${portraitOutcome?.photo?.webWidth}x${portraitOutcome?.photo?.webHeight}; the longest edge must be 1600 with the aspect ratio preserved`,
  );

  // --- The stored derivatives are real WebP at the right size -------------
  //
  // Measured by parsing the RIFF/WEBP container here, NOT by asking the platform
  // to measure its own output: the dimensions in the file are independent
  // evidence that the derivative really is the size it claims to be.
  const webpInfo = (bytes) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (offset) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    if (tag(0) !== "RIFF" || tag(8) !== "WEBP") {
      return { container: tag(0) + "/" + tag(8) };
    }
    const chunk = tag(12);
    if (chunk === "VP8 ") {
      // Lossy: the 14-byte frame header ends with 16-bit dimensions (14 bits used).
      return {
        container: "webp",
        chunk,
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (chunk === "VP8L") {
      // Lossless: 14 bits width-1 then 14 bits height-1, little-endian.
      const bits = view.getUint32(21, true);
      return {
        container: "webp",
        chunk,
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === "VP8X") {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { container: "webp", chunk, width, height };
    }
    return { container: "webp", chunk };
  };

  const stored = [];
  for (const run of [jpegRun, pngRun, largeRun, smallRun]) {
    const row = run.body.rows?.find((candidate) => candidate.web_storage_key);
    if (!row) {
      continue;
    }
    for (const [kind, key, limit] of [
      ["web", row.web_storage_key, 1600],
      ["thumb", row.thumbnail_storage_key, 480],
    ]) {
      const url = `/media/${String(key).replace("r2://images/", "")}`;
      const response = await fetch(`${origin}${url}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const info = webpInfo(bytes);
      stored.push({ slug: row.slug, kind, key, status: response.status, bytes: bytes.length, ...info });
      check(response.status === 200, `${row.slug} ${kind} served with ${response.status}`);
      check(
        info.container === "webp",
        `${row.slug} ${kind} is NOT a WebP container (container ${info.container}, chunk ${info.chunk})`,
      );
      check(
        typeof info.width === "number",
        `${row.slug} ${kind} dimensions could not be read from its container (chunk ${info.chunk})`,
      );
      check(
        response.headers.get("content-type") === "image/webp",
        `${row.slug} ${kind} content type is ${response.headers.get("content-type")}`,
      );
      if (typeof info.width === "number") {
        check(
          Math.max(info.width, info.height) <= limit,
          `${row.slug} ${kind} is ${info.width}x${info.height}, above its ${limit}px limit`,
        );
      }
    }
  }
  console.log(`stored derivatives: ${JSON.stringify(stored, null, 1)}`);

  // --- Watermark: off, centre and corner all produce a derivative ---------
  for (const [position, expected] of [
    ["off", false],
    ["center", true],
    ["bottom-right", true],
  ]) {
    const run = await upload({
      fixtures: ["photo.jpg"],
      query: `title=Watermark+${position}&published=true&watermark=${
        expected ? "on" : "off"
      }&position=${position === "off" ? "none" : position}`,
    });
    const outcome = run.body.report?.outcomes?.[0];
    check(outcome?.ok === true, `watermark ${position}: upload accepted`);
    check(
      outcome?.photo?.watermarked === expected,
      `watermark ${position}: reported watermarked=${outcome?.photo?.watermarked}, expected ${expected}`,
    );
  }

  // --- Publication boundary through the real serving route ----------------
  const publishedRow = jpegRun.body.rows?.find((row) => row.published === 1);
  const unpublishedRun = await upload({
    fixtures: ["photo.jpg"],
    query: "title=Unpublished+Draft&published=false",
  });
  const draftRow = unpublishedRun.body.rows?.find((row) => row.published === 0);
  check(Boolean(draftRow), "an unpublished upload produced a draft row");

  if (publishedRow?.web_storage_key) {
    const url = `/media/${String(publishedRow.web_storage_key).replace("r2://images/", "")}`;
    const response = await fetch(`${origin}${url}`);
    check(response.status === 200, `published derivative served with ${response.status}`);
    check(
      response.headers.get("content-type") === "image/webp",
      `published derivative content type is ${response.headers.get("content-type")}`,
    );
    const masterPath = `/media/${String(publishedRow.original_storage_key).replace("r2://masters/", "originals/")}`;
    const masterAttempt = await fetch(`${origin}${masterPath}`);
    check(masterAttempt.status === 404, `a master-shaped path returned ${masterAttempt.status}`);
  } else {
    check(false, "no published row with a web derivative was recorded");
  }

  if (draftRow?.web_storage_key) {
    const url = `/media/${String(draftRow.web_storage_key).replace("r2://images/", "")}`;
    const response = await fetch(`${origin}${url}`);
    check(response.status === 404, `an UNPUBLISHED derivative returned ${response.status}, expected 404`);
    const body = await response.text();
    check(body.length === 0, "the unpublished 404 returned a body");
  } else {
    check(false, "no draft row with a web derivative was recorded");
  }

  // --- Malformed and traversing paths -------------------------------------
  for (const path of [
    "/media/",
    "/media/../originals/photo-1/master.tif",
    "/media/web/../../originals/x/master.tif",
    "/media/nonexistent.webp",
  ]) {
    const response = await fetch(`${origin}${path}`, { redirect: "manual" });
    check(
      response.status === 404 || response.status === 301 || response.status === 308,
      `${path} returned ${response.status}`,
    );
  }
} finally {
  await shutdown();
}

if (failures.length > 0) {
  console.error(`Image platform check FAILED with ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
console.log(
  "Image platform check passed: the Images binding decoded JPEG and PNG, produced bounded WebP " +
    "derivatives without upscaling, and the publication boundary denied unpublished, private and " +
    "malformed paths.",
);
