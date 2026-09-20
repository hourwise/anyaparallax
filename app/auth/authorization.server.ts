/**
 * Deny-by-default request guards — the authorization half of Slice 05.
 *
 * Every protected route and endpoint calls one of these helpers in its LOADER
 * (never in a component): hiding a link is presentation, not security. The
 * guard composes the two server-side steps:
 *
 *   1. identity  — a verified Cloudflare Access JWT, or the loopback-only
 *                  development identity (`identity.server.ts`);
 *   2. authority — an active account row for that email, whose role must be in
 *                  the set the surface allows (`accounts.server.ts`).
 *
 * A request that proves no identity is refused with 401; a proven identity
 * whose account is missing, deactivated or of the wrong role is refused with
 * 403. Nothing about the account is echoed back, so denials are not an
 * account-enumeration oracle beyond the email the caller already proved.
 *
 * Guards are called by each protected route module as well as by its layout:
 * React Router may run nested loaders in parallel, so a layout guard alone is
 * not a scheduling guarantee. Each endpoint denies for itself.
 */
import { data } from "react-router";

import { appEnvironmentFrom } from "../data/context.server";
import type { AppRole } from "../data/model";
import { findAccountByEmail } from "./accounts.server";
import type { IdentitySource } from "./identity";
import { resolveIdentity } from "./identity.server";

/** The operator identity an authorised request runs as. */
export type AuthorisedUser = {
  readonly email: string;
  readonly role: AppRole;
  /** How the identity was proven; the UI must distinguish development from Access. */
  readonly source: IdentitySource;
};

/** Who may use Anya's `/admin` surface: the photographer, and the manager. */
export const ADMIN_AREA_ROLES: readonly AppRole[] = ["photographer", "manager"];

/** Who may use the technical `/manager` surface: the manager only. */
export const MANAGER_AREA_ROLES: readonly AppRole[] = ["manager"];

const SIGN_IN_MESSAGE =
  "Sign in to continue. This area is restricted to site operators.";
const NOT_AUTHORISED_MESSAGE =
  "This identity is not an authorised site operator, or the account is deactivated.";
const WRONG_ROLE_MESSAGE = "This area requires manager authority.";

/** Throw a route error response the operator-facing boundary renders. */
function deny(status: 401 | 403, message: string): never {
  throw data({ accessDenied: true, status, message }, { status });
}

/**
 * Authorise a request against an explicit role set. Reads the environment from
 * the React Router context, so callers pass their loader arguments through.
 */
export async function authorizeRequest(
  request: Request,
  context: unknown,
  allowedRoles: readonly AppRole[],
): Promise<AuthorisedUser> {
  const env = appEnvironmentFrom(context);

  const identity = await resolveIdentity(request, env);
  if (!identity) {
    deny(401, SIGN_IN_MESSAGE);
  }

  // A verified identity is not yet an authorised user: the directory decides.
  const account = await findAccountByEmail(identity.email, env);
  if (!account || !account.active) {
    deny(403, NOT_AUTHORISED_MESSAGE);
  }
  if (!allowedRoles.includes(account.role)) {
    deny(403, WRONG_ROLE_MESSAGE);
  }

  return { email: account.email, role: account.role, source: identity.source };
}

/** `/admin`: Anya's photography workspace, reachable by photographer and manager. */
export function requireAdminAccess(request: Request, context: unknown): Promise<AuthorisedUser> {
  return authorizeRequest(request, context, ADMIN_AREA_ROLES);
}

/** `/manager`: the technical surface, reachable by the manager role only. */
export function requireManagerAccess(
  request: Request,
  context: unknown,
): Promise<AuthorisedUser> {
  return authorizeRequest(request, context, MANAGER_AREA_ROLES);
}
