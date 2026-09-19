#!/usr/bin/env node
/**
 * Runs the data-layer invariant check with Node's TypeScript stripping plus a
 * resolver hook for bundler-style extensionless imports. See
 * `scripts/check-data-layer.mjs` for the checks themselves.
 */
import { register } from "node:module";

register("./ts-extension-hooks.mjs", import.meta.url);
await import("./check-data-layer.mjs");
