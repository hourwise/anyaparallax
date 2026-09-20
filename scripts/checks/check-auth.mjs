#!/usr/bin/env node
/**
 * Authentication and authorization checks (Slice 05).
 *
 * Everything here runs in-process against the application's own TypeScript
 * source, so the boundary is exercised the way the runtime uses it:
 *
 * 1. Vocabulary — email normalisation, loopback recognition, Access
 *    configuration parsing and the reported identity mode.
 * 2. Access JWT verification — REAL RS256 signatures from a key pair generated
 *    in this process, so the production signature path (issuer, audience,
 *    expiry, not-before, algorithm, key id) is tested without the network.
 * 3. Identity resolution — a verified Access JWT wins; a bare
 *    `cf-access-authenticated-user-email` header is NOT an identity; the
 *    development header needs BOTH the flag and a loopback host, and is ignored
 *    entirely once Access is configured.
 * 4. Account lookup — active, inactive, unknown, case-insensitive, malformed,
 *    and the fail-loudly behaviour when no user source exists.
 * 5. Role guards — 401 without identity, 403 for unknown/inactive/wrong role,
 *    deny-by-default for an empty role set, and forged role information in
 *    headers, cookies and the query string being ignored.
 * 6. Secret hygiene — no `.env`/`.dev.vars`, no key-shaped or token-shaped
 *    material, no Access configuration committed, placeholder `.test` emails.
 */
import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RouterContextProvider } from "react-router";

import {
  accessConfigurationFrom,
  identityModeFor,
  isLoopbackHostname,
  normaliseEmail,
  normaliseTeamDomain,
} from "../../app/auth/identity.ts";
import { resolveIdentity, verifyAccessToken } from "../../app/auth/identity.server.ts";
import { findAccountByEmail, listAccounts } from "../../app/auth/accounts.server.ts";
import {
  authorizeRequest,
  requireAdminAccess,
  requireManagerAccess,
} from "../../app/auth/authorization.server.ts";
import { appContext } from "../../app/data/context.ts";
import { APP_ROLES, isAppRole } from "../../app/data/model.ts";
import { seed } from "../../app/data/seed.ts";
import { check, note, report } from "./report.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Count every assertion so the summary reports the size of the suite. */
let assertions = 0;
function expect(condition, message) {
  assertions += 1;
  check(condition, message);
}

// --- Fixtures -------------------------------------------------------------

const PHOTOGRAPHER_EMAIL = "photographer@anyaparallax.test";
const MANAGER_EMAIL = "manager@anyaparallax.test";
const INACTIVE_EMAIL = "deactivated@anyaparallax.test";
const UNKNOWN_EMAIL = "stranger@anyaparallax.test";

/** Local development identity: header enabled, seed accounts available. */
const developmentEnv = {
  ALLOW_DEVELOPMENT_IDENTITY: "true",
  ALLOW_DEVELOPMENT_SEED: "true",
};

/** Seed accounts only; no identity mechanism at all. */
const closedEnv = { ALLOW_DEVELOPMENT_SEED: "true" };

const accessConfig = { teamDomain: "anyaparallax.cloudflareaccess.test", audience: "aud-tag" };

/** Environment configured for Cloudflare Access, with the dev header also enabled. */
const accessEnv = {
  ACCESS_TEAM_DOMAIN: accessConfig.teamDomain,
  ACCESS_AUD: accessConfig.audience,
  ALLOW_DEVELOPMENT_IDENTITY: "true",
  ALLOW_DEVELOPMENT_SEED: "true",
};

function requestTo(path, headers = {}, origin = "http://localhost:5173") {
  return new Request(`${origin}${path}`, { headers });
}

/** A context exactly as the Worker entry builds it. */
function contextFor(env) {
  const context = new RouterContextProvider();
  context.set(appContext, { env });
  return context;
}

/** Header material a client might try to use to invent authority. */
function forgedRoleHeaders(identityEmail) {
  return {
    "x-anyaparallax-development-identity": identityEmail,
    "x-anyaparallax-role": "manager",
    "cf-anyaparallax-role": "manager",
    role: "manager",
    cookie: "anyaparallax-role=manager; role=manager",
  };
}

async function capture(operation) {
  try {
    return { value: await operation(), error: null };
  } catch (error) {
    return { value: null, error };
  }
}

