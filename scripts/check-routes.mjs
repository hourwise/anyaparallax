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
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  ["/admin", /route\(\s*["']admin["']\s*,\s*["']routes\/admin\/dashboard\.tsx["']\s*\)/],
  ["/admin/photos", /route\(\s*["']admin\/photos["']\s*,\s*["']routes\/admin\/photos\.tsx["']\s*\)/],
  ["/admin/upload", /route\(\s*["']admin\/upload["']\s*,\s*["']routes\/admin\/upload\.tsx["']\s*\)/],
  ["/admin/galleries", /route\(\s*["']admin\/galleries["']\s*,\s*["']routes\/admin\/galleries\.tsx["']\s*\)/],
  ["/admin/settings", /route\(\s*["']admin\/settings["']\s*,\s*["']routes\/admin\/settings\.tsx["']\s*\)/],
  ["/admin/*", /route\(\s*["']admin\/\*["']\s*,\s*["']routes\/admin\/not-found\.tsx["']\s*\)/],
  ["/manager", /route\(\s*["']manager["']\s*,\s*["']routes\/manager\/dashboard\.tsx["']\s*\)/],
  [
    "/manager/diagnostics",
    /route\(\s*["']manager\/diagnostics["']\s*,\s*["']routes\/manager\/diagnostics\.tsx["']\s*\)/,
  ],
  [
    "/manager/settings",
    /route\(\s*["']manager\/settings["']\s*,\s*["']routes\/manager\/settings\.tsx["']\s*\)/,
  ],
  [
    "/manager/maintenance",
    /route\(\s*["']manager\/maintenance["']\s*,\s*["']routes\/manager\/maintenance\.tsx["']\s*\)/,
  ],
  ["/manager/*", /route\(\s*["']manager\/\*["']\s*,\s*["']routes\/manager\/not-found\.tsx["']\s*\)/],
  ["catch-all not-found", /route\(\s*["']\*["']\s*,\s*["']routes\/not-found\.tsx["']\s*\)/],
];

const requiredMarkers = [
  ["app/entry.server.tsx", "handleRequest"],
  ["workers/app.ts", "virtual:react-router/server-build"],
  ["workers/app.ts", "RouterContextProvider"],
  ["wrangler.jsonc", "\"./workers/app.ts\""],
  ["wrangler.jsonc", "\"DB\""],
  ["wrangler.jsonc", "\"MASTERS\""],
  ["wrangler.jsonc", "\"IMAGES\""],
  // Slice 05 authentication boundary.
  ["wrangler.jsonc", "ALLOW_DEVELOPMENT_IDENTITY"],
  ["app/auth/identity.server.ts", "verifyAccessToken"],
  ["app/auth/identity.server.ts", "isLoopbackHostname"],
  ["app/auth/accounts.server.ts", "findAccountByEmail"],
  ["app/auth/authorization.server.ts", "requireManagerAccess"],
  ["app/layouts/admin.tsx", "requireAdminAccess"],
  ["app/layouts/manager.tsx", "requireManagerAccess"],
  ["app/routes/admin/dashboard.tsx", "requireAdminAccess"],
  ["app/routes/admin/upload.tsx", "requireAdminAccess"],
  ["app/routes/manager/diagnostics.tsx", "requireManagerAccess"],
  ["app/data/diagnostics.server.ts", "loadManagerDiagnostics"],
  // Slice 03 data boundary: public pages must read through the query layer.
  ["app/routes/galleries.tsx", "listPublishedGalleries"],
  ["app/routes/gallery.tsx", "getPublishedGallery"],
  ["app/routes/photo.tsx", "getPhotoDetail"],
  ["app/routes/home.tsx", "listFeaturedWithGallery"],
  ["app/data/queries.ts", "repositoryFor"],
  ["app/data/model.ts", "PhotoRecord"],
  // Slice 04 storage plumbing.
  ["app/data/storage.ts", "MASTERS_SCHEME"],
  ["app/data/storage.server.ts", "putMaster"],
  ["app/data/repository.d1.server.ts", "D1PortfolioRepository"],
  ["app/data/repository.seed.server.ts", "SeedPortfolioRepository"],
  ["app/data/repository.ts", "interface PortfolioRepository"],
  ["migrations/0001_initial_schema.sql", "CREATE TABLE IF NOT EXISTS photos"],
  ["migrations/0001_initial_schema.sql", "original_storage_key"],
  ["migrations/0001_initial_schema.sql", "CREATE TABLE IF NOT EXISTS users"],
  // Slice 05 repair 01: one case-insensitive identity per authorised email.
  [
    "migrations/0002_user_email_identity_uniqueness.sql",
    "CREATE UNIQUE INDEX idx_users_email_identity_nocase",
  ],
  ["migrations/0002_user_email_identity_uniqueness.sql", "COLLATE NOCASE"],
  ["app/auth/accounts.ts", "ACCOUNT_BY_EMAIL_SQL"],
  ["app/auth/accounts.ts", "soleAccount"],
  ["app/auth/accounts.server.ts", "ACCOUNT_BY_EMAIL_SQL"],
  // Slice 06: upload pipeline and public derivative serving.
  ["app/images/upload-validation.ts", "validateUpload"],
  ["app/images/codecs.ts", "decodeImage"],
  ["app/images/watermark.ts", "applyWatermark"],
  ["app/images/process.ts", "processUpload"],
  ["app/images/upload.server.ts", "ingestUploads"],
  ["app/images/media.server.ts", "serveMedia"],
  ["app/routes/media.ts", "serveMedia"],
  ["app/routes/admin/upload.tsx", "ingestUploads"],
  ["app/data/storage.ts", "PUBLIC_MEDIA_PREFIX"],
];

/**
 * Gallery and photograph content must come from the data layer, so these route
 * modules must not embed collection names or media paths directly.
 */
const forbiddenContent = [
  ["app/routes/galleries.tsx", /"(Nightlife|Live Music|Cityscapes|Black & White)"/],
  ["app/routes/gallery.tsx", /\/images\/dev\//],
  ["app/routes/photo.tsx", /\/images\/dev\//],
];

/**
 * Persistence code, the private bucket binding, the master storage scheme and
 * raw identity verification must never be imported by a route module, a layout
 * or a shared component: route modules and layouts are bundled for the browser,
 * and authorization decisions go through `app/auth/authorization.server.ts`.
 */
const forbiddenImports = [
  [/repository\.d1\.server/, "the D1 repository"],
  [/storage\.server/, "R2 storage access"],
  [/\bMASTERS\b/, "the private bucket binding"],
  [/originalStorageKey/, "the private master key"],
  [/identity\.server/, "raw identity verification"],
];

/** Collected failures; declared before the scans below so they can push to it. */
const failures = [];

/** Client-bundled components must not import any `.server` module at all. */
const serverImportPattern = /from\s+["'][^"']*\.server(?:\.[cm]?[jt]s)?["']/;

for (const directory of ["app/routes", "app/components", "app/layouts"]) {
  const entries = existsSync(resolve(root, directory))
    ? readdirSync(resolve(root, directory), { recursive: true })
    : [];
  for (const entry of entries) {
    const name = String(entry);
    if (!/\.tsx?$/.test(name)) {
      continue;
    }
    const filePath = resolve(root, directory, name);
    const source = readFileSync(filePath, "utf8");
    for (const [pattern, label] of forbiddenImports) {
      if (pattern.test(source)) {
        failures.push(`${directory}/${name} references ${label}`);
      }
    }
    if (directory === "app/components" && serverImportPattern.test(source)) {
      failures.push(`${directory}/${name} imports a server-only module`);
    }
  }
}

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
    [...routesSource.matchAll(/["']((?:routes|layouts)\/[A-Za-z0-9._/-]+\.tsx?)["']/g)].map(
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

for (const [file, pattern] of forbiddenContent) {
  const filePath = resolve(root, file);
  if (!existsSync(filePath)) {
    failures.push(`${file} is missing`);
    continue;
  }
  if (pattern.test(readFileSync(filePath, "utf8"))) {
    failures.push(
      `${file} embeds content that must come from the data layer (${pattern.source})`,
    );
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
