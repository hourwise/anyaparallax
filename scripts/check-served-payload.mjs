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
];

/** Routes that must not exist publicly, including deliberately unpublished rows. */
const hiddenRoutes = ["/photo/studio-trial", "/photo/unreleased-edit", "/gallery/studio-work"];

const forbidden = [
  { label: "field name originalStorageKey", value: "originalStorageKey" },
  { label: "private masters storage scheme", value: "r2://masters/" },
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
  }

  // Unpublished and unknown rows must stay indistinguishable publicly.
  for (const route of hiddenRoutes) {
    const response = await fetch(`${origin}${route}`);
    if (response.status !== 404) {
      failures.push(`${route} should be 404 but returned ${response.status}`);
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
}

if (failures.length > 0) {
  console.error(`Served-payload check FAILED with ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(` - ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Served-payload check passed: ${routes.length} public routes inspected, no private-master identifiers in served HTML; ` +
    `${hiddenRoutes.length} hidden routes return 404; ` +
    `${protectedCases.length} operator-route cases enforced the expected 401/403/200 boundary.`,
);