/** Read the status from a guard denial (a thrown `data()` value or ErrorResponse). */
function denialStatus(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const init = value.init;
  if (init && typeof init.status === "number") {
    return init.status;
  }
  return typeof value.status === "number" ? value.status : null;
}

function denialMessage(value) {
  const payload = value?.data;
  return payload && typeof payload.message === "string" ? payload.message : null;
}

async function denialOf(operation) {
  const { error } = await capture(operation);
  return error;
}

// --- 1. Vocabulary --------------------------------------------------------

expect(normaliseEmail("  Anya@Example.TEST ") === "anya@example.test", "email is not trimmed/lower-cased");
expect(normaliseEmail("not-an-email") === null, "malformed email accepted");
expect(normaliseEmail("a@b") === null, "address without a dotted domain accepted");
expect(normaliseEmail("") === null, "empty email accepted");
expect(normaliseEmail(null) === null, "null email accepted");
expect(normaliseEmail(`${"a".repeat(250)}@example.test`) === null, "over-long email accepted");

expect(isLoopbackHostname("localhost"), "localhost not recognised as loopback");
expect(isLoopbackHostname("127.0.0.1"), "127.0.0.1 not recognised as loopback");
expect(isLoopbackHostname("[::1]"), "[::1] not recognised as loopback");
expect(!isLoopbackHostname("anyaparallax.example"), "public host treated as loopback");
expect(!isLoopbackHostname("localhost.attacker.example"), "lookalike host treated as loopback");

expect(normaliseTeamDomain("https://Team.CloudflareAccess.com/") === "team.cloudflareaccess.com", "team domain not normalised");
expect(normaliseTeamDomain("  ") === null, "blank team domain accepted");
expect(normaliseTeamDomain("two words") === null, "team domain with whitespace accepted");

