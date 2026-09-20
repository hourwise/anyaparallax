#!/usr/bin/env node
/**
 * Local development D1 bootstrap shared by `pnpm run db:seed:local` and the
 * served-payload check.
 *
 * Applies the repository migrations to Wrangler's LOCAL D1 state and loads the
 * development seed set (galleries, photographs, tags and the placeholder
 * authorised users). `--local` keeps everything inside `.wrangler/state`;
 * nothing here contacts Cloudflare.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildFixtureSql, runWrangler } from "./d1-harness.mjs";

/** Apply migrations to the local D1 database (idempotent). */
export async function migrateLocalD1() {
  return runWrangler(["d1", "migrations", "apply", "anyaparallax", "--local"]);
}

/** Replace the local fixture rows with the given seed set (idempotent). */
export async function seedLocalD1(seed) {
  const fixtureDir = join(tmpdir(), `anyaparallax-local-seed-${process.pid}-${Date.now()}`);
  mkdirSync(fixtureDir, { recursive: true });
  const fixturePath = join(fixtureDir, "seed.sql");
  writeFileSync(fixturePath, buildFixtureSql(seed), "utf8");

  return runWrangler([
    "d1",
    "execute",
    "anyaparallax",
    "--local",
    "--yes",
    "--file",
    fixturePath,
  ]);
}
