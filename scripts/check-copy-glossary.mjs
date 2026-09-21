#!/usr/bin/env node
/**
 * Copy-glossary consistency check.
 *
 * WHAT THIS PROVES — and nothing more:
 *
 *   * every stable ID in the authoritative Markdown inventory appears EXACTLY ONCE, and a
 *     repeated ID fails even when both rows carry identical text;
 *   * every ID appears exactly once in the CSV export, and the two files describe exactly
 *     the same set of IDs;
 *   * the two files AGREE on each row's audience, surface, element type, current text,
 *     source reference and editable flag, and the CSV's rewrite flag matches the
 *     classification the Markdown's rewrite-flags section assigns;
 *   * each rewrite-flags group lists as many distinct IDs as its heading claims.
 *
 * WHAT THIS DOES NOT PROVE: that the glossary is EXHAUSTIVE. The document is a carefully
 * generated inventory of the copy that was found by reading the source, and this check
 * verifies its internal consistency. It does NOT compare the inventory against every
 * string literal in the application, so a string that nobody inventoried would not be
 * detected here. The previous version of this check implied otherwise; the claim was
 * removed rather than propped up with a brittle source parser. Treat coverage as
 * "reviewed by a person and mechanically consistent", not as a proof of completeness.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const markdownPath = resolve(root, "DOCS", "ANYAPARALLAX_V1_COPY_GLOSSARY.md");
const csvPath = resolve(root, "DOCS", "ANYAPARALLAX_V1_COPY_GLOSSARY.csv");

/** A coarse sanity floor, NOT a completeness proof. */
const MINIMUM_IDS = 150;

const ID_PATTERN = /^(PUB|ADM|MGR|SYS)-[A-Z]+-\d{3}$/;
const FLAG_PATTERN =
  /^(KEEP|REVIEW|REWRITE_RECOMMENDED|OPERATOR_CONTENT_REQUIRED|LEGAL\/PRIVACY_REVIEW)$/;

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
check(existsSync(csvPath), "DOCS/ANYAPARALLAX_V1_COPY_GLOSSARY.csv is missing");
if (!existsSync(markdownPath) || !existsSync(csvPath)) {
  console.error("Copy-glossary check FAILED: a required file does not exist.");
  process.exit(1);
}

const markdown = readFileSync(markdownPath, "utf8");
const csv = readFileSync(csvPath, "utf8");

/** Inventory rows: a table row whose FIRST cell is a stable ID and which has all eight columns. */
function inventoryRows(text, columns) {
  return text
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
    .filter((cells) => cells.length === columns && ID_PATTERN.test(cells[0]));
}

const mdRows = inventoryRows(markdown, 8);
check(mdRows.length > 0, "the glossary contains no inventory rows");
check(
  mdRows.length >= MINIMUM_IDS,
  `the glossary has ${mdRows.length} inventory row(s); at least ${MINIMUM_IDS} are expected (a sanity floor, not a completeness proof)`,
);

// 1. Exactly once in the Markdown, duplicates failing even with identical text.
const mdCounts = new Map();
for (const cells of mdRows) {
  mdCounts.set(cells[0], (mdCounts.get(cells[0]) ?? 0) + 1);
}
const mdDuplicates = [...mdCounts.entries()].filter(([, count]) => count > 1);
check(
  mdDuplicates.length === 0,
  `the Markdown repeats ${mdDuplicates.length} ID(s) (identical text included): ${mdDuplicates
    .slice(0, 5)
    .map(([id, count]) => `${id}×${count}`)
    .join(", ")}`,
);

const byId = new Map();
for (const [id, audience, surface, element, text, source, editable] of mdRows) {
  byId.set(id, { audience, surface, element, text, source, editable });
}
for (const audience of new Set([...byId.values()].map((row) => row.audience))) {
  check(
    ["PUBLIC", "PHOTOGRAPHER", "MANAGER", "SYSTEM/ERROR"].includes(audience),
    `an entry uses the unknown audience ${JSON.stringify(audience)}`,
  );
}
for (const audience of ["PUBLIC", "PHOTOGRAPHER", "MANAGER", "SYSTEM/ERROR"]) {
  check(
    [...byId.values()].some((row) => row.audience === audience),
    `the glossary has no ${audience} entries, so that audience is undocumented`,
  );
}