expect(accessConfigurationFrom({ ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com" }) === null, "half-configured Access accepted");
expect(accessConfigurationFrom({ ACCESS_AUD: "aud" }) === null, "audience without team domain accepted");
expect(accessConfigurationFrom(accessEnv)?.audience === "aud-tag", "complete Access configuration rejected");

expect(identityModeFor(accessEnv) === "cloudflare-access", "Access mode not reported");
expect(identityModeFor(developmentEnv) === "development", "development mode not reported");
expect(identityModeFor({}) === "closed", "unconfigured mode not reported as closed");

// --- 2. Access JWT verification (real RS256) ------------------------------

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: "jwk" });
const keySet = { keys: [{ ...publicJwk, kid: "test-key-1", alg: "RS256" }] };
const provideKeySet = async () => keySet;
const failingKeySet = async () => {
  throw new Error("key set unavailable");
};

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function signedToken(claims, headerExtras = {}) {
  const header = base64Url(
    JSON.stringify({ alg: "RS256", kid: "test-key-1", typ: "JWT", ...headerExtras }),
  );
  const payload = base64Url(JSON.stringify(claims));
  const signature = signBytes("sha256", Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${base64Url(signature)}`;
}

function accessClaims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: `https://${accessConfig.teamDomain}`,
    aud: accessConfig.audience,
    iat: now,
    nbf: now - 10,
    exp: now + 600,
    email: PHOTOGRAPHER_EMAIL,
    sub: "operator-1",
    ...overrides,
  };
}

const validIdentity = await verifyAccessToken(signedToken(accessClaims()), accessConfig, provideKeySet);
expect(validIdentity?.email === PHOTOGRAPHER_EMAIL, "a valid Access JWT was not accepted");
expect(validIdentity?.source === "cloudflare-access", "Access identity source mis-reported");

const audienceListIdentity = await verifyAccessToken(
  signedToken(accessClaims({ aud: ["other-aud", accessConfig.audience] })),
  accessConfig,
  provideKeySet,
);
expect(audienceListIdentity?.email === PHOTOGRAPHER_EMAIL, "audience list containing the app was rejected");

expect(
  (await verifyAccessToken(signedToken(accessClaims({ aud: "someone-elses-app" })), accessConfig, provideKeySet)) === null,
  "JWT for another audience was accepted",
);
expect(
  (await verifyAccessToken(signedToken(accessClaims({ iss: "https://evil.cloudflareaccess.test" })), accessConfig, provideKeySet)) === null,
  "JWT from another issuer was accepted",
);
expect(
  (await verifyAccessToken(signedToken(accessClaims({ exp: Math.floor(Date.now() / 1000) - 3600 })), accessConfig, provideKeySet)) === null,
  "expired JWT was accepted",
);
expect(
  (await verifyAccessToken(signedToken(accessClaims({ nbf: Math.floor(Date.now() / 1000) + 3600 })), accessConfig, provideKeySet)) === null,
  "not-yet-valid JWT was accepted",
);
expect(
  (await verifyAccessToken(signedToken(accessClaims({ email: undefined })), accessConfig, provideKeySet)) === null,
  "JWT without an email claim was accepted",
);

const otherKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const foreignSignature = signBytes(
  "sha256",
  Buffer.from(
    `${base64Url(JSON.stringify({ alg: "RS256", kid: "test-key-1" }))}.${base64Url(JSON.stringify(accessClaims()))}`,
  ),
  otherKeys.privateKey,
);
expect(
  (await verifyAccessToken(
    `${signedToken(accessClaims()).split(".").slice(0, 2).join(".")}.${base64Url(foreignSignature)}`,
    accessConfig,
    provideKeySet,
  )) === null,
  "JWT signed by a foreign key was accepted",
);

const unsignedHeader = base64Url(JSON.stringify({ alg: "none", kid: "test-key-1" }));
const unsignedPayload = base64Url(JSON.stringify(accessClaims()));
expect(
  (await verifyAccessToken(`${unsignedHeader}.${unsignedPayload}.`, accessConfig, provideKeySet)) === null,
  "unsigned (alg none) token was accepted",
);
expect(
  (await verifyAccessToken(signedToken(accessClaims(), { alg: "HS256" }), accessConfig, provideKeySet)) === null,
  "HS256 token was accepted",
);
expect(
  (await verifyAccessToken(signedToken(accessClaims(), { kid: "unknown-key" }), accessConfig, provideKeySet)) === null,
  "token with an unknown key id was accepted",
);
expect((await verifyAccessToken("not.a.jwt", accessConfig, provideKeySet)) === null, "garbage token was accepted");
expect(
  (await verifyAccessToken(signedToken(accessClaims()), accessConfig, failingKeySet)) === null,
  "token was accepted while the key set was unavailable",
);

// --- 3. Identity resolution ----------------------------------------------

const devIdentity = await resolveIdentity(
  requestTo("/admin", { "x-anyaparallax-development-identity": "  PHOTOGRAPHER@Anyaparallax.TEST " }),
  developmentEnv,
);
expect(devIdentity?.email === PHOTOGRAPHER_EMAIL, "development identity header not resolved");
expect(devIdentity?.source === "development", "development identity source mis-reported");

expect(
  (await resolveIdentity(
    requestTo("/admin", { "x-anyaparallax-development-identity": PHOTOGRAPHER_EMAIL }),
    closedEnv,
  )) === null,
  "development identity accepted while the flag is disabled",
);
expect(
  (await resolveIdentity(
    requestTo("/admin", { "x-anyaparallax-development-identity": PHOTOGRAPHER_EMAIL }, "http://192.168.1.20:5173"),
    developmentEnv,
  )) === null,
  "development identity accepted off loopback",
);
expect(
  (await resolveIdentity(requestTo("/admin"), developmentEnv)) === null,
  "development environment resolved an identity without the header",
);
expect(
  (await resolveIdentity(
    requestTo("/admin", { "x-anyaparallax-development-identity": "not-an-email" }),
    developmentEnv,
  )) === null,
  "malformed development identity accepted",
);

const accessIdentity = await resolveIdentity(
  requestTo("/admin", { "cf-access-jwt-assertion": signedToken(accessClaims({ email: MANAGER_EMAIL })) }),
  { ...accessEnv, ...{ ACCESS_TEAM_DOMAIN: accessConfig.teamDomain } },
);
// The default key set provider would fetch the real Access endpoint; a JWT that
// cannot be verified without the network must therefore resolve to null here.
expect(accessIdentity === null, "unverifiable Access JWT resolved to an identity");

expect(
  (await resolveIdentity(requestTo("/admin"), accessEnv)) === null,
  "Access environment resolved an identity without an assertion",
);
expect(
  (await resolveIdentity(
    requestTo("/admin", {
      "cf-access-authenticated-user-email": PHOTOGRAPHER_EMAIL,
      "x-anyaparallax-role": "manager",
    }),
    accessEnv,
  )) === null,
  "bare Access email header treated as an identity",
);
expect(
  (await resolveIdentity(
    requestTo("/admin", { "cf-access-jwt-assertion": "not.a.jwt" }),
    accessEnv,
  )) === null,
  "malformed Access assertion accepted",
);
expect(
  (await resolveIdentity(
    requestTo("/admin", { "x-anyaparallax-development-identity": PHOTOGRAPHER_EMAIL }),
    accessEnv,
  )) === null,
  "development identity accepted while Access is configured",
);
expect(
  (await resolveIdentity(
    requestTo("/admin", { "x-anyaparallax-development-identity": PHOTOGRAPHER_EMAIL }),
    { ALLOW_DEVELOPMENT_IDENTITY: "TRUE" },
  )) === null,
  "development identity accepted for a case-variant flag value",
);

// --- 4. Account lookup ----------------------------------------------------

const photographerAccount = await findAccountByEmail(PHOTOGRAPHER_EMAIL, closedEnv);
expect(photographerAccount?.role === "photographer", "photographer account not resolved");
expect(photographerAccount?.active === true, "active account reported inactive");

const managerAccount = await findAccountByEmail("MANAGER@ANYAPARALLAX.TEST", closedEnv);
expect(managerAccount?.role === "manager", "manager lookup is not case-insensitive");

const inactiveAccount = await findAccountByEmail(INACTIVE_EMAIL, closedEnv);
expect(inactiveAccount?.active === false, "inactive account not reported as inactive");

expect((await findAccountByEmail(UNKNOWN_EMAIL, closedEnv)) === null, "unknown email resolved to an account");
expect((await findAccountByEmail("not-an-email", closedEnv)) === null, "malformed email resolved to an account");

const accounts = await listAccounts(closedEnv);
expect(accounts.length === seed.users.length, "account list does not match the seed users");
expect(accounts.every((account) => isAppRole(account.role)), "account list contains an unsupported role");
expect(accounts[0]?.role === "manager", "account list is not ordered managers-first");

const unavailable = await capture(() => findAccountByEmail(PHOTOGRAPHER_EMAIL, {}));
expect(
  unavailable.error instanceof Error && /D1 binding/.test(unavailable.error.message),
  "account lookup without a user source did not fail loudly",
);
const unavailableList = await capture(() => listAccounts({}));
expect(unavailableList.error instanceof Error, "account listing without a user source did not fail loudly");

// --- 5. Role guards -------------------------------------------------------

const anonymousAdmin = await denialOf(() =>
  requireAdminAccess(requestTo("/admin"), contextFor(closedEnv)),
);
expect(denialStatus(anonymousAdmin) === 401, "anonymous /admin request was not 401");
const anonymousManager = await denialOf(() =>
  requireManagerAccess(requestTo("/manager"), contextFor(developmentEnv)),
);
expect(denialStatus(anonymousManager) === 401, "anonymous /manager request was not 401");

const photographerAdmin = await capture(() =>
  requireAdminAccess(
    requestTo("/admin", { "x-anyaparallax-development-identity": PHOTOGRAPHER_EMAIL }),
    contextFor(developmentEnv),
  ),
);
expect(photographerAdmin.value?.role === "photographer", "photographer was denied /admin");
expect(photographerAdmin.value?.source === "development", "authorised user source mis-reported");

const photographerManager = await denialOf(() =>
  requireManagerAccess(
    requestTo("/manager", { "x-anyaparallax-development-identity": PHOTOGRAPHER_EMAIL }),
    contextFor(developmentEnv),
  ),
);
expect(denialStatus(photographerManager) === 403, "photographer was not denied /manager");
expect(
  denialMessage(photographerManager)?.includes("manager") === true,
  "wrong-role denial does not explain the missing authority",
);

const managerManager = await capture(() =>
  requireManagerAccess(
    requestTo("/manager", { "x-anyaparallax-development-identity": MANAGER_EMAIL }),
    contextFor(developmentEnv),
  ),
);
expect(managerManager.value?.role === "manager", "manager was denied /manager");
const managerAdmin = await capture(() =>
  requireAdminAccess(
    requestTo("/admin", { "x-anyaparallax-development-identity": MANAGER_EMAIL }),
    contextFor(developmentEnv),
  ),
);
expect(managerAdmin.value?.role === "manager", "manager was denied the shared /admin area");

const inactiveDenial = await denialOf(() =>
  requireAdminAccess(
    requestTo("/admin", { "x-anyaparallax-development-identity": INACTIVE_EMAIL }),
    contextFor(developmentEnv),
  ),
);
expect(denialStatus(inactiveDenial) === 403, "inactive account was not denied with 403");

const unknownDenial = await denialOf(() =>
  requireAdminAccess(
    requestTo("/admin", { "x-anyaparallax-development-identity": UNKNOWN_EMAIL }),
    contextFor(developmentEnv),
  ),
);
expect(denialStatus(unknownDenial) === 403, "unknown account was not denied with 403");
expect(
  denialMessage(unknownDenial) === denialMessage(inactiveDenial),
  "unknown and inactive accounts produce distinguishable denials",
);

// Forged role information changes nothing.
const forgedManager = await denialOf(() =>
  requireManagerAccess(
    requestTo("/manager?role=manager", forgedRoleHeaders(PHOTOGRAPHER_EMAIL)),
    contextFor(developmentEnv),
  ),
);
expect(denialStatus(forgedManager) === 403, "forged role headers upgraded a photographer");
const forgedAnonymous = await denialOf(() =>
  requireManagerAccess(requestTo("/manager?role=manager", forgedRoleHeaders("")), contextFor(developmentEnv)),
);
expect(denialStatus(forgedAnonymous) === 401, "forged role headers provided an identity");

// Deny-by-default: an empty role set authorises nobody, even the manager.
const emptyRoles = await denialOf(() =>
  authorizeRequest(
    requestTo("/anywhere", { "x-anyaparallax-development-identity": MANAGER_EMAIL }),
    contextFor(developmentEnv),
    [],
  ),
);
expect(denialStatus(emptyRoles) === 403, "an empty role set did not deny");

// Without a real runtime context there is no environment, so no identity mechanism.
const contextless = await denialOf(() =>
  requireAdminAccess(
    requestTo("/admin", { "x-anyaparallax-development-identity": PHOTOGRAPHER_EMAIL }),
    undefined,
  ),
);
expect(denialStatus(contextless) === 401, "a context-less request was not denied");

// --- 6. Secret hygiene ----------------------------------------------------

expect(!existsSync(resolve(root, ".env")), ".env exists in the repository root");
expect(!existsSync(resolve(root, ".dev.vars")), ".dev.vars exists in the repository root");

const forbiddenMaterial = [
  { label: "a private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "an AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { label: "a Slack token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { label: "a GitHub token", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { label: "a password literal", pattern: /(password|passwd)\s*[:=]\s*["'][^"']+["']/i },
];

function sourceFiles() {
  const files = [];
  for (const directory of ["app", "workers", "scripts", "migrations"]) {
    for (const entry of readdirSync(resolve(root, directory), { recursive: true })) {
      const relative = `${directory}/${String(entry)}`;
      if (!/\.(ts|tsx|mjs|js|sql)$/.test(relative)) {
        continue;
      }
      if (relative === "scripts/checks/check-auth.mjs") {
        continue; // this file names the patterns it forbids
      }
      files.push(relative);
    }
  }
  files.push("README.md", "wrangler.jsonc", "package.json");
  return files;
}

for (const relative of sourceFiles()) {
  const source = readFileSync(resolve(root, relative), "utf8");
  for (const { label, pattern } of forbiddenMaterial) {
    expect(!pattern.test(source), `${relative} contains ${label}`);
  }
}

const wranglerSource = readFileSync(resolve(root, "wrangler.jsonc"), "utf8");
expect(
  !/"ACCESS_(AUD|TEAM_DOMAIN)"\s*:/.test(wranglerSource),
  "wrangler.jsonc configures Access values that belong to a deployment",
);

for (const user of seed.users) {
  expect(user.email.endsWith(".test"), `seed user ${user.id} does not use the reserved .test domain`);
  expect(isAppRole(user.role), `seed user ${user.id} has an unsupported role`);
  expect(APP_ROLES.includes(user.role), `seed user ${user.id} role is outside the V1 role list`);
}
expect(
  seed.users.some((user) => user.role === "manager" && user.active),
  "no active manager exists in the seed users",
);
expect(
  seed.users.some((user) => user.role === "photographer" && user.active),
  "no active photographer exists in the seed users",
);
expect(
  seed.users.some((user) => !user.active),
  "no inactive account exists to prove deactivation is enforced",
);

note(`development identity header: ${seed.users.filter((user) => user.active).map((user) => user.email).join(", ")}`);

report(
  `Authentication check passed: ${assertions} assertions over identity verification, account lookup, role guards and secret hygiene.`,
);
