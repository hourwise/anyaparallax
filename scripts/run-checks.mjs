#!/usr/bin/env node
/**
 * Entry point for the data, storage and D1 checks.
 *
 * Registers a resolver hook so Node can import the application's TypeScript
 * source directly (bundler-style extensionless imports), then runs each check
 * module in this process. Every check reports through `scripts/checks/report.mjs`
 * and sets a non-zero exit code on failure.
 */
import { register } from "node:module";

register("./ts-extension-hooks.mjs", import.meta.url);

const checks = [
  "./checks/check-seed-integrity.mjs",
  "./checks/check-seed-repository.mjs",
  "./checks/check-storage.mjs",
  "./checks/check-image-adapter.mjs",
  "./checks/check-upload-http.mjs",
  "./checks/check-upload-pipeline.mjs",
  "./checks/check-upload-server.mjs",
  "./checks/check-media-route.mjs",
  // Slice 07: engagement, sharing, social metadata and the privacy scan.
  "./checks/check-metadata.mjs",
  "./checks/check-engagement.mjs",
  "./checks/check-privacy.mjs",
  // Slice 08: print eligibility and the enquiry path.
  "./checks/check-enquiries.mjs",
  // REPAIR-09B: bounded photograph management and the withdrawal mechanism.
  "./checks/check-photo-management.mjs",
  // REPAIR-09D: publication readiness is verified over HTTP, not here; the abuse
  // guard's own contract is pure, so it is covered by check-enquiries.mjs.
  "./checks/check-d1.mjs",
  "./checks/check-auth.mjs",
];

for (const check of checks) {
  await import(check);
}
