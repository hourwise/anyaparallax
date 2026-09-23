#!/usr/bin/env node
/**
 * V1 completion served check.
 *
 * Proves, over real HTTP against the real application and the real local database, the
 * behaviour of the surfaces this slice completed: gallery management, workspace settings
 * and tags, manager account management and the integrity report — plus the publication
 * invariant they share, the same-origin/CSRF boundary on every new mutating action, the
 * server-side upload metadata contract (APV1-03), the narrow-width styles and the removal
 * of obsolete operator copy from finished surfaces.
 *
 * Local only: Wrangler's local D1, loopback HTTP, no external service.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { withWorkerVariables } from "./dev-vars.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 4195;
const origin = `http://[::1]:${port}`;
const HOSTILE_ORIGIN = "https://evil.example";

register("../ts-extension-hooks.mjs", import.meta.url);
const { seed } = await import("../../app/data/seed.ts");
const { migrateLocalD1, queryLocalD1, seedLocalD1 } = await import("./local-d1.mjs");

await migrateLocalD1();
await seedLocalD1(seed);

const IDENTITY_HEADER = "x-anyaparallax-development-identity";
const PHOTOGRAPHER = "photographer@anyaparallax.test";
const MANAGER = "manager@anyaparallax.test";

const failures = [];
function check(condition, message) {
  if (condition) {
    console.log(`ok   | ${message}`);
  } else {
    failures.push(message);
    console.log(`FAIL | ${message}`);
  }
}

const restoreWorkerVariables = withWorkerVariables({ SHOW_DEVELOPMENT_NOTICES: "false" });

const server = spawn(
  "node",
  [resolve(root, "node_modules", "vite", "bin", "vite.js"), "dev", "--port", String(port)],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += chunk.toString()));
server.stderr.on("data", (chunk) => (serverOutput += chunk.toString()));

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

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * A form POST as the operator's own browser sends it: same-origin by default.
 *
 * The cross-site cases opt OUT explicitly (`origin: null`, or a hostile value), because
 * the boundary itself is proved by the dedicated operator CSRF check — here the point is
 * the behaviour of the completed surfaces.
 */
function postForm(path, fields, { identity = PHOTOGRAPHER, origin: requestOrigin = origin, ...originHeaders } = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    body.append(key, String(value));
  }
  return fetch(`${origin}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(identity === null ? {} : { [IDENTITY_HEADER]: identity }),
      ...(requestOrigin === null ? {} : { origin: requestOrigin }),
      ...originHeaders,
    },
    body: body.toString(),
  });
}

/** An upload exactly as the operator's own form sends it. */
function postUpload(
  path,
  fields,
  { identity = PHOTOGRAPHER, origin: requestOrigin = origin, withFile = true, ...originHeaders } = {},
) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    body.append(key, String(value));
  }
  if (withFile) {
    body.append(
      "photos",
      new Blob([new Uint8Array(readFileSync(resolve(root, "scripts", "fixtures", "photo.jpg")))], {
        type: "image/jpeg",
      }),
      "photo.jpg",
    );
  }
  return fetch(`${origin}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      ...(identity === null ? {} : { [IDENTITY_HEADER]: identity }),
      ...(requestOrigin === null ? {} : { origin: requestOrigin }),
      ...originHeaders,
    },
    body,
  });
}

function getAs(path, identity) {
  return fetch(`${origin}${path}`, {
    redirect: "manual",
    headers: identity === null ? {} : { [IDENTITY_HEADER]: identity },
  });
}

async function photoCount() {
  return (await queryLocalD1("SELECT COUNT(*) AS total FROM photos"))[0]?.total ?? 0;
}

/**
 * The local object stores, measured exactly as the operator CSRF check measures them: by
 * counting what Wrangler's local R2 state holds.
 */
const IMAGES_BLOBS = resolve(root, ".wrangler", "state", "v3", "r2", "anyaparallax-images-dev", "blobs");
const MASTERS_BLOBS = resolve(root, ".wrangler", "state", "v3", "r2", "anyaparallax-masters-dev", "blobs");

function storedObjects(directory) {
  return existsSync(directory) ? readdirSync(directory, { recursive: true }).length : null;
}

