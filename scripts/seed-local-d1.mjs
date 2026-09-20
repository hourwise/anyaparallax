#!/usr/bin/env node
/**
 * Loads the development seed set into the LOCAL D1 database.
 *
 * Local only: it shells out to `wrangler d1 execute --local`, which writes to
 * `.wrangler/state` and never contacts Cloudflare. Use it after
 * `pnpm run db:migrate:local` to give `pnpm run dev` real rows to read — the
 * same data the pages show when no binding is available, and the same
 * placeholder operator accounts the local authentication boundary checks
 * against.
 *
 * Usage:
 *   pnpm run db:migrate:local
 *   pnpm run db:seed:local
 */
import { register } from "node:module";

register("./ts-extension-hooks.mjs", import.meta.url);

const { seed } = await import("../app/data/seed.ts");
const { seedLocalD1 } = await import("./checks/local-d1.mjs");

await seedLocalD1(seed);

console.log(
  `Seeded the local D1 database from app/data/seed.ts ` +
    `(${seed.galleries.length} galleries, ${seed.photos.length} photographs, ` +
    `${seed.tags.length} tags, ${seed.users.length} authorised accounts).`,
);
