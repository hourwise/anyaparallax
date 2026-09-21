#!/usr/bin/env node
/**
 * V1C bounded-repair check.
 *
 * Module-level verification of the independent-review repairs, driven against a real local
 * D1 database and in-memory buckets so no server is needed:
 *
 *   APV1C-01  the last-manager invariant lives inside the UPDATE predicate, and no
 *             interleaving of the mutations can leave zero active managers;
 *   APV1C-02  the privacy notice describes the engagement cookie that actually exists and
 *             never claims visitors receive no cookie;
 *   APV1C-03  account ids are collision-safe, and a primary-key problem is never reported
 *             as a duplicate email;
 *   APV1C-04  a storage failure degrades the object probe instead of taking the integrity
 *             report down with it;
 *   APV1C-05  checkbox controls are parsed strictly: absent is false, `on` is true, and any
 *             other submitted value is refused;
 *   APV1C-06  a social profile URL may not carry embedded credentials;
 *   APV1C-07  tag names must be names, and a duplicate display name is refused.
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

register("../ts-extension-hooks.mjs", import.meta.url);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { createD1TestDatabase } = await import("./d1-harness.mjs");
const { check, note, report } = await import("./report.mjs");
const { seed } = await import("../../app/data/seed.ts");
const { createMemoryBuckets } = await import("../../app/data/storage.server.ts");
const { UserManager } = await import("../../app/auth/user-management.server.ts");
const { maintenanceReport } = await import("../../app/data/maintenance.server.ts");
const { parseCheckbox, parseCheckboxes } = await import("../../app/lib/form-boolean.ts");
const { SOCIAL_NETWORKS, validateSocialUrl, SITE_SETTING_KEYS } = await import(
  "../../app/data/site-settings.ts"
);
const { validateTagName } = await import("../../app/data/taxonomy.ts");
const { TaxonomyManager } = await import("../../app/data/taxonomy.server.ts");
const { BROWSER_ID_COOKIE } = await import("../../app/engagement/anonymous-browser.server.ts");

const STAMP = "2026-01-01T00:00:00.000Z";

let databaseSequence = 0;

/**
 * A user-management database with exactly the rows a test needs.
 *
 * Each scenario gets its own label because the harness wipes its state directory per call
 * and two live SQLite handles over one directory cannot both be removed.
 */
function databaseWithUsers(rows) {
  databaseSequence += 1;
  return createD1TestDatabase({ seed, label: `v1c-users-${databaseSequence}` }).then((database) => {
    database.exec("DELETE FROM users");
    for (const [id, email, role, active] of rows) {
      database.exec(
        `INSERT INTO users (id, email, role, active, created_at, updated_at)
         VALUES ('${id}', '${email}', '${role}', ${active}, '${STAMP}', '${STAMP}')`,
      );
    }
    return database;
  });
}

function activeManagers(database) {
  return database.query("SELECT COUNT(*) AS total FROM users WHERE role = 'manager' AND active = 1")[0]
    ?.total;
}

// --- APV1C-01: atomic last-manager protection -------------------------------

