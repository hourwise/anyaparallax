/**
 * Derive an ignored, preview-only Wrangler config from the built Worker payload
 * and the bindings on its currently deployed preview version. No resource IDs or
 * Access values are written to tracked source or printed to the terminal.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const basePath = resolve(root, "build/server/wrangler.json");
const outputPath = resolve(root, "build/server/wrangler-preview.json");
const previewName = "anyaparallax-preview";
const productionName = "anyaparallax";
const previewOrigin = "https://anyaparallax-preview.philgeran.workers.dev";
const expectedProductionVersion = process.argv[2];
if (!/^[a-f0-9-]{36}$/.test(expectedProductionVersion ?? "")) {
  throw new Error("Pass the previously verified production version ID as the sole argument.");
}
const env = { ...process.env };
delete env.CLOUDFLARE_API_TOKEN; // The injected token is invalid; use the existing Wrangler login.

function wranglerJson(...args) {
  return JSON.parse(execFileSync(process.execPath, [wrangler, ...args, "--json"], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

function liveVersion(name) {
  const deployments = wranglerJson("deployments", "list", "--name", name);
  if (!Array.isArray(deployments) || deployments.length === 0) throw new Error(`No ${name} deployment found.`);
  const latest = deployments.sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  const live = latest?.versions?.filter((item) => item.percentage === 100);
  if (live?.length !== 1) throw new Error(`No single 100% ${name} version found.`);
  return live[0].version_id;
}

function binding(version, name, type) {
  const matches = version.resources?.bindings?.filter((item) => item.name === name && item.type === type);
  if (matches?.length !== 1) throw new Error(`Expected exactly one ${name}:${type} binding.`);
  return matches[0];
}

const productionVersionId = liveVersion(productionName);
if (productionVersionId !== expectedProductionVersion) throw new Error("Production Worker version changed; stop and review.");
const previewVersionId = liveVersion(previewName);
const production = wranglerJson("versions", "view", productionVersionId, "--name", productionName);
const preview = wranglerJson("versions", "view", previewVersionId, "--name", previewName);

const previewDbId = binding(preview, "DB", "d1").database_id;
const productionDbId = binding(production, "DB", "d1").database_id;
const databases = wranglerJson("d1", "list");
if (databases.find((item) => item.uuid === previewDbId)?.name !== previewName || previewDbId === productionDbId) {
  throw new Error("Preview D1 is not the isolated preview-named database.");
}
const masters = binding(preview, "MASTERS", "r2_bucket").bucket_name;
const images = binding(preview, "IMAGES", "r2_bucket").bucket_name;
if (masters !== "anyaparallax-masters-preview" || images !== "anyaparallax-images-preview" ||
    masters === binding(production, "MASTERS", "r2_bucket").bucket_name ||
    images === binding(production, "IMAGES", "r2_bucket").bucket_name) {
  throw new Error("Preview R2 targets are not isolated.");
}
binding(preview, "IMAGE_TRANSFORMS", "images");
const accessTeam = binding(preview, "ACCESS_TEAM_DOMAIN", "plain_text").text;
const accessAud = binding(preview, "ACCESS_AUD", "plain_text").text;
if (!accessTeam || !accessAud || accessAud === binding(production, "ACCESS_AUD", "plain_text").text) {
  throw new Error("Preview Access settings are missing or not isolated.");
}
for (const key of ["ALLOW_DEVELOPMENT_IDENTITY", "ALLOW_DEVELOPMENT_SEED", "SHOW_DEVELOPMENT_NOTICES"]) {
  if (binding(preview, key, "plain_text").text !== "false") throw new Error(`${key} is not false in preview.`);
}
if (binding(preview, "PUBLIC_SITE_ORIGIN", "plain_text").text !== previewOrigin) {
  throw new Error("Preview canonical origin differs from the approved preview hostname.");
}

const config = JSON.parse(readFileSync(basePath, "utf8"));
if (config.main !== "index.js" || config.assets?.directory !== "../client" ||
    config.d1_databases?.length !== 1 || config.r2_buckets?.length !== 2 ||
    config.routes || config.route || config.triggers?.crons?.length) {
  throw new Error("Generated build payload has an unexpected shape or route.");
}
config.name = previewName;
config.topLevelName = previewName;
config.configPath = outputPath;
config.userConfigPath = outputPath;
config.d1_databases = [{ ...config.d1_databases[0], binding: "DB", database_name: previewName, database_id: previewDbId }];
config.r2_buckets = [
  { binding: "MASTERS", bucket_name: masters, preview_bucket_name: masters },
  { binding: "IMAGES", bucket_name: images, preview_bucket_name: images },
];
config.vars = {
  ACCESS_TEAM_DOMAIN: accessTeam,
  ACCESS_AUD: accessAud,
  ALLOW_DEVELOPMENT_IDENTITY: "false",
  ALLOW_DEVELOPMENT_SEED: "false",
  PUBLIC_SITE_ORIGIN: previewOrigin,
  SHOW_DEVELOPMENT_NOTICES: "false",
};
writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log(`Derived ignored preview config at ${outputPath}`);
console.log(`Preview baseline version: ${previewVersionId}`);
console.log(`Production baseline version (read-only): ${productionVersionId}`);
console.log("Verified: preview-only D1/R2, distinct Access AUD, preview origin, false development valves, no route.");
