#!/usr/bin/env node
/**
 * Local Worker-variable overrides for the served checks (REPAIR-09A).
 *
 * The development-notice state is configuration, so proving both of its states on
 * the wire means running the dev server with the value forced one way and then the
 * other. Wrangler's local override file is `.dev.vars`, which `@cloudflare/vite-plugin`
 * loads for `vite dev` and which overrides `vars` from `wrangler.jsonc` — verified
 * by observing a `PUBLIC_SITE_ORIGIN` override reach a served canonical URL.
 *
 * THREE PROPERTIES MATTER, and each is enforced rather than assumed:
 *
 *   1. NOTHING TRACKED IS TOUCHED. `.dev.vars` is gitignored, so a check can write
 *      it without any risk of committing local state; `assertDevVarsIgnored()`
 *      proves the ignore rule is still in place before a check relies on it.
 *   2. A DEVELOPER'S OWN FILE SURVIVES. If `.dev.vars` already exists it is copied
 *      aside and restored, so running the checks never destroys a local override.
 *   3. RESTORING IS IDEMPOTENT AND HAPPENS IN A `finally`. A failing assertion or a
 *      crash still leaves the workspace as it was found.
 */
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const devVarsPath = resolve(root, ".dev.vars");
const backupPath = resolve(root, ".dev.vars.check-backup");

/** Fail loudly if `.dev.vars` is not ignored, so a check cannot leave a tracked file behind. */
export function assertDevVarsIgnored() {
  const ignore = readFileSync(resolve(root, ".gitignore"), "utf8");
  const ignored = ignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === ".dev.vars" || line === ".dev.vars.*");
  if (!ignored) {
    throw new Error(
      ".dev.vars is no longer gitignored, so the served checks must not write it: " +
        "a local override would become a committed file.",
    );
  }
}

/**
 * Write `.dev.vars` with the given Worker variables and return a restore function.
 *
 * Values are JSON-quoted, which is how Wrangler's dotenv parser expects a string
 * value, and the restore function may be called more than once.
 */
export function withWorkerVariables(variables) {
  assertDevVarsIgnored();

  const existed = existsSync(devVarsPath);
  if (existed) {
    copyFileSync(devVarsPath, backupPath);
  }
  const body = Object.entries(variables)
    .map(([name, value]) => `${name}=${JSON.stringify(String(value))}`)
    .join("\n");
  writeFileSync(devVarsPath, `${body}\n`, "utf8");

  let restored = false;
  return function restoreWorkerVariables() {
    if (restored) {
      return;
    }
    restored = true;
    if (existed) {
      copyFileSync(backupPath, devVarsPath);
      rmSync(backupPath, { force: true });
    } else {
      rmSync(devVarsPath, { force: true });
    }
  };
}