// 2. The rewrite-flags section: one classification per ID, declared counts honoured.
//
// The classification region ENDS at the first heading that is not a classification: the
// glossary continues with "IDs per surface" and coverage notes, and a parser that kept the
// last-seen classification would mis-file every ID listed after the final group.
const flagsSection = markdown.slice(markdown.indexOf("## Rewrite flags"));
const flagOf = new Map();
let currentFlag = null;
for (const rawLine of flagsSection.split(/\r?\n/)) {
  // ANY heading starts or ends a region: a heading with lowercase words ("## Coverage and
  // counts") is not a classification, and treating it as content would file every ID listed
  // after it under the last classification group.
  const heading = /^#{2,4}\s+(.*?)\s*$/.exec(rawLine.trim());
  if (heading) {
    const classified = /^([A-Z/ _]+?)(?:\s+—\s+(\d+)\s+IDs?)?\s*$/.exec(heading[1]);
    const candidate = classified ? classified[1].trim().replace(/\s+/g, "_") : "";
    if (classified && FLAG_PATTERN.test(candidate)) {
      currentFlag = candidate;
      const declared = classified[2] ? Number(classified[2]) : null;
      if (declared !== null) {
        const listed = new Set(
          (flagsSection.slice(flagsSection.indexOf(rawLine) + rawLine.length).split(/^#{2,4}\s/m)[0]
            .match(/\b(?:PUB|ADM|MGR|SYS)-[A-Z]+-\d{3}\b/g) ?? []),
        );
        check(
          listed.size === declared,
          `the ${currentFlag} group claims ${declared} IDs but lists ${listed.size}`,
        );
      }
    } else {
      // Any other heading ends the classification region.
      currentFlag = null;
    }
    continue;
  }
  if (currentFlag === null) {
    continue;
  }
  for (const id of rawLine.match(/\b(?:PUB|ADM|MGR|SYS)-[A-Z]+-\d{3}\b/g) ?? []) {
    const existing = flagOf.get(id);
    if (existing && existing !== currentFlag) {
      failures.push(`the ID ${id} is classified both ${existing} and ${currentFlag}`);
    }
    flagOf.set(id, currentFlag);
  }
}
check(flagOf.size > 0, "no rewrite flags could be read, so that section was not verified");
const unflagged = [...byId.keys()].filter((id) => !flagOf.has(id));
check(
  unflagged.length === 0,
  `${unflagged.length} ID(s) carry no rewrite flag: ${unflagged.slice(0, 5).join(", ")}`,
);

// 3. The CSV: exactly once per ID, and row-for-row agreement with the Markdown.
const csvLines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
check(csvLines[0]?.startsWith("ID,"), `the CSV header is ${JSON.stringify((csvLines[0] ?? "").slice(0, 40))}`);

/** A minimal RFC-4180 reader: quoted cells, doubled quotes, embedded commas and newlines. */
function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

const csvRows = new Map();
const csvDuplicates = [];
const malformed = [];
for (const line of csvLines.slice(1)) {
  const cells = parseCsvLine(line);
  if (cells.length !== 9 || !ID_PATTERN.test(cells[0])) {
    malformed.push(cells[0] ?? "");
    continue;
  }
  if (csvRows.has(cells[0])) {
    csvDuplicates.push(cells[0]);
  }
  csvRows.set(cells[0], cells);
}
check(malformed.length === 0, `the CSV has ${malformed.length} malformed row(s)`);
check(
  csvDuplicates.length === 0,
  `the CSV repeats ${csvDuplicates.length} ID(s): ${csvDuplicates.slice(0, 5).join(", ")}`,
);

const missingFromCsv = [...byId.keys()].filter((id) => !csvRows.has(id));
const extraInCsv = [...csvRows.keys()].filter((id) => !byId.has(id));
check(
  missingFromCsv.length === 0,
  `the CSV is missing ${missingFromCsv.length} ID(s) the glossary documents: ${missingFromCsv.slice(0, 5).join(", ")}`,
);
check(
  extraInCsv.length === 0,
  `the CSV lists ${extraInCsv.length} ID(s) the glossary does not document: ${extraInCsv.slice(0, 5).join(", ")}`,
);

const disagreements = [];
for (const [id, row] of byId) {
  const cells = csvRows.get(id);
  if (!cells) {
    continue;
  }
  const [, audience, surface, element, text, source, editable, flag] = cells;
  const pairs = [
    ["audience", audience, row.audience],
    ["surface", surface, row.surface],
    ["element type", element, row.element],
    ["current text", text, row.text],
    ["source", source, row.source],
    ["editable flag", editable, row.editable],
    ["rewrite flag", flag, flagOf.get(id)],
  ];
  for (const [label, csvValue, mdValue] of pairs) {
    if (csvValue !== mdValue) {
      disagreements.push(`${id} ${label}: csv=${JSON.stringify(csvValue)} md=${JSON.stringify(mdValue)}`);
    }
  }
}
check(
  disagreements.length === 0,
  `the Markdown and CSV disagree on ${disagreements.length} field(s): ${disagreements.slice(0, 3).join(" | ")}`,
);

// 4. No ID may be referenced anywhere without an inventory row.
const mentioned = new Set((markdown.match(/\b(?:PUB|ADM|MGR|SYS)-[A-Z]+-\d{3}\b/g) ?? []));
const orphans = [...mentioned].filter((id) => !byId.has(id));
check(
  orphans.length === 0,
  `the document mentions ${orphans.length} ID(s) with no inventory row: ${orphans.slice(0, 5).join(", ")}`,
);

if (failures.length > 0) {
  console.error(`Copy-glossary check FAILED with ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
console.log(
  `Copy-glossary check passed: ${byId.size} stable IDs appear exactly once in the Markdown and once in the CSV, ` +
    "the two files agree field for field, every ID carries exactly one rewrite flag, and no ID is referenced " +
    "without an inventory row.",
);
console.log(
  "note | this verifies internal consistency ONLY. It does not compare the inventory against every string in " +
    "the source, so it does not prove the glossary is exhaustive.",
);