{
  // A sole active manager cannot demote or deactivate itself.
  const sole = await databaseWithUsers([["m1", "m1@example.com", "manager", 1]]);
  const manager = new UserManager(sole.binding);
  const demote = await manager.setRole("m1", "photographer");
  check(demote.status === "last-manager", `the sole manager's demotion returned ${demote.status}`);
  check(activeManagers(sole) === 1, "the sole manager's demotion removed the last active manager");
  const deactivate = await manager.setActive("m1", false);
  check(deactivate.status === "last-manager", `the sole manager's deactivation returned ${deactivate.status}`);
  check(activeManagers(sole) === 1, "the sole manager's deactivation removed the last active manager");
  check(
    (await manager.read("m1"))?.role === "manager" && (await manager.read("m1"))?.active === true,
    "a refused mutation changed the row",
  );
  // A missing account is still reported as missing, not as a refusal.
  check((await manager.setActive("nobody", false)).status === "not-found", "an unknown id was not reported as missing");

  // One active manager plus one INACTIVE manager: the active one is still the last.
  const withInactive = await databaseWithUsers([
    ["m1", "m1@example.com", "manager", 1],
    ["m2", "m2@example.com", "manager", 0],
  ]);
  const manager2 = new UserManager(withInactive.binding);
  check(
    (await manager2.setActive("m1", false)).status === "last-manager",
    "an inactive manager was counted as a remaining active manager",
  );
  // Reactivating the second manager is always allowed and then the first may stand down.
  check((await manager2.setActive("m2", true)).status === "ok", "reactivating a manager was refused");
  check((await manager2.setActive("m1", false)).status === "ok", "standing down with a second manager was refused");
  check(activeManagers(withInactive) === 1, "two managers standing down left the wrong number active");

  // Two active managers: removing one is fine, removing the second is not.
  const two = await databaseWithUsers([
    ["m1", "m1@example.com", "manager", 1],
    ["m2", "m2@example.com", "manager", 1],
  ]);
  const manager3 = new UserManager(two.binding);
  check((await manager3.setActive("m1", false)).status === "ok", "the first of two managers could not stand down");
  check(
    (await manager3.setActive("m2", false)).status === "last-manager",
    "the second of two managers was allowed to stand down",
  );
  check(activeManagers(two) === 1, "two sequential stand-downs left no active manager");

  // Ordinary photographer changes are unaffected.
  const photographer = await databaseWithUsers([
    ["m1", "m1@example.com", "manager", 1],
    ["p1", "p1@example.com", "photographer", 1],
  ]);
  const manager4 = new UserManager(photographer.binding);
  check((await manager4.setActive("p1", false)).status === "ok", "deactivating a photographer was refused");
  check((await manager4.setActive("p1", true)).status === "ok", "reactivating a photographer was refused");
  check((await manager4.setRole("p1", "manager")).status === "ok", "promoting a photographer was refused");
  check((await manager4.setRole("p1", "photographer")).status === "ok", "demoting the second manager was refused");

  // CONCURRENT removal of the final two active managers. The local harness serialises
  // statements (SQLite), so this is a statement-level interleaving rather than true parallel
  // execution — the property it demonstrates is the one that matters: the decision and the
  // write are the SAME statement, so no interleaving can pass a check and then write.
  const race = await databaseWithUsers([
    ["m1", "m1@example.com", "manager", 1],
    ["m2", "m2@example.com", "manager", 1],
  ]);
  const manager5 = new UserManager(race.binding);
  const results = await Promise.all([manager5.setActive("m1", false), manager5.setActive("m2", false)]);
  const successes = results.filter((result) => result.status === "ok").length;
  check(successes <= 1, `both concurrent stand-downs succeeded (${successes})`);
  check(activeManagers(race) === 1, `concurrent stand-downs left ${activeManagers(race)} active manager(s)`);
  note(
    "the last-manager guard is a single conditional statement, so the concurrent case is bounded by " +
      "statement-level interleaving (the local D1 harness serialises statements); no sequence of reads and " +
      "writes can separate the decision from the write because there is no separate decision",
  );
}

// --- APV1C-03: collision-safe account ids -----------------------------------

{
  const database = await databaseWithUsers([["m1", "m1@example.com", "manager", 1]]);
  const manager = new UserManager(database.binding);
  const first = await manager.create("alice@example.com", "photographer");
  const second = await manager.create("alice@other.example", "photographer");
  check(first.status === "ok" && second.status === "ok", "two different addresses with the same local part could not both be added");
  if (first.status === "ok" && second.status === "ok") {
    const uuid = /^user-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    check(uuid.test(first.persisted.id), `the generated id is not a UUID: ${first.persisted.id}`);
    check(
      first.persisted.id !== second.persisted.id,
      "two accounts share an id because the local part was used as the key",
    );
  }
  const exact = await manager.create("alice@example.com", "manager");
  check(exact.status === "duplicate", `an exact duplicate address returned ${exact.status}`);
  const cased = await manager.create("ALICE@Example.com", "manager");
  check(cased.status === "duplicate", `a case-variant duplicate address returned ${cased.status}`);
  const punctuation = await manager.create("al.ice+tag@example.com", "photographer");
  check(punctuation.status === "ok", "a valid address with punctuation could not be added");
  check(
    (database.query("SELECT COUNT(*) AS total FROM users")[0]?.total ?? 0) === 4,
    "the account inserts did not all persist",
  );
}

// --- APV1C-04: a storage failure degrades the probe, not the report ---------

