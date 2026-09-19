#!/usr/bin/env node
/**
 * Loads the development seed set into the LOCAL D1 database.
 *
 * Local only: it shells out to `wrangler d1 execute --local`, which writes to
 * `.wrangler/state` and never contacts Cloudflare. Use it after
 * `pnpm run db:migrate:local` to give `pnpm run dev` real rows to read — the
 * same data the pages show when no binding is available.
 *
 * Usage:
 *   pnpm run db:migrate:local
 *   pnpm run db:seed:local
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

register("./ts-extension-hooks.mjs", import.meta.url);

const { seed } = await import("../app/data/seed.ts");
const { buildFixtureSql, runWrangler } = await import("./checks/d1-harness.mjs");

const fixtureDir = join(tmpdir(), `anyaparallax-local-seed-${process.pid}`);
mkdirSync(fixtureDir, { recursive: true });
const fixturePath = join(fixtureDir, "seed.sql");
writeFileSync(fixturePath, buildFixtureSql(seed), "utf8");

await runWrangler([
  "d1",
  "execute",
  "anyaparallax",
  "--local",
  "--yes",
  "--file",
  fixturePath,
]);

console.log(
  `Seeded the local D1 database from app/data/seed.ts ` +
    `(${seed.galleries.length} galleries, ${seed.photos.length} photographs, ${seed.tags.length} tags).`,
);
