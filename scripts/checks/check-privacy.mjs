#!/usr/bin/env node
/**
 * Fingerprinting scan (Slice 07).
 *
 * A behavioural test can show that one identifier did not vary with the headers
 * this check happened to try. This scan is the structural complement: it reads
 * the production source and refuses the category outright.
 *
 * Two claims are proved:
 *
 *   1. NO FINGERPRINTING DEPENDENCY. The manifest must not contain a
 *      fingerprinting or tracking library, and no source file may import one.
 *   2. NO FINGERPRINTING CODE. The identity path must not touch the browser
 *      characteristics a fingerprinter would use — and, stronger, the anonymous
 *      browser-identity module must not read a request's headers at all. An
 *      identifier that cannot see a user agent cannot be derived from one.
 *
 * The scan is deliberately blunt: a match is a failure, and the only way to pass
 * is for the pattern not to be there. Comments in the identity module explain
 * what is NOT done and therefore mention some of these words; the scan therefore
 * strips comments before searching, so the prose cannot create a false positive
 * and, more importantly, cannot mask a real one.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { check, note, report } from "./report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every production source file, excluding checks and fixtures. */
function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Strip comments so prose cannot match — and cannot hide a real match.
 *
 * A line-by-line pass is enough here: this file only needs comments to be
 * ignored, not JavaScript to be parsed.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const appFiles = sourceFiles(resolve(root, "app"));
const workerFiles = sourceFiles(resolve(root, "workers"));
const allFiles = [...appFiles, ...workerFiles];

// --- 1. No fingerprinting dependency --------------------------------------

const FORBIDDEN_PACKAGES = [
  "fingerprintjs",
  "@fingerprintjs",
  "fingerprint",
  "clientjs",
  "client-js",
  "thumbmarkjs",
  "creepjs",
  "detectincognito",
  "botd",
  "ua-parser",
  "device-detector",
  "platform.js",
  "amplitude",
  "mixpanel",
  "segment",
  "google-analytics",
  "gtag",
  "posthog",
  "sentry",
  "bugsnag",
  "datadog",
];

const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const declared = [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
].map((name) => name.toLowerCase());
check(
  declared.every(
    (name) => !FORBIDDEN_PACKAGES.some((forbidden) => name.includes(forbidden)),
  ),
  `package.json declares a fingerprinting or tracking dependency: ${declared
    .filter((name) => FORBIDDEN_PACKAGES.some((forbidden) => name.includes(forbidden)))
    .join(", ")}`,
);
note(`dependencies checked for fingerprinting/tracking: ${declared.length}`);

// No source file may import one either, which catches a transitive helper added
// without a manifest entry being noticed.
for (const file of allFiles) {
  const source = stripComments(readFileSync(file, "utf8"));
  for (const forbidden of FORBIDDEN_PACKAGES) {
    check(
      !new RegExp(`from\\s+["'][^"']*${forbidden}[^"']*["']`, "i").test(source),
      `${file.replace(root, "")} imports the fingerprinting/tracking package ${forbidden}`,
    );
  }
}

// --- 2. No fingerprinting code --------------------------------------------

/**
 * Browser characteristics a fingerprinter would read.
 *
 * Each pattern names the API rather than the idea, so a match is a concrete
 * finding instead of a wording judgement.
 */
const FINGERPRINT_APIS = [
  ["canvas rendering", /getContext\s*\(\s*["'](2d|webgl|webgl2)["']\s*\)/],
  ["canvas data extraction", /toDataURL|toBlob\s*\(/],
  ["audio fingerprinting", /OfflineAudioContext|createOscillator|createAnalyser/],
  ["font enumeration", /document\.fonts|measureText\s*\(/],
  ["screen metrics", /screen\.(width|height|colorDepth|pixelDepth|availWidth)/],
  ["timezone probing", /Intl\.DateTimeFormat\(\)\.resolvedOptions|getTimezoneOffset/],
  ["device memory", /deviceMemory|hardwareConcurrency/],
  ["plugin enumeration", /navigator\.plugins|navigator\.mimeTypes/],
  ["media device enumeration", /enumerateDevices|getSupportedConstraints/],
  ["WebRTC probing", /RTCPeerConnection|createDataChannel/],
  ["battery status", /getBattery\s*\(/],
  ["storage estimation", /navigator\.storage\.estimate/],
  ["user agent reading", /navigator\.userAgent|userAgentData/],
  ["language reading", /navigator\.languages?\b/],
  ["platform reading", /navigator\.platform/],
];

for (const file of allFiles) {
  const source = stripComments(readFileSync(file, "utf8"));
  for (const [label, pattern] of FINGERPRINT_APIS) {
    check(
      !pattern.test(source),
      `${file.replace(root, "")} uses ${label}, which is fingerprinting surface`,
    );
  }
}

// --- 3. The identity path cannot see the request --------------------------

/**
 * The strongest available structural claim.
 *
 * The module that mints and hashes the anonymous identifier is checked for ANY
 * use of request headers, cookies included: the caller passes a token, so header
 * access here would be the only way a characteristic could reach the identity.
 * This is what makes the behavioural privacy test true by construction rather
 * than by luck.
 */
const identityPath = readFileSync(resolve(root, "app/engagement/anonymous-browser.server.ts"), "utf8");
const identityCode = stripComments(identityPath);
for (const [label, pattern] of [
  ["reads request headers", /\.headers\b/],
  ["reads a request at all", /\brequest\./],
  ["reads the user agent", /userAgent/i],
  ["reads a forwarded address", /forwarded|cf-connecting-ip|x-real-ip/i],
  ["reads language", /accept-language/i],
  ["reads a referrer", /referer|referrer/i],
]) {
  check(!pattern.test(identityCode), `the browser-identity module ${label}`);
}
check(
  /crypto\.randomUUID/.test(identityCode),
  "the identifier is not generated from the platform CSPRNG",
);
check(
  /crypto\.subtle\.digest\(\s*"SHA-256"/.test(identityCode),
  "the identifier is not hashed with SHA-256 before storage",
);
note("identity module: no header access, CSPRNG generation, SHA-256 digest");

// --- 4. The like route does not read characteristics ----------------------

const engagementRoute = readFileSync(
  resolve(root, "app/routes/engagement.$slug.tsx"),
  "utf8",
);
const routeCode = stripComments(engagementRoute);
for (const [label, pattern] of [
  ["the user agent", /user-agent|userAgent/i],
  ["a forwarded address", /x-forwarded-for|cf-connecting-ip|x-real-ip/i],
  ["a language header", /accept-language/i],
  ["a referrer header", /["']referer["']|["']referrer["']/i],
]) {
  check(!pattern.test(routeCode), `the engagement endpoint reads ${label}`);
}
note("engagement endpoint: reads no request characteristic");

// --- 5. The request characteristics really are ignored --------------------
//
// A last coherence check: the boundary's own tests must exist, because the
// structural scan proves what the code cannot see and not what it does.
const behaviourFile = resolve(root, "scripts/checks/check-engagement.mjs");
const behaviour = readFileSync(behaviourFile, "utf8");
check(
  behaviour.includes("request-characteristic variations"),
  "no behavioural check asserts the identifier is independent of request characteristics",
);
for (const characteristic of ["user-agent", "x-forwarded-for", "accept-language", "x-timezone"]) {
  check(
    behaviour.includes(characteristic),
    `the behavioural check does not vary ${characteristic}`,
  );
}

report(
  "Fingerprinting scan passed: no fingerprinting or tracking dependency is declared or imported, no " +
    "fingerprinting API appears in production source, and the anonymous identity path reads no request " +
    "header at all.",
);
