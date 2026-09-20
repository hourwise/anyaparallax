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
  // Slice 08: the print enquiry path and its separate acknowledgement routes.
  [
    "/prints/enquire",
    /route\(\s*["']prints\/enquire["']\s*,\s*["']routes\/prints\.enquire\.tsx["']\s*\)/,
  ],
  [
    "/prints/enquire/received",
    /route\(\s*["']prints\/enquire\/received["']\s*,\s*["']routes\/prints\.enquire\.received\.tsx["']\s*\)/,
  ],
  ["/contact", /route\(\s*["']contact["']\s*,\s*["']routes\/contact\.tsx["']\s*\)/],
  [
    "/contact/received",
    /route\(\s*["']contact\/received["']\s*,\s*["']routes\/contact\.received\.tsx["']\s*\)/,
  ],
  ["/admin", /route\(\s*["']admin["']\s*,\s*["']routes\/admin\/dashboard\.tsx["']\s*\)/],
  ["/admin/photos", /route\(\s*["']admin\/photos["']\s*,\s*["']routes\/admin\/photos\.tsx["']\s*\)/],
  // REPAIR-09B: the per-photograph editor.
  [
    "/admin/photos/:photoId",
    /route\(\s*["']admin\/photos\/:photoId["']\s*,\s*["']routes\/admin\/photos\.\$photoId\.tsx["']\s*\)/,
  ],
  ["/admin/upload", /route\(\s*["']admin\/upload["']\s*,\s*["']routes\/admin\/upload\.tsx["']\s*\)/],
  ["/admin/galleries", /route\(\s*["']admin\/galleries["']\s*,\s*["']routes\/admin\/galleries\.tsx["']\s*\)/],
  [
    "/admin/enquiries",
    /route\(\s*["']admin\/enquiries["']\s*,\s*["']routes\/admin\/enquiries\.tsx["']\s*\)/,
  ],
  ["/admin/prints", /route\(\s*["']admin\/prints["']\s*,\s*["']routes\/admin\/prints\.tsx["']\s*\)/],
  ["/admin/settings", /route\(\s*["']admin\/settings["']\s*,\s*["']routes\/admin\/settings\.tsx["']\s*\)/],
  // REPAIR-09D: crawler policy, as resource routes outside every layout.
  ["/robots.txt", /route\(\s*["']robots\.txt["']\s*,\s*["']routes\/robots\.txt\.ts["']\s*\)/],
  ["/sitemap.xml", /route\(\s*["']sitemap\.xml["']\s*,\s*["']routes\/sitemap\.xml\.ts["']\s*\)/],
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
  ["app/images/upload-validation.ts", "assertBatchWithinPolicy"],
  ["app/images/image-processor.ts", "ImageProcessor"],
  ["app/images/image-processor.ts", "drawRequestFor"],
  ["app/images/image-processor.cloudflare.server.ts", "createCloudflareImageProcessor"],
  ["app/images/image-processor.cloudflare.server.ts", "scale-down"],
  ["app/images/watermark-asset.ts", "developmentWatermarkOverlay"],
  ["app/images/process.ts", "processUpload"],
  ["app/images/upload.server.ts", "ingestUploads"],
  ["app/images/media.server.ts", "serveMedia"],
  ["app/images/media-publication.server.ts", "isPublishedDerivative"],
  ["app/data/storage.server.ts", "deleteMaster"],
  ["app/routes/media.ts", "serveMedia"],
  ["app/routes/admin/upload.tsx", "ingestUploads"],
  ["app/data/storage.ts", "PUBLIC_MEDIA_PREFIX"],
  // Slice 07A: the public image delivery boundary and the projection that uses it.
  ["app/data/storage.ts", "publicImagePathFrom"],
  ["app/data/project.ts", "publicImagePathFrom"],
  ["app/data/model.ts", "webImagePath"],
  ["app/data/model.ts", "thumbnailImagePath"],
  ["app/components/PhotoFigure.tsx", "photo-figure__image--unavailable"],
  // The production processor must be the platform binding, not a local codec.
  ["wrangler.jsonc", "IMAGE_TRANSFORMS"],
  // Slice 07: engagement, sharing and the canonical/social metadata boundary.
  ["app/engagement/engagement.ts", "SHARE_CHANNELS"],
  ["app/engagement/identifier.ts", "isEngagementIdentifier"],
  ["app/engagement/anonymous-browser.server.ts", "crypto.randomUUID"],
  ["app/engagement/anonymous-browser.server.ts", "SHA-256"],
  ["app/engagement/anonymous-browser.server.ts", "SameSite=Lax"],
  ["app/engagement/engagement.server.ts", "likePhoto"],
  ["app/engagement/store.server.ts", "INSERT OR IGNORE"],
  ["app/engagement/share.ts", "shareUrlFor"],
  ["app/engagement/metadata.ts", "webImagePath"],
  ["app/engagement/metadata.ts", "summary_large_image"],
  ["app/data/canonical-origin.ts", "DEFAULT_PUBLIC_SITE_ORIGIN"],
  ["app/components/EngagementControls.tsx", "EngagementControls"],
  ["app/routes/engagement.$slug.tsx", "recordShare"],
  ["app/routes/photo.tsx", "EngagementControls"],
  ["wrangler.jsonc", "PUBLIC_SITE_ORIGIN"],
  // Slice 08: print eligibility, the enquiry path, and the honest no-commerce rule.
  ["migrations/0003_enquiry_preferences.sql", "idx_enquiries_submission_token"],
  ["migrations/0003_enquiry_preferences.sql", "print_format"],
  ["app/data/repository.ts", "listPrintEligible"],
  ["app/data/repository.d1.server.ts", "print_available = 1"],
  ["app/data/queries.ts", "listPrintEligiblePhotos"],
  ["app/enquiries/enquiry.ts", "PRINT_ENQUIRY_CATEGORY"],
  ["app/enquiries/enquiry.ts", "FORBIDDEN_COMMERCE_CLAIMS"],
  ["app/enquiries/validation.ts", "validateEnquiry"],
  ["app/enquiries/store.server.ts", "eligiblePhotoFor"],
  ["app/enquiries/store.server.ts", "INSERT OR IGNORE"],
  ["app/enquiries/enquiries.server.ts", "submitEnquiry"],
  ["app/enquiries/print-eligibility.server.ts", "setPhotoPrintAvailable"],
  ["app/components/EnquiryForm.tsx", "submissionToken"],
  ["app/components/EnquiryAcknowledgement.tsx", "acknowledgementBody"],
  ["app/routes/prints.enquire.received.tsx", "noindex, nofollow"],
  ["app/routes/contact.received.tsx", "noindex, nofollow"],
  ["app/routes/prints.tsx", "listPrintEligiblePhotos"],
  ["app/routes/prints.enquire.tsx", "submitEnquiry"],
  ["app/routes/contact.tsx", "submitEnquiry"],
  ["app/routes/photo.tsx", "printEnquiryPathForPhoto"],
  ["app/routes/admin/enquiries.tsx", "requireAdminAccess"],
  ["app/routes/admin/enquiries.tsx", "readEnquiries"],
  ["app/routes/admin/prints.tsx", "requireAdminAccess"],
  ["app/routes/admin/prints.tsx", "setPhotoPrintAvailable"],
  ["app/layouts/admin.tsx", "/admin/enquiries"],
  // REPAIR-09B: bounded photograph management and the withdrawal mechanism. The
  // vocabulary and validation are pure so the operator screens can import them; the
  // database layer is separate, which is what the build enforces.
  ["app/data/photo-management.ts", "PHOTO_FIELD_LIMITS"],
  ["app/data/photo-management.ts", "REFUSED_STORAGE_FIELDS"],
  ["app/data/photo-management.ts", "validatePhotoMetadata"],
  ["app/data/photo-management.server.ts", "updatePhoto"],
  ["app/data/photo-management.server.ts", "setPublication"],
  ["app/data/photo-management.server.ts", "setFeatured"],
  ["app/data/photo-management.server.ts", "photoManagerFor"],
  ["app/routes/admin/photos.tsx", "requireAdminAccess"],
  ["app/routes/admin/photos.tsx", "setPublication"],
  ["app/routes/admin/photos.tsx", "parsePhotoIntent"],
  ["app/routes/admin/photos.$photoId.tsx", "requireAdminAccess"],
  ["app/routes/admin/photos.$photoId.tsx", "storageFieldsIn"],
  ["app/routes/admin/photos.$photoId.tsx", "updatePhoto"],
  ["app/layouts/admin.tsx", '"/admin/photos"'],
  // REPAIR-09D: abuse resistance, enquiry visibility and crawler policy.
  ["app/enquiries/abuse-guard.ts", "screenEnquirySubmission"],
  ["app/enquiries/abuse-guard.ts", "FORM_TRAP_FIELD"],
  ["app/enquiries/abuse-guard.ts", "MIN_FORM_FILL_MS"],
  ["app/lib/request-bound.ts", "checkRequestSize"],
  ["app/components/EnquiryForm.tsx", "FORM_TRAP_FIELD"],
  ["app/components/EnquiryForm.tsx", "FORM_ISSUED_AT_FIELD"],
  ["app/routes/contact.tsx", "screenEnquirySubmission"],
  ["app/routes/prints.enquire.tsx", "screenEnquirySubmission"],
  ["app/routes/engagement.$slug.tsx", "checkRequestSize"],
  ["app/routes/admin/dashboard.tsx", "readEnquiryCounts"],
  ["app/routes/robots.txt.ts", "Sitemap:"],
  ["app/routes/sitemap.xml.ts", "listPublishedPhotos"],
  ["app/routes/sitemap.xml.ts", "escapeXml"],
  // REPAIR-09E: every MUTATING operator action carries the same-origin guard, and
  // the guard has exactly one home. Authentication and CSRF are different concerns,
  // so a new admin action that authenticates but forgets its origin check fails
  // here as well as in the served check.
  ["app/lib/same-origin.ts", "isSameOriginRequest"],
  ["app/lib/same-origin.ts", "refuseCrossOriginRequest"],
  ["app/routes/admin/photos.tsx", "isSameOriginRequest"],
  ["app/routes/admin/photos.$photoId.tsx", "isSameOriginRequest"],
  ["app/routes/admin/upload.tsx", "isSameOriginRequest"],
  ["app/routes/admin/enquiries.tsx", "isSameOriginRequest"],
  ["app/routes/admin/prints.tsx", "isSameOriginRequest"],
  ["app/components/SiteFooter.tsx", "showDevelopmentNotices"],
];

/**
 * A private master must never be able to become a social preview image.
 *
 * The metadata module is the ONLY place a stored reference is turned into a URL a
 * crawler would fetch, so it must contain no reference to the private domain and
 * no fallback that could reach it. Its own checks prove the behaviour; this proves
 * the module has no private vocabulary to begin with.
 */
const privateFreeModules = [
  ["app/engagement/metadata.ts", /r2:\/\/masters|originalStorageKey|original_storage_key/],
  ["app/routes/photo.tsx", /r2:\/\/masters|originalStorageKey|original_storage_key/],
  // Slice 07A: the public projection is the boundary that converts stored
  // references, so it must contain no private vocabulary of its own.
  ["app/data/project.ts", /r2:\/\/masters|originalStorageKey|original_storage_key/],
  // Slice 08: every new public surface that renders a photograph is held to the
  // same rule, so the print page cannot acquire a private reference either.
  ["app/routes/prints.tsx", /r2:\/\/masters|originalStorageKey|original_storage_key/],
  ["app/components/EnquiryForm.tsx", /r2:\/\/masters|originalStorageKey|original_storage_key/],
];

/**
 * Slice 08: features that exist only for a signed-in operator.
 *
 * The enquiry list contains customers' names and email addresses, and the print
 * eligibility list is an editorial tool. Neither may be reachable from a public
 * route module, so no route outside `admin/` may name them at all. This is the
 * structural half of "customer details never appear in public loader data": a
 * public loader that cannot call the reader cannot return what it reads.
 */
const operatorOnlySymbols = [
  "readEnquiries",
  "updateEnquiryStatus",
  "readEnquiryCounts",
  "listPhotoPrintOptions",
  "setPhotoPrintAvailable",
];

/**
 * A public component or route must never render a raw storage reference.
 *
 * This is the Slice 07A defect stated as a rule. `src={item.thumbnailStorageKey}`
 * is exactly how an internal `r2://` reference reached browser markup; the public
 * projection now produces `webImagePath` / `thumbnailImagePath`, and this scan
 * refuses the shapes that bypassed it so a future component cannot quietly
 * reintroduce one. It runs over every route, layout and component.
 */
const storageKeyRenderPattern =
  /src=\{[^}]*[Ss]torageKey[^}]*\}|href=\{[^}]*[Ss]torageKey[^}]*\}|src=\{["'`]r2:\/\//;

/**
 * Gallery and photograph content must come from the data layer, so these route
 * modules must not embed collection names or media paths directly.
 */
const forbiddenContent = [
  ["app/routes/galleries.tsx", /"(Nightlife|Live Music|Cityscapes|Black & White)"/],
  ["app/routes/gallery.tsx", /\/images\/dev\//],
  ["app/routes/photo.tsx", /\/images\/dev\//],
  // Slice 08: the print page renders photographs through the projection too, so it
  // must not carry a development asset path of its own.
  ["app/routes/prints.tsx", /\/images\/dev\//],
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

/**
 * Source with comments removed, so a scan tests the CODE rather than its prose.
 *
 * This matters in both directions. A file that explains why it does NOT import
 * something would otherwise be accused of importing it, and — worse — a scan that
 * matched comments could be satisfied by describing the rule instead of following
 * it.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

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
    const source = stripComments(readFileSync(filePath, "utf8"));
    for (const [pattern, label] of forbiddenImports) {
      if (pattern.test(source)) {
        failures.push(`${directory}/${name} references ${label}`);
      }
    }
    if (directory === "app/components" && serverImportPattern.test(source)) {
      failures.push(`${directory}/${name} imports a server-only module`);
    }
    if (storageKeyRenderPattern.test(source)) {
      failures.push(
        `${directory}/${name} renders a storage reference into a browser attribute; use the public projection's image path`,
      );
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

// --- Slice 08: the operator-only enquiry features stay operator-only --------

for (const directory of ["app/routes"]) {
  for (const entry of readdirSync(resolve(root, directory), { recursive: true })) {
    const name = String(entry).replace(/\\/g, "/");
    if (!/\.tsx?$/.test(name) || name.startsWith("admin/")) {
      continue;
    }
    const source = stripComments(readFileSync(resolve(root, directory, name), "utf8"));
    for (const symbol of operatorOnlySymbols) {
      if (new RegExp(`\\b${symbol}\\b`).test(source)) {
        failures.push(
          `${directory}/${name} names the operator-only enquiry feature ${symbol}; ` +
            "customer enquiry data must not be reachable from a public route",
        );
      }
    }
  }
}

for (const [file, pattern] of privateFreeModules) {
  const filePath = resolve(root, file);
  if (!existsSync(filePath)) {
    failures.push(`${file} is missing`);
    continue;
  }
  if (pattern.test(stripComments(readFileSync(filePath, "utf8")))) {
    failures.push(
      `${file} names a private master reference (${pattern.source}); social metadata must only ever use the public derivative`,
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
