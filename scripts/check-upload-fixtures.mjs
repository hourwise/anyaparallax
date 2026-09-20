#!/usr/bin/env node
/**
 * Upload-pipeline fixture check (Slice 06).
 *
 * The reference images the upload checks decode are COMMITTED, under
 * `scripts/fixtures/`. They are committed deliberately:
 *
 *  - they are tiny (a few kilobytes each), so keeping them in the repository
 *    costs nothing and removes any dependence on a machine-specific painter;
 *  - they were produced by an INDEPENDENT encoder (System.Drawing through
 *    Windows PowerShell), not by the application's own codec, so a codec that is
 *    symmetrically wrong cannot pass by round-tripping its own output;
 *  - a fixture that has to be regenerated before a check can run is a check that
 *    silently skips, or silently reuses a stale file, which is worse than no
 *    fixture at all.
 *
 * This script verifies the committed set is present, non-empty and the geometry
 * the checks assume. Regenerating is a deliberate, manual act:
 *
 *   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/fixtures/make-large.ps1 -OutDirectory scripts/fixtures
 *
 * (see `scripts/fixtures/README.md` for the full set and how each was built).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { check, note, report } from "./checks/report.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directory = resolve(root, "scripts", "fixtures");

/** The committed fixture set, with the geometry each check relies on. */
const FIXTURES = [
  { file: "photo.jpg", format: "jpeg", width: 320, height: 240 },
  { file: "greyscale.jpg", format: "jpeg", width: 200, height: 150 },
  { file: "photo.png", format: "png", width: 320, height: 240 },
  // Above the thumbnail limit (480) and on the web limit (1600), so the resize
  // path is exercised on a real lossy JPEG rather than only on PNG.
  { file: "large.jpg", format: "jpeg", width: 1600, height: 1200 },
  { file: "large.png", format: "png", width: 2400, height: 1600 },
];

/** Read the IHDR geometry straight from the bytes, independent of the codec. */
function pngGeometry(bytes) {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Walk JPEG markers to the SOF frame header, independent of the codec. */
function jpegGeometry(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      return {
        height: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
        width: ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0),
      };
    }
    offset += 2 + length;
  }
  return null;
}

for (const fixture of FIXTURES) {
  const path = resolve(directory, fixture.file);
  if (!existsSync(path)) {
    check(false, `committed fixture ${fixture.file} is missing from scripts/fixtures`);
    continue;
  }
  const bytes = new Uint8Array(readFileSync(path));
  check(bytes.byteLength > 0, `committed fixture ${fixture.file} is empty`);
  const geometry =
    fixture.format === "png" ? pngGeometry(bytes) : jpegGeometry(bytes);
  check(Boolean(geometry), `committed fixture ${fixture.file} has no readable frame header`);
  check(
    geometry?.width === fixture.width && geometry?.height === fixture.height,
    `committed fixture ${fixture.file} is ${geometry?.width}x${geometry?.height}, expected ${fixture.width}x${fixture.height}`,
  );
  note(`${fixture.file}: ${statSync(path).size} bytes, ${fixture.width}x${fixture.height} ${fixture.format}`);
}

report(
  `Upload fixture check passed: ${FIXTURES.length} committed reference images present with the expected geometry.`,
);