/**
 * Everything a refused upload must leave untouched: the D1 photograph rows (including their
 * storage keys) and BOTH local object stores. Asserting only "no new row" would pass even if
 * the request had written an object before failing, which is exactly the state a refusal must
 * not leave behind.
 */
async function uploadStateDigest() {
  const rows = await queryLocalD1(
    "SELECT id, title, gallery_id, published, original_storage_key, web_storage_key, thumbnail_storage_key FROM photos ORDER BY id",
  );
  return JSON.stringify({
    rows,
    images: storedObjects(IMAGES_BLOBS),
    masters: storedObjects(MASTERS_BLOBS),
  });
}

try {
  if (!(await waitForServer())) {
    console.error("dev server did not start");
    console.error(serverOutput.slice(-3000));
    await shutdown();
    restoreWorkerVariables();
    process.exit(1);
  }

  // --- A. Structure of the completed surfaces -----------------------------

  const routesSource = readFileSync(resolve(root, "app", "routes.ts"), "utf8");
  check(routesSource.includes('route("privacy", "routes/privacy.tsx")'), "the privacy route is not registered");
  for (const file of [
    "app/data/gallery-management.ts",
    "app/data/gallery-management.server.ts",
    "app/data/site-settings.ts",
    "app/data/site-settings.server.ts",
    "app/data/taxonomy.ts",
    "app/data/taxonomy.server.ts",
    "app/data/maintenance.server.ts",
    "app/auth/user-management.ts",
    "app/auth/user-management.server.ts",
    "app/engagement/insights.server.ts",
    "app/routes/privacy.tsx",
  ]) {
    check(
      (() => {
        try {
          readFileSync(resolve(root, file), "utf8");
          return true;
        } catch {
          return false;
        }
      })(),
      `${file} is missing`,
    );
  }
  // No finished surface may still render the placeholder component.
  for (const file of [
    "app/routes/admin/galleries.tsx",
    "app/routes/admin/settings.tsx",
    "app/routes/manager/settings.tsx",
    "app/routes/manager/maintenance.tsx",
  ]) {
    check(
      !readFileSync(resolve(root, file), "utf8").includes("PlaceholderNotice"),
      `${file} still renders the placeholder notice`,
    );
  }

  // --- B. Public chrome: credit, privacy, social ---------------------------------

  const home = await (await fetch(`${origin}/`)).text();
  check(
    home.includes('href="https://pcgsoft.co.uk"') && home.includes("PCGSoft"),
    "the footer does not carry the PCGSoft credit link",
  );
  check(home.includes("Built by"), "the footer does not carry the build credit wording");
  check(home.includes('href="/privacy"'), "the footer does not link to the privacy notice");
  const privacy = await (await getAs("/privacy", null)).text();
  check(
    (await getAs("/privacy", null)).status === 200 && privacy.includes("Privacy"),
    "the privacy page is not served",
  );
  check(
    privacy.includes("Details still to be confirmed"),
    "the privacy page does not mark the operator-supplied facts",
  );
  const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
  check(sitemap.includes("/privacy"), "the sitemap omits the privacy page");
  check(
    !home.includes('class="footer__social"'),
    "the footer renders social chrome although no profiles are configured",
  );

  // --- C. Gallery management -----------------------------------------------

  const created = await postForm("/admin/galleries", {
    intent: "create",
    name: "V1 Completion Gallery",
    description: "Created by the served check.",
    displayOrder: "",
    published: "draft",
  });
  const createdBody = await created.text();
  check(created.status === 200 && /Created/.test(createdBody), "creating a gallery did not report success");
  const gallery = (
    await queryLocalD1("SELECT * FROM galleries WHERE name = 'V1 Completion Gallery' LIMIT 1")
  )[0];
  check(Boolean(gallery), "the created gallery is not in the database");
  check(gallery?.slug === "v1-completion-gallery", `the gallery slug is ${gallery?.slug}`);
  check(gallery?.published === 0, "a gallery asked to start as a draft was published");

  // A second gallery with the same name must get a distinct slug rather than fail.
  await (
    await postForm("/admin/galleries", {
      intent: "create",
      name: "V1 Completion Gallery",
      description: "",
      displayOrder: "7",
      published: "published",
    })
  ).text();
  const duplicates = await queryLocalD1(
    "SELECT slug, display_order, published FROM galleries WHERE name = 'V1 Completion Gallery' ORDER BY slug",
  );
  check(duplicates.length === 2, `expected two galleries with the same name, found ${duplicates.length}`);
  check(
    duplicates.some((row) => row.slug === "v1-completion-gallery-2"),
    `the colliding name did not receive a suffixed slug: ${JSON.stringify(duplicates.map((r) => r.slug))}`,
  );

  // Edit: name, description and order, with the slug deliberately unchanged.
  const edited = await postForm("/admin/galleries", {
    intent: "update",
    galleryId: gallery.id,
    name: "V1 Completion Gallery Renamed",
    description: "Edited by the served check.",
    displayOrder: "3",
    published: "draft",
  });
  check(edited.status === 200, `editing a gallery returned ${edited.status}`);
  await edited.text();
  const renamed = (await queryLocalD1(`SELECT * FROM galleries WHERE id = ${quote(gallery.id)}`))[0];
  check(renamed?.name === "V1 Completion Gallery Renamed", "the gallery rename did not persist");
  check(renamed?.description === "Edited by the served check.", "the gallery description did not persist");
  check(renamed?.display_order === 3, `the display order is ${renamed?.display_order}`);
  check(renamed?.slug === "v1-completion-gallery", "renaming a gallery changed its public slug");

  // Publication, and the public consequence.
  await (
    await postForm("/admin/galleries", { intent: "publish", galleryId: gallery.id })
  ).text();
  check(
    (await queryLocalD1(`SELECT published FROM galleries WHERE id = ${quote(gallery.id)}`))[0]
      ?.published === 1,
    "publishing a gallery did not persist",
  );
  const publicGallery = await getAs(`/gallery/${gallery.slug}`, null);
  check(publicGallery.status === 200, `the published gallery page returned ${publicGallery.status}`);
  await publicGallery.text();
  await (
    await postForm("/admin/galleries", { intent: "unpublish", galleryId: gallery.id })
  ).text();
  const withdrawn = await getAs(`/gallery/${gallery.slug}`, null);
  check(withdrawn.status === 404, `the withdrawn gallery page returned ${withdrawn.status}`);
  await withdrawn.text();

  // Covers: a photograph from ANOTHER gallery must be refused; one of its own accepted.
  const otherGalleryPhoto = (
    await queryLocalD1(
      `SELECT id, gallery_id FROM photos WHERE gallery_id <> ${quote(gallery.id)} LIMIT 1`,
    )
  )[0];
  const foreignCover = await postForm("/admin/galleries", {
    intent: "cover",
    galleryId: gallery.id,
    coverPhotoId: otherGalleryPhoto.id,
  });
  const foreignBody = await foreignCover.text();
  check(
    foreignCover.status === 200 && /not in this gallery/i.test(foreignBody),
    "a photograph from another gallery was accepted as a cover",
  );
  check(
    (await queryLocalD1(`SELECT cover_photo_id FROM galleries WHERE id = ${quote(gallery.id)}`))[0]
      ?.cover_photo_id === null,
    "a refused cover still changed the gallery",
  );

  // A gallery with no photographs may have no cover, and the screen says so rather than
  // offering an empty control.
  const emptyGalleryPage = await (await getAs("/admin/galleries", PHOTOGRAPHER)).text();
  check(
    emptyGalleryPage.includes("No photographs in this gallery yet"),
    "an empty gallery does not explain that it has no photographs to use as a cover",
  );

  // Move one seeded photograph into the new gallery through the real editor, then use it
  // as the cover: the same-gallery rule must accept it.
  const sourcePhoto = (
    await queryLocalD1("SELECT id, title, description, gallery_id FROM photos LIMIT 1")
  )[0];
  await (
    await postForm(`/admin/photos/${sourcePhoto.id}`, {
      title: sourcePhoto.title,
      description: sourcePhoto.description ?? "",
      location: "",
      captureDate: "",
      galleryId: gallery.id,
      published: "draft",
      featured: "not-featured",
    })
  ).text();
  const sameGalleryCover = await postForm("/admin/galleries", {
    intent: "cover",
    galleryId: gallery.id,
    coverPhotoId: sourcePhoto.id,
  });
  check(sameGalleryCover.status === 200, `a same-gallery cover returned ${sameGalleryCover.status}`);
  await sameGalleryCover.text();
  check(
    (await queryLocalD1(`SELECT cover_photo_id FROM galleries WHERE id = ${quote(gallery.id)}`))[0]
      ?.cover_photo_id === sourcePhoto.id,
    "a same-gallery cover did not persist",
  );

  // Publication interaction: a published photograph inside a withdrawn gallery is not public.
  await (
    await postForm("/admin/photos", { photoId: sourcePhoto.id, intent: "publish" })
  ).text();
  const photoSlug = (
    await queryLocalD1(`SELECT slug FROM photos WHERE id = ${quote(sourcePhoto.id)}`)
  )[0]?.slug;
  const photoInDraftGallery = await getAs(`/photo/${photoSlug}`, null);
  check(
    photoInDraftGallery.status === 404,
    `a published photograph in an unpublished gallery returned ${photoInDraftGallery.status}`,
  );
  await photoInDraftGallery.text();
  await (await postForm("/admin/galleries", { intent: "publish", galleryId: gallery.id })).text();
  const photoInPublishedGallery = await getAs(`/photo/${photoSlug}`, null);
  check(
    photoInPublishedGallery.status === 200,
    `the same photograph returned ${photoInPublishedGallery.status} once its gallery was published`,
  );
  await photoInPublishedGallery.text();

  // --- D. The same-origin boundary on the new actions ----------------------

  const beforeHostile = JSON.stringify(
    await queryLocalD1(`SELECT name, published FROM galleries WHERE id = ${quote(gallery.id)}`),
  );
  for (const [label, headers] of [
    ["a hostile Origin", { origin: HOSTILE_ORIGIN }],
    ["no Origin and a hostile Referer", { origin: null, referer: `${HOSTILE_ORIGIN}/admin/galleries` }],
    ["no Origin and no Referer", { origin: null }],
  ]) {
    const response = await postForm(
      "/admin/galleries",
      { intent: "unpublish", galleryId: gallery.id },
      headers,
    );
    await response.text();
    check(
      [400, 403].includes(response.status),
      `a gallery mutation with ${label} returned ${response.status}, expected a refusal`,
    );
  }
  check(
    JSON.stringify(
      await queryLocalD1(`SELECT name, published FROM galleries WHERE id = ${quote(gallery.id)}`),
    ) === beforeHostile,
    "a refused cross-site gallery mutation changed the gallery anyway",
  );

  // --- E. Workspace settings ----------------------------------------------

  const savedSettings = await postForm("/admin/settings", {
    intent: "settings",
    watermarkEnabled: "disabled",
    watermarkPosition: "center",
    "site.strapline": "Night cities and live music.",
    "site.galleries_intro": "Collections from the served check.",
    "site.about_intro": "",
    "site.contact_intro": "",
    "social.instagram": "https://www.instagram.com/example/",
    "social.facebook": "",
    "social.tiktok": "",
    "social.threads": "",
    "social.bluesky": "",
    "social.x": "",
    "social.youtube": "",
  });
  check(savedSettings.status === 200, `saving settings returned ${savedSettings.status}`);
  await savedSettings.text();
  const storedPosition = (
    await queryLocalD1("SELECT value FROM site_settings WHERE key = 'watermark.default_position'")
  )[0]?.value;
  check(storedPosition === "center", `the watermark default position stored is ${storedPosition}`);
  const storedInstagram = (
    await queryLocalD1("SELECT value FROM site_settings WHERE key = 'social.instagram'")
  )[0]?.value;
  check(
    storedInstagram === "https://www.instagram.com/example/",
    `the social profile stored is ${storedInstagram}`,
  );
  const homeWithSocial = await (await fetch(`${origin}/`)).text();
  check(
    homeWithSocial.includes('href="https://www.instagram.com/example/"'),
    "a configured social profile is not rendered in the footer",
  );
  check(
    homeWithSocial.includes("Night cities and live music."),
    "the configured strapline is not rendered",
  );
  const galleriesWithIntro = await (await getAs("/galleries", null)).text();
  check(
    galleriesWithIntro.includes("Collections from the served check."),
    "the configured galleries introduction is not rendered on the public page",
  );
  check(
    !/facebook\.com/.test(homeWithSocial),
    "an unconfigured social network rendered a link",
  );

  // An invalid profile URL is refused and writes nothing.
  const beforeInvalid = JSON.stringify(
    await queryLocalD1("SELECT value FROM site_settings WHERE key = 'social.x'"),
  );
  const invalidSocial = await postForm("/admin/settings", {
    intent: "settings",
    watermarkEnabled: "disabled",
    watermarkPosition: "center",
    "social.x": "http://not-a-real-network.example/profile",
  });
  const invalidBody = await invalidSocial.text();
  check(
    invalidSocial.status === 200 && /not a X profile|https/i.test(invalidBody),
    "an invalid social address was not refused with an explanation",
  );
  check(
    JSON.stringify(await queryLocalD1("SELECT value FROM site_settings WHERE key = 'social.x'")) ===
      beforeInvalid,
    "a refused settings save still wrote a value",
  );

  // An unknown watermark default is refused too.
  const invalidWatermark = await postForm("/admin/settings", {
    intent: "settings",
    watermarkEnabled: "sometimes",
    watermarkPosition: "diagonal",
  });
  const invalidWatermarkBody = await invalidWatermark.text();
  check(
    invalidWatermark.status === 200 &&
      /watermark position this application understands|watermarked by default/i.test(
        invalidWatermarkBody,
      ),
    "an unknown watermark default was accepted",
  );

  // Blank hides the link again.
  await (
    await postForm("/admin/settings", {
      intent: "settings",
      watermarkEnabled: "enabled",
      watermarkPosition: "bottom-right",
      "social.instagram": "",
    })
  ).text();
  check(
    !(await (await fetch(`${origin}/`)).text()).includes("instagram.com"),
    "clearing a social profile left the link on the public site",
  );

  // --- F. Tags -------------------------------------------------------------

  const tagCreate = await postForm("/admin/settings", { intent: "tag-create", name: "Served Check" });
  check(tagCreate.status === 200, `creating a tag returned ${tagCreate.status}`);
  await tagCreate.text();
  const tag = (await queryLocalD1("SELECT * FROM tags WHERE name = 'Served Check' LIMIT 1"))[0];
  check(Boolean(tag), "the created tag is not in the database");
  check(tag?.slug === "served-check", `the tag slug is ${tag?.slug}`);

  const tagRename = await postForm("/admin/settings", {
    intent: "tag-rename",
    tagId: tag.id,
    name: "Served Check Renamed",
  });
  await tagRename.text();
  check(
    (await queryLocalD1(`SELECT name FROM tags WHERE id = ${quote(tag.id)}`))[0]?.name ===
      "Served Check Renamed",
    "renaming a tag did not persist",
  );

  const tagDelete = await postForm("/admin/settings", { intent: "tag-delete", tagId: tag.id });
  await tagDelete.text();
  check(
    (await queryLocalD1(`SELECT COUNT(*) AS total FROM tags WHERE id = ${quote(tag.id)}`))[0]
      ?.total === 0,
    "deleting an unused tag did not remove it",
  );

  const usedTag = (await queryLocalD1("SELECT tag_id FROM photo_tags LIMIT 1"))[0];
  const inUseDelete = await postForm("/admin/settings", {
    intent: "tag-delete",
    tagId: usedTag.tag_id,
  });
  const inUseBody = await inUseDelete.text();
  check(
    /still use that tag/i.test(inUseBody),
    "deleting a tag that photographs use was not refused with an explanation",
  );
  check(
    (await queryLocalD1(`SELECT COUNT(*) AS total FROM tags WHERE id = ${quote(usedTag.tag_id)}`))[0]
      ?.total === 1,
    "a refused tag deletion removed the tag anyway",
  );

  // --- G. Manager accounts and maintenance ---------------------------------

  const photographerSettings = await getAs("/manager/settings", PHOTOGRAPHER);
  check(
    photographerSettings.status === 403,
    `a photographer reached manager settings with ${photographerSettings.status}`,
  );
  await photographerSettings.text();
  const photographerMaintenance = await getAs("/manager/maintenance", PHOTOGRAPHER);
  check(
    photographerMaintenance.status === 403,
    `a photographer reached maintenance with ${photographerMaintenance.status}`,
  );
  await photographerMaintenance.text();
  const photographerUserPost = await postForm(
    "/manager/settings",
    { intent: "create", email: "intruder@example.com", role: "manager" },
    { identity: PHOTOGRAPHER },
  );
  await photographerUserPost.text();
  check(
    photographerUserPost.status === 403,
    `a photographer's account-management POST returned ${photographerUserPost.status}`,
  );
  check(
    (await queryLocalD1("SELECT COUNT(*) AS total FROM users WHERE email = 'intruder@example.com'"))[0]
      ?.total === 0,
    "a refused account creation still wrote a row",
  );

  const managerSettings = await getAs("/manager/settings", MANAGER);
  const managerSettingsBody = await managerSettings.text();
  check(managerSettings.status === 200, `manager settings returned ${managerSettings.status}`);
  check(
    managerSettingsBody.includes("Authorised accounts") && managerSettingsBody.includes("Site setup"),
    "manager settings is missing its two sections",
  );
  check(
    !/cloudflareaccess\.com/.test(managerSettingsBody) && !/ACCESS_AUD/.test(managerSettingsBody),
    "manager settings exposed Access configuration values",
  );

  const addUser = await postForm(
    "/manager/settings",
    { intent: "create", email: "Served.Check@Example.com", role: "photographer" },
    { identity: MANAGER },
  );
  await addUser.text();
  const added = (
    await queryLocalD1("SELECT * FROM users WHERE email = 'served.check@example.com' LIMIT 1")
  )[0];
  check(Boolean(added), "a manager-added account was not stored (or was not lower-cased)");
  check(added?.role === "photographer" && added?.active === 1, "the added account has the wrong state");

  const invalidRole = await postForm(
    "/manager/settings",
    { intent: "create", email: "another@example.com", role: "superuser" },
    { identity: MANAGER },
  );
  const invalidRoleBody = await invalidRole.text();
  check(
    /photographer or the manager role/i.test(invalidRoleBody),
    "an invalid role was not refused with an explanation",
  );
  check(
    (await queryLocalD1("SELECT COUNT(*) AS total FROM users WHERE email = 'another@example.com'"))[0]
      ?.total === 0,
    "a refused role still created an account",
  );

  await (
    await postForm(
      "/manager/settings",
      { intent: "deactivate", userId: added.id },
      { identity: MANAGER },
    )
  ).text();
  check(
    (await queryLocalD1(`SELECT active FROM users WHERE id = ${quote(added.id)}`))[0]?.active === 0,
    "deactivating an account did not persist",
  );
  await (
    await postForm("/manager/settings", { intent: "activate", userId: added.id }, { identity: MANAGER })
  ).text();
  check(
    (await queryLocalD1(`SELECT active FROM users WHERE id = ${quote(added.id)}`))[0]?.active === 1,
    "reactivating an account did not persist",
  );

  // The last active manager cannot be removed: the seeded manager is the only one.
  const managerRow = (
    await queryLocalD1("SELECT id FROM users WHERE email = 'manager@anyaparallax.test'")
  )[0];
  const lastManager = await postForm(
    "/manager/settings",
    { intent: "deactivate", userId: managerRow.id },
    { identity: MANAGER },
  );
  const lastManagerBody = await lastManager.text();
  check(
    /no active manager/i.test(lastManagerBody),
    "deactivating the last active manager was not refused",
  );
  check(
    (await queryLocalD1(`SELECT active FROM users WHERE id = ${quote(managerRow.id)}`))[0]?.active === 1,
    "the last active manager was deactivated anyway",
  );

  const hostileUserPost = await postForm(
    "/manager/settings",
    { intent: "create", email: "hostile@example.com", role: "manager" },
    { identity: MANAGER, origin: HOSTILE_ORIGIN },
  );
  await hostileUserPost.text();
  check(
    [400, 403].includes(hostileUserPost.status),
    `a hostile-origin account creation returned ${hostileUserPost.status}, expected a refusal`,
  );
  check(
    (await queryLocalD1("SELECT COUNT(*) AS total FROM users WHERE email = 'hostile@example.com'"))[0]
      ?.total === 0,
    "a refused cross-site account creation still wrote a row",
  );

  const maintenance = await getAs("/manager/maintenance", MANAGER);
  const maintenanceBody = await maintenance.text();
  check(maintenance.status === 200, `maintenance returned ${maintenance.status}`);
  check(
    maintenanceBody.includes("Integrity checks") && maintenanceBody.includes("Image files"),
    "maintenance is missing its report sections",
  );
  for (const [label, pattern] of [
    ["a reset control", /reset database/i],
    ["a purge control", /purge all/i],
    ["a delete-all control", /delete all/i],
    ["an Access audience", /ACCESS_AUD|cloudflareaccess\.com/i],
    ["a storage key", /r2:\/\//i],
  ]) {
    check(!pattern.test(maintenanceBody), `maintenance exposes ${label}`);
  }

  // --- H. Upload metadata contract (APV1-03) -------------------------------

  const beforeUploads = await photoCount();
  const validUpload = {
    title: "Served check upload",
    description: "Validated on the server.",
    galleryId: gallery.id,
    watermarkEnabled: "on",
    watermarkPosition: "bottom-right",
    published: "on",
  };
  const stateBeforeHostile = await uploadStateDigest();
  check(
    JSON.parse(stateBeforeHostile).images !== null && JSON.parse(stateBeforeHostile).masters !== null,
    "the local object stores hold no state to compare, so the zero-mutation proof would be vacuous",
  );

  for (const [label, overrides, expectation] of [
    ["an overlong title", { title: "x".repeat(200) }, /title/i],
    ["an overlong description", { description: "x".repeat(900) }, /description/i],
    ["a malformed capture date", { captureDate: "31/02/2026" }, /capture date/i],
    ["an unknown gallery", { galleryId: "gallery-does-not-exist" }, /gallery/i],
    ["an unknown tag", { tags: "tag-does-not-exist" }, /tag/i],
    ["an unknown watermark position", { watermarkPosition: "diagonal" }, /watermark/i],
    ["a missing gallery", { galleryId: "" }, /gallery/i],
    // APV1C-05: a direct POST of a value a browser cannot send for a checkbox is REFUSED
    // rather than silently read as "false", and it creates no row.
    ["an impossible publish value", { published: "hacked" }, /publish control/i],
    ["an arbitrary featured value", { featured: "1" }, /featured control/i],
    ["an arbitrary print value", { printAvailable: "yes" }, /print-availability control/i],
  ]) {
    const before = await uploadStateDigest();
    const response = await postUpload("/admin/upload", { ...validUpload, ...overrides }, { origin });
    const body = await response.text();
    check(
      response.status === 200 && expectation.test(body),
      `an upload with ${label} was not refused with an explanation`,
    );
    check(
      (await photoCount()) === beforeUploads,
      `an upload with ${label} created a photograph anyway`,
    );
    // Zero mutation across the database AND both object stores (APV1C-05).
    const after = await uploadStateDigest();
    check(
      after === before,
      `an upload with ${label} changed the stored state (D1 rows or an object store)`,
    );
    check(
      JSON.parse(after).images === JSON.parse(before).images &&
        JSON.parse(after).masters === JSON.parse(before).masters,
      `an upload with ${label} changed MASTERS or IMAGES`,
    );
    check(
      JSON.parse(after).rows.length === JSON.parse(before).rows.length &&
        JSON.stringify(JSON.parse(after).rows) === JSON.stringify(JSON.parse(before).rows),
      `an upload with ${label} changed a D1 photograph row`,
    );
  }
  check(
    (await uploadStateDigest()) === stateBeforeHostile,
    "the malformed upload cases changed the stored state overall",
  );
  // A malformed direct POST with no file part at all is refused without a row.
  const emptyUpload = await postUpload("/admin/upload", validUpload, { origin, withFile: false });
  const emptyBody = await emptyUpload.text();
  check(
    emptyUpload.status === 200 && /choose at least one|at least one jpeg/i.test(emptyBody),
    "an upload with no file part was not refused with an explanation",
  );
  check((await photoCount()) === beforeUploads, "an upload without a file created a photograph");

  // The control: the same request WITH valid metadata is accepted, so the refusals above
  // are evidence rather than a form that never works.
  const acceptedUpload = await postUpload(
    "/admin/upload",
    { ...validUpload, title: "Served check upload accepted" },
    { origin },
  );
  const acceptedBody = await acceptedUpload.text();
  check(
    acceptedUpload.status === 200 && /accepted/i.test(acceptedBody),
    `a valid upload was not accepted (${acceptedUpload.status})`,
  );
  check((await photoCount()) === beforeUploads + 1, "a valid upload did not create exactly one photograph");

  // --- I. Narrow-width styles and copy hygiene -----------------------------

  const css = readFileSync(resolve(root, "app", "app.css"), "utf8");
  for (const [label, pattern] of [
    ["a narrow-width media query", /@media \(max-width: 640px\)/],
    ["the stacked-table rule", /\.admin-table td::before/],
    ["the data-label mechanism", /content: attr\(data-label\)/],
    ["a horizontal scroll container", /\.table-scroll\s*\{[^}]*overflow-x: auto/],
  ]) {
    check(pattern.test(css), `app.css is missing ${label}`);
  }
  const photosPage = await (await getAs("/admin/photos", PHOTOGRAPHER)).text();
  check(
    photosPage.includes('data-label="Public state"') && photosPage.includes("table-scroll"),
    "the photograph table has no narrow-width labelling",
  );

  for (const [path, identity] of [
    ["/", null],
    ["/galleries", null],
    ["/about", null],
    ["/contact", null],
    ["/prints", null],
    ["/privacy", null],
    ["/admin", PHOTOGRAPHER],
    ["/admin/photos", PHOTOGRAPHER],
    ["/admin/upload", PHOTOGRAPHER],
    ["/admin/galleries", PHOTOGRAPHER],
    ["/admin/enquiries", PHOTOGRAPHER],
    ["/admin/prints", PHOTOGRAPHER],
    ["/admin/settings", PHOTOGRAPHER],
    ["/manager", MANAGER],
    ["/manager/diagnostics", MANAGER],
    ["/manager/settings", MANAGER],
    ["/manager/maintenance", MANAGER],
  ]) {
    const response = await getAs(path, identity);
    const body = await response.text();
    check(response.status === 200, `${path} returned ${response.status}`);
    for (const [label, phrase] of [
      ["the 'Not built yet' promise", "Not built yet"],
      ["a 'later slice' reference", "later slice"],
      ["the 'This dashboard is real' aside", "This dashboard is real"],
      ["an 'arrive with' reference", "arrive with"],
      ["a 'REPAIR-' reference", "REPAIR-"],
      ["a 'Slice 0' reference", "Slice 0"],
    ]) {
      check(!body.includes(phrase), `${path} still serves ${label}`);
    }
  }
} finally {
  await shutdown();
  restoreWorkerVariables();
}

if (failures.length > 0) {
  console.error(`V1 completion check FAILED with ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
console.log(
  "V1 completion check passed: gallery management creates, renames without changing a public slug, " +
    "suffixes colliding slugs, reorders, publishes and withdraws with the public pages following, refuses a " +
    "cover from another gallery and accepts one of its own; the publication invariant still hides a published " +
    "photograph inside an unpublished gallery; workspace settings save, render a configured social profile, " +
    "hide a cleared one and refuse an invalid address or watermark default without writing; tags create, " +
    "rename, delete when unused and refuse when in use; manager settings list and manage accounts with the " +
    "last active manager protected, and stay closed to a photographer; the maintenance report checks integrity " +
    "without exposing secrets or wiring anything destructive; the upload metadata contract refuses an overlong " +
    "title or description, a malformed date, an unknown gallery or tag and an unknown watermark position while " +
    "the valid control upload succeeds; every new mutating action refuses a hostile or originless cross-site " +
    "request with no mutation; and the narrow-width table rules are present while no completed surface still " +
    "serves development copy.",
);