{
  const { masters, images } = createMemoryBuckets();
  const database = await createD1TestDatabase({ seed, label: "v1c-storage" });
  database.exec(
    `UPDATE photos SET original_storage_key = 'r2://masters/originals/probe/master.jpg',
       web_storage_key = 'r2://images/web/probe/web.webp',
       thumbnail_storage_key = 'r2://images/thumbs/probe/thumb.webp'
     WHERE id = (SELECT id FROM photos LIMIT 1)`,
  );

  const objects = [
    ["r2://masters/originals/probe/master.jpg", masters],
    ["r2://images/web/probe/web.webp", images],
    ["r2://images/thumbs/probe/thumb.webp", images],
  ];
  for (const [key, bucket] of objects) {
    await bucket.put(key.replace(/^r2:\/\/[a-z]+\//, ""), new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: "image/jpeg" },
    });
  }

  const throwing = () => ({
    put: async () => undefined,
    get: async () => null,
    head: async () => {
      throw new Error("storage unavailable: bucket=secret-key-detail");
    },
    delete: async () => undefined,
  });

  const healthy = await maintenanceReport({ DB: database.binding, MASTERS: masters, IMAGES: images });
  check(healthy.available, "the healthy report was unavailable");
  // The seed's photographs carry r2://masters keys whose placeholder objects were never
  // uploaded, so the probe is expected to report every one of them EXCEPT the single object
  // this test stored: that is what proves the probe distinguishes present from missing.
  check(
    healthy.storage.status === "ok" &&
      healthy.storage.checked > 0 &&
      healthy.storage.missingMasters === healthy.storage.checked - 1,
    `the healthy probe returned status=${healthy.storage.status} checked=${healthy.storage.checked} ` +
      `missingMasters=${healthy.storage.missingMasters} note=${healthy.storage.note}`,
  );
  check(
    healthy.storage.missingDerivatives === 0,
    `the healthy probe invented ${healthy.storage.missingDerivatives} missing derivative(s) for keys it must not probe`,
  );
  check(healthy.counts.photos > 0, "the healthy report lost its record counts");

  const missing = createMemoryBuckets();
  const missingReport = await maintenanceReport({ DB: database.binding, MASTERS: missing.masters, IMAGES: missing.images });
  check(
    missingReport.available && missingReport.storage.missingMasters >= 1 && missingReport.storage.missingDerivatives >= 1,
    "an empty bucket did not report missing objects",
  );

  for (const [label, env] of [
    ["MASTERS failing", { DB: database.binding, MASTERS: throwing(), IMAGES: images }],
    ["IMAGES failing", { DB: database.binding, MASTERS: masters, IMAGES: throwing() }],
    ["both failing", { DB: database.binding, MASTERS: throwing(), IMAGES: throwing() }],
  ]) {
    let outcome = null;
    try {
      outcome = await maintenanceReport(env);
    } catch (error) {
      check(false, `the maintenance report threw with ${label}: ${error?.message}`);
    }
    if (outcome) {
      check(outcome.available, `the report was unavailable with ${label}`);
      check(outcome.storage.status === "degraded", `the storage status with ${label} is ${outcome.storage.status}`);
      check(outcome.counts.photos > 0, `the D1 counts were lost with ${label}`);
      check(outcome.findings.length > 0, `the integrity findings were lost with ${label}`);
      check(
        !/secret-key-detail|bucket=|r2:\/\//i.test(JSON.stringify(outcome)),
        `the degraded report leaked storage detail with ${label}`,
      );
    }
  }
}

// --- APV1C-05: strict checkbox parsing --------------------------------------

{
  const form = (entries) => ({ getAll: (name) => entries.filter(([key]) => key === name).map(([, value]) => value) });
  check(parseCheckbox(form([]), "published", "The publish control").value === false, "an absent checkbox was not false");
  check(parseCheckbox(form([["published", "on"]]), "published", "The publish control").value === true, "a checked checkbox was not true");
  for (const value of ["hacked", "1", "yes", "true", "ON", "on "]) {
    const verdict = parseCheckbox(form([["published", value]]), "published", "The publish control");
    check(verdict.ok === false, `the value ${JSON.stringify(value)} was accepted as a checkbox state`);
  }
  const duplicated = parseCheckbox(form([["published", "on"], ["published", "on"]]), "published", "The publish control");
  check(duplicated.ok === false, "a duplicated checkbox value was accepted");
  const several = parseCheckboxes(form([["published", "hacked"], ["featured", "on"]]), [
    { name: "published", label: "The publish control" },
    { name: "featured", label: "The featured control" },
  ]);
  check(several.ok === false && several.errors.length === 1, "a refused control did not stop the batch");
}

// --- APV1C-06: social URLs may not carry credentials ------------------------

{
  const instagram = SOCIAL_NETWORKS.find((network) => network.id === "instagram");
  check(validateSocialUrl("", instagram) === null, "a blank profile was not accepted as unconfigured");
  check(
    validateSocialUrl("https://www.instagram.com/example/", instagram) === null,
    "a valid profile address was refused",
  );
  for (const [label, value] of [
    ["username and password", "https://user:pass@instagram.com/profile"],
    ["username only", "https://user@instagram.com/profile"],
    ["password syntax", "https://:pass@instagram.com/profile"],
    ["a deceptive host", "https://instagram.com.evil.example/profile"],
    ["an unsupported scheme", "http://instagram.com/profile"],
  ]) {
    check(validateSocialUrl(value, instagram) !== null, `${label} was accepted as a profile address`);
  }
}

