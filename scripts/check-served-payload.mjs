#!/usr/bin/env node
/**
 * Served-payload check for the Slice 03 security repair.
 *
 * Loader data is serialised into the HTML that reaches the browser, so this
 * script inspects real responses from the built application and fails if any
 * page leaks the private archival/print master identifier.
 *
 * It builds nothing itself: run `pnpm run build` first (the `check` script does
 * this by ordering `check:served` after the build in CI-style runs, and the
 * package script runs the build when the output is missing).
 *
 * Checks, for every public route:
 * - the field name `originalStorageKey` must not appear
 * - the development private-master marker must not appear
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4174;
/** Match the host the preview server binds to; bracketed IPv6 form is explicit. */
const origin = `http://[::1]:${port}`;

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
];

const forbidden = [
  { label: "field name originalStorageKey", value: "originalStorageKey" },
  {
    label: "private-master marker",
    value: "r2-private://anyaparallax-masters",
  },
];

if (!existsSync(resolve(root, "build", "server", "index.js"))) {
  console.error("Served-payload check requires a build. Run `pnpm run build` first.");
  process.exit(1);
}

const failures = [];

const server = spawn(
  process.platform === "win32" ? "node.exe" : "node",
  [resolve(root, "node_modules", "vite", "bin", "vite.js"), "preview", "--port", String(port), "--strictPort"],
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
    if (!response.ok && response.status !== 404) {
      failures.push(`${route} returned unexpected status ${response.status}`);
    }
  }
} finally {
  shutdown();
}

if (failures.length > 0) {
  console.error(`Served-payload check FAILED with ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(` - ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Served-payload check passed: ${routes.length} routes inspected, no private-master identifiers in served HTML.`,
);
