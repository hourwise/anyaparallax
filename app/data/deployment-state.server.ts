/**
 * Deployment state, as an operator screen may report it — server only.
 *
 * WHY THIS MODULE EXISTS. The route-structure check forbids a ROUTE from importing the
 * persistence or storage modules directly: routes read data through data modules, so the
 * boundary stays in one place. A deployment summary has to ask whether bindings are
 * present, which means naming them — so it lives here, where that vocabulary belongs, and
 * the manager screen imports only this.
 *
 * WHAT IT REPORTS: presence, never values. No audience tag, no account id, no bucket name,
 * no token and no secret is returned, because a status page is the easiest place in an
 * application for configuration to leak by accident.
 */
import { identityModeFor, type IdentityMode } from "../auth/identity";
import { isD1Binding } from "./repository.d1.server";
import { isR2Bucket } from "./storage.server";

export type DeploymentEnvironment = {
  readonly DB?: unknown;
  readonly MASTERS?: unknown;
  readonly IMAGES?: unknown;
  readonly IMAGE_TRANSFORMS?: unknown;
  // The configuration values this module only ever tests for presence are typed as the
  // strings they are, so the shared identity vocabulary can read them unchanged.
  readonly PUBLIC_SITE_ORIGIN?: string;
  readonly ACCESS_TEAM_DOMAIN?: string;
  readonly ACCESS_AUD?: string;
  readonly ALLOW_DEVELOPMENT_IDENTITY?: string;
  readonly ALLOW_DEVELOPMENT_SEED?: string;
  readonly SHOW_DEVELOPMENT_NOTICES?: string;
};

export type DeploymentState = {
  /** `cloudflare-access`, `development` (local header) or `closed` (deny everything). */
  readonly identityMode: IdentityMode;
  readonly accessConfigured: boolean;
  readonly canonicalOriginConfigured: boolean;
  readonly databaseBound: boolean;
  readonly mastersBound: boolean;
  readonly publicDerivativesBound: boolean;
  readonly imageProcessorBound: boolean;
  readonly developmentIdentity: boolean;
  readonly developmentSeed: boolean;
  readonly developmentNotices: boolean;
};

export function deploymentStateFor(env: DeploymentEnvironment | undefined): DeploymentState {
  const mode = identityModeFor(env);
  const origin = typeof env?.PUBLIC_SITE_ORIGIN === "string" ? env.PUBLIC_SITE_ORIGIN.trim() : "";
  return {
    identityMode: mode,
    accessConfigured: mode === "cloudflare-access",
    canonicalOriginConfigured: origin.length > 0,
    databaseBound: isD1Binding(env?.DB),
    mastersBound: isR2Bucket(env?.MASTERS),
    publicDerivativesBound: isR2Bucket(env?.IMAGES),
    imageProcessorBound: env?.IMAGE_TRANSFORMS !== undefined,
    developmentIdentity: env?.ALLOW_DEVELOPMENT_IDENTITY === "true",
    developmentSeed: env?.ALLOW_DEVELOPMENT_SEED === "true",
    developmentNotices: env?.SHOW_DEVELOPMENT_NOTICES === "true",
  };
}
