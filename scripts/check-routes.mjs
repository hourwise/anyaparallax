#!/usr/bin/env node
/**
 * Dependency-free structural check for the Slice 01 route skeleton.
 *
 * It verifies that `app/routes.ts` still declares every required public,
 * protected-placeholder and not-found route, that every module referenced by
 * the route manifest exists, and that a few Slice 01 markers are intact. It
 * needs no installed packages, so it can run even when the registry is
 * unreachable.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const requiredRouteEntries = [
  ["index route for /", /index\(\s*["']routes\/home\.tsx["']\s*\)/],
  ["/galleries", /route\(\s*["']galleries["']\s*,\s*["']routes\/galleries\.tsx["']\s*\)/],
  ["/gallery/:slug", /route\(\s*["']gallery\/:slug["']\s*,\s*["']routes\/gallery\.tsx["']\s*\)/],
  ["/photo/:slug", /route\(\s*["']photo\/:slug["']\s*,\s*["']routes\/photo\.tsx["']\s*\)/],
  ["/about", /route\(\s*["']about["']\s*,\s*["']routes\/about\.tsx["']\s*\)/],
  ["/prints", /route\(\s*["']prints["']\s*,\s*["']routes\/prints\.tsx["']\s*\)/],
  ["/contact", /route\(\s*["']contact["']\s*,\s*["']routes\/contact\.tsx["']\s*\)/],
  ["/admin", /route\(\s*["']admin["']\s*,\s*["']routes\/admin\.tsx["']\s*\)/],
  ["/manager", /route\(\s*["']manager["']\s*,\s*["']routes\/manager\.tsx["']\s*\)/],
  ["catch-all not-found", /route\(\s*["']\*["']\s*,\s*["']routes\/not-found\.tsx["']\s*\)/],
];

const requiredMarkers = [
  ["app/entry.server.tsx", "handleRequest"],
  ["workers/app.ts", "virtual:react-router/server-build"],
  ["wrangler.jsonc", "\"./workers/app.ts\""],
  ["app/routes/admin.tsx", "Slice 05"],
  ["app/routes/manager.tsx", "Slice 05"],
];

const failures = [];

const routesPath = resolve(root, "app/routes.ts");
if (!existsSync(routesPath)) {
  failures.push("app/routes.ts is missing");
} else {
  const routesSource = readFileSync(routesPath, "utf8");

  for (const [label, pattern] of requiredRouteEntries) {
    if (!pattern.test(routesSource)) {
      failures.push(`app/routes.ts is missing the ${label} route entry`);
    }
  }

  const referenced = new Set(
    [...routesSource.matchAll(/["']((?:routes|layouts)\/[A-Za-z0-9._-]+\.tsx?)["']/g)].map(
      (match) => match[1],
    ),
  );

  for (const file of referenced) {
    if (!existsSync(resolve(root, "app", file))) {
      failures.push(`app/routes.ts references app/${file}, which does not exist`);
    }
  }

  if (referenced.size === 0) {
    failures.push("app/routes.ts does not reference any route modules");
  }
}

for (const [file, marker] of requiredMarkers) {
  const filePath = resolve(root, file);
  if (!existsSync(filePath)) {
    failures.push(`${file} is missing`);
    continue;
  }
  if (!readFileSync(filePath, "utf8").includes(marker)) {
    failures.push(`${file} does not contain the expected marker ${JSON.stringify(marker)}`);
  }
}

if (failures.length > 0) {
  console.error("Route skeleton check FAILED");
  for (const failure of failures) {
    console.error(` - ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Route skeleton check passed: ${requiredRouteEntries.length} required route entries and all referenced modules verified.`,
);
