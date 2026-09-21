#!/usr/bin/env node
/**
 * Copy-glossary consistency check.
 *
 * The glossary is the operator's interface for rewriting copy by stable ID, which only
 * works if the IDs are unique, well formed and complete. This check is deliberately
 * lightweight: it verifies the structure and the identity rules, not the wording.
 *
 *   * every inventory row carries a well formed ID (AUDIENCE-SURFACE-NNN);
 *   * no ID appears twice with DIFFERENT text or audience — the same ID must always mean
 *     the same string, or an instruction like `PUB-HOME-002 → replace with "…"` becomes
 *     ambiguous;
 *   * the CSV export, when present, describes exactly the same set of IDs;
 *   * the document is substantial enough to be the exhaustive inventory it claims to be.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const markdownPath = resolve(root, "DOCS", "ANYAPARALLAX_V1_COPY_GLOSSARY.md");
const csvPath = resolve(root, "DOCS", "ANYAPARALLAX_V1_COPY_GLOSSARY.csv");

/** The minimum size that makes "exhaustive" a claim the document can support. */
const MINIMUM_IDS = 150;

const ID_PATTERN = /^(PUB|ADM|MGR|SYS)-[A-Z]+-\d{3}$/;

const failures = [];
function check(condition, message) {
  if (condition) {
    console.log(`ok   | ${message}`);
  } else {
    failures.push(message);
    console.log(`FAIL | ${message}`);
  }
}

check(existsSync(markdownPath), "DOCS/ANYAPARALLAX_V1_COPY_GLOSSARY.md is missing");
if (!existsSync(markdownPath)) {
  console.error("Copy-glossary check FAILED: the glossary does not exist.");
  process.exit(1);
}

const markdown = readFileSync(markdownPath, "utf8");
const rows = markdown
  .split(/\r?\n/)
  .filter((line) => line.trim().startsWith("|"))
  .map((line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim()),
  )
  .filter((cells) => cells.length > 1 && ID_PATTERN.test(cells[0]));

check(rows.length > 0, "the glossary contains no identifiable inventory rows");

const inventory = rows.filter((cells) => cells.length >= 8);
check(
  inventory.length >= MINIMUM_IDS,
  `the glossary has ${inventory.length} inventory row(s); at least ${MINIMUM_IDS} are expected for an exhaustive inventory`,
);

const byId = new Map();
for (const cells of inventory) {
  const [id, audience, surface, element, text, source] = cells;
  const conflicted = byId.get(id);
  if (conflicted && (conflicted.text !== text || conflicted.audience !== audience)) {
    failures.push(
      `the ID ${id} is used twice with different meanings: ${JSON.stringify(conflicted.text)} and ${JSON.stringify(text)}`,
    );
  }
  byId.set(id, { text, audience, surface, element, source });
}

const audiences = new Map();
for (const { audience } of byId.values()) {
  audiences.set(audience, (audiences.get(audience) ?? 0) + 1);
}
for (const audience of ["PUBLIC", "PHOTOGRAPHER", "MANAGER", "SYSTEM/ERROR"]) {
  check(
    (audiences.get(audience) ?? 0) > 0,
    `the glossary has no ${audience} entries, so that audience is undocumented`,
  );
}
for (const audience of audiences.keys()) {
  check(
    ["PUBLIC", "PHOTOGRAPHER", "MANAGER", "SYSTEM/ERROR"].includes(audience),
    `an entry uses the unknown audience ${JSON.stringify(audience)}`,
  );
}

// Any ID mentioned anywhere in the document (including the rewrite-flags section) must
// exist in the inventory: a flag for an unknown ID cannot be acted on.
const mentioned = new Set(
  (markdown.match(/\b(?:PUB|ADM|MGR|SYS)-[A-Z]+-\d{3}\b/g) ?? []).map((value) => value),
);
const orphans = [...mentioned].filter((id) => !byId.has(id));
check(
  orphans.length === 0,
  `the document mentions ${orphans.length} ID(s) that have no inventory row: ${orphans.slice(0, 5).join(", ")}`,
);

if (existsSync(csvPath)) {
  const csv = readFileSync(csvPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const header = csv[0] ?? "";
  check(header.startsWith("ID,"), `the CSV header is ${JSON.stringify(header.slice(0, 40))}`);
  const csvIds = new Set();
  const malformed = [];
  for (const line of csv.slice(1)) {
    const id = line.slice(0, line.indexOf(","));
    if (!ID_PATTERN.test(id)) {
      malformed.push(id);
      continue;
    }
    csvIds.add(id);
  }
  check(malformed.length === 0, `the CSV has ${malformed.length} row(s) without a valid ID`);
  const missingFromCsv = [...byId.keys()].filter((id) => !csvIds.has(id));
  const extraInCsv = [...csvIds].filter((id) => !byId.has(id));
  check(
    missingFromCsv.length === 0,
    `the CSV is missing ${missingFromCsv.length} ID(s) the glossary documents: ${missingFromCsv.slice(0, 5).join(", ")}`,
  );
  check(
    extraInCsv.length === 0,
    `the CSV lists ${extraInCsv.length} ID(s) the glossary does not document: ${extraInCsv.slice(0, 5).join(", ")}`,
  );
} else {
  console.log("note | no CSV export beside the glossary; markdown is authoritative");
}

if (failures.length > 0) {
  console.error(`Copy-glossary check FAILED with ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
console.log(
  `Copy-glossary check passed: ${byId.size} unique stable IDs across ${audiences.size} audience(s) ` +
    `(${[...audiences.entries()].map(([audience, count]) => `${audience} ${count}`).join(", ")}), ` +
    "every ID well formed, no ID carrying two meanings, and no ID referenced without an inventory row.",
);