// --- APV1C-07: tag semantics ------------------------------------------------

{
  check(validateTagName("Landscape").ok, "an ordinary tag name was refused");
  check(validateTagName("").ok === false, "an empty tag name was accepted");
  check(validateTagName("!!!").ok === false, "a punctuation-only tag name was accepted");
  check(validateTagName("---").ok === false, "a hyphen-only tag name was accepted");
  check(validateTagName("x".repeat(41)).ok === false, "an overlong tag name was accepted");

  const database = await createD1TestDatabase({ seed, label: "v1c-tags" });
  const manager = new TaxonomyManager(database.binding);
  const created = await manager.create("Review Probe");
  check(created.status === "ok", `a new tag returned ${created.status}`);
  const duplicateCase = await manager.create("review probe");
  check(duplicateCase.status === "duplicate", `a case-variant duplicate tag returned ${duplicateCase.status}`);
  const used = database.query("SELECT tag_id FROM photo_tags LIMIT 1")[0]?.tag_id;
  const inUse = await manager.deleteUnused(used);
  check(inUse.status === "in-use", `deleting a used tag returned ${inUse.status}`);
  check(
    (database.query(`SELECT COUNT(*) AS total FROM tags WHERE id = '${used}'`)[0]?.total ?? 0) === 1,
    "a refused tag deletion removed the tag",
  );
  if (created.status === "ok") {
    const renamed = await manager.rename(created.persisted.id, "review probe");
    check(renamed.status === "ok", `renaming to a unique name returned ${renamed.status}`);
  }
}

// --- APV1C-02: the privacy copy matches the cookie that exists --------------

{
  const privacy = readFileSync(resolve(root, "app", "routes", "privacy.tsx"), "utf8");
  const cookieExists = typeof BROWSER_ID_COOKIE === "string" && BROWSER_ID_COOKIE.length > 0;
  check(cookieExists, "the engagement cookie constant disappeared, so this check no longer applies");
  check(
    !/no cookie is set|no cookies are set|does not set a cookie|sets no cookies/i.test(privacy),
    "the privacy page claims visitors receive no cookie while the engagement cookie exists",
  );
  check(
    privacy.includes(BROWSER_ID_COOKIE),
    "the privacy page does not name the engagement cookie it actually sets",
  );
  for (const [label, pattern] of [
    ["HttpOnly", /HttpOnly/i],
    ["SameSite", /SameSite/i],
    ["Secure", /Secure/],
    ["its lifetime", /400 days/],
    ["the digest-only storage", /digest/i],
    ["that it is not derived from device data", /not derived from your IP address/i],
  ]) {
    check(pattern.test(privacy), `the privacy page does not describe ${label}`);
  }
  const zeroCookieClaim = /no cookie is set for visitors|the only cookie in play|says no cookie/i;
  for (const [file, label] of [
    ["README.md", "the README"],
    ["DOCS/ANYAPARALLAX_V2_PLAN.md", "the V2 plan"],
  ]) {
    check(
      !zeroCookieClaim.test(readFileSync(resolve(root, file), "utf8")),
      `${label} still asserts that no visitor cookie exists`,
    );
  }
  // The glossary may QUOTE the old claim in a note recording that it was corrected, so only
  // the text an operator would publish is scanned.
  const glossaryRows = readFileSync(
    resolve(root, "DOCS", "ANYAPARALLAX_V1_COPY_GLOSSARY.md"),
    "utf8",
  )
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|"))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
  const glossaryClaims = glossaryRows.filter(
    (cells) => cells.length === 8 && zeroCookieClaim.test(cells[4] ?? ""),
  );
  check(
    glossaryClaims.length === 0,
    `the copy glossary still lists ${glossaryClaims.length} current-text row(s) claiming no visitor cookie`,
  );
  check(
    readFileSync(resolve(root, "app", "routes", "admin", "settings.tsx"), "utf8").includes(
      "SITE_SETTING_KEYS.watermarkPosition",
    ),
    "the workspace settings screen no longer reads the watermark default key",
  );
}

report(
  "V1C repair check passed: the last-manager invariant is inside the mutation statement (sole manager, " +
    "inactive co-manager, two managers, photographers and concurrent stand-downs all bounded), account ids are " +
    "collision-safe UUIDs with duplicates still refused by email, a failing object store degrades the integrity " +
    "probe instead of the report, checkbox controls refuse every value a browser cannot send, social profile " +
    "URLs may not carry credentials, tag names must be names and duplicate labels are refused, and the privacy " +
    "copy describes the engagement cookie that exists.",
);
