import type { MetaFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";

import { requireManagerAccess } from "../../auth/authorization.server";
import { ACCOUNT_ROLES, ROLE_LABELS, parseUserIntent } from "../../auth/user-management";
import { managedUsersView, userManagerFor } from "../../auth/user-management.server";
import { appEnvironmentFrom } from "../../data/context.server";
import { deploymentStateFor } from "../../data/deployment-state.server";
import { isSameOriginRequest, refuseCrossOriginRequest } from "../../lib/same-origin";

export const meta: MetaFunction = () => [
  { title: "Settings — Anyaparallax manager" },
  { name: "robots", content: "noindex, nofollow" },
];

/**
 * Manager settings: application-level management, never environment editing.
 *
 * Cloudflare Access admits a person; this table decides what they may do. The page says
 * so plainly, because an operator who confuses the two will either believe removing a
 * row locks somebody out of the site (it does not) or that adding one grants access
 * (it does not, unless Access admits that address).
 *
 * The deployment summary reports PRESENCE — a binding exists, a value is configured —
 * and never a value: no audience tag, no account id, no token. A status page must not
 * become a configuration leak.
 */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  await requireManagerAccess(request, context);
  const env = appEnvironmentFrom(context);
  const view = await managedUsersView(env);
  // Presence only: the data module owns the binding vocabulary, and nothing here returns a
  // value an operator could mistake for something to edit.
  return { view, deployment: deploymentStateFor(env) };
}

type ActionData = { readonly message: string; readonly tone: "ok" | "warning" };

export async function action({ request, context }: { request: Request; context: unknown }) {
  await requireManagerAccess(request, context);
  if (!isSameOriginRequest(request)) {
    throw refuseCrossOriginRequest();
  }
  const env = appEnvironmentFrom(context);
  const manager = userManagerFor(env);
  if (!manager) {
    return {
      message: "No database is configured in this environment, so nothing was changed.",
      tone: "warning" as const,
    };
  }

  const form = await request.formData();
  const intent = parseUserIntent(form.get("intent"));
  if (!intent) {
    return {
      message: "That action was not recognised, so nothing was changed.",
      tone: "warning" as const,
    };
  }
  const userId = String(form.get("userId") ?? "");

  if (intent === "create") {
    const result = await manager.create(form.get("email"), form.get("role"));
    switch (result.status) {
      case "ok":
        return {
          message: `Added. ${result.persisted.email} now has the ${result.persisted.role} role and can sign in once Cloudflare Access lets that address in.`,
          tone: "ok" as const,
        };
      case "duplicate":
        return { message: `${result.email} already has access.`, tone: "warning" as const };
      case "bad-request":
        return { message: result.error, tone: "warning" as const };
      default:
        return { message: "The account could not be saved.", tone: "warning" as const };
    }
  }

  const result =
    intent === "role"
      ? await manager.setRole(userId, form.get("role"))
      : await manager.setActive(userId, intent === "activate");

  switch (result.status) {
    case "ok":
      return {
        message:
          intent === "role"
            ? `${result.persisted.email} now has the ${result.persisted.role} role.`
            : `${result.persisted.email} is now ${result.persisted.active ? "active" : "deactivated"}.`,
        tone: "ok" as const,
      };
    case "last-manager":
      return {
        message:
          "That would leave the site with no active manager, so nothing was changed. Add or reactivate another manager first.",
        tone: "warning" as const,
      };
    case "not-found":
      return { message: "That account no longer exists.", tone: "warning" as const };
    case "bad-request":
      return { message: result.error, tone: "warning" as const };
    default:
      return { message: "The change could not be saved.", tone: "warning" as const };
  }
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

export default function ManagerSettingsRoute() {
  const { view, deployment } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const busy = useNavigation().state !== "idle";

  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Manager</p>
        <h1>Settings</h1>
        <p className="lede">
          Who can use the management areas, and how the site is set up. Cloudflare Access
          controls who can reach these areas at all; this list controls what each person can
          do once they're in.
        </p>
      </header>

      {actionData ? (
        <p
          className={actionData.tone === "ok" ? "notice notice--ok" : "notice notice--warning"}
          role="status"
        >
          {actionData.message}
        </p>
      ) : null}

      <section className="workspace-block" aria-labelledby="accounts-heading">
        <h2 id="accounts-heading">Authorised accounts</h2>
        {!view.available ? (
          <p className="notice notice--warning">{view.reason}</p>
        ) : (
          <>
            <div className="table-scroll">
              <table className="admin-table">
                <caption className="visually-hidden">
                  Authorised application accounts and their roles
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Active</th>
                    <th scope="col">Change role</th>
                    <th scope="col">Access</th>
                  </tr>
                </thead>
                <tbody>
                  {view.users.map((user) => (
                    <tr key={user.id}>
                      <td data-label="Email">{user.email}</td>
                      <td data-label="Role">{user.role}</td>
                      <td data-label="Active">{yesNo(user.active)}</td>
                      <td data-label="Change role">
                        <Form method="post" className="inline-form">
                          <input type="hidden" name="intent" value="role" />
                          <input type="hidden" name="userId" value={user.id} />
                          <label className="visually-hidden" htmlFor={`role-${user.id}`}>
                            Role for {user.email}
                          </label>
                          <select id={`role-${user.id}`} name="role" defaultValue={user.role}>
                            {ACCOUNT_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                          <button type="submit" disabled={busy}>
                            Save role
                          </button>
                        </Form>
                      </td>
                      <td data-label="Access">
                        <Form method="post" className="inline-form">
                          <input
                            type="hidden"
                            name="intent"
                            value={user.active ? "deactivate" : "activate"}
                          />
                          <input type="hidden" name="userId" value={user.id} />
                          <button type="submit" disabled={busy}>
                            {user.active ? "Deactivate" : "Reactivate"}
                          </button>
                        </Form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="field-help">
              The site always needs at least one active manager, so the last one can't be
              deactivated or given a different role.
            </p>

            <Form method="post" className="stack-form">
              <input type="hidden" name="intent" value="create" />
              <label htmlFor="new-user-email">Add someone by email address</label>
              <input id="new-user-email" name="email" type="email" required />
              <label htmlFor="new-user-role">Role</label>
              <select id="new-user-role" name="role" defaultValue="photographer">
                {ACCOUNT_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={busy}>
                Add account
              </button>
            </Form>
          </>
        )}
      </section>

      <section className="workspace-block" aria-labelledby="deployment-heading">
        <h2 id="deployment-heading">Site setup</h2>
        <p className="field-help">
          For reference only. Each item shows whether it's set up, never its actual value, and
          nothing here can be changed from this page. The three development-only settings at
          the bottom should all say "no" on the live site.
        </p>
        <div className="table-scroll">
          <table className="admin-table">
            <caption className="visually-hidden">Deployment configuration presence</caption>
            <tbody>
              <tr>
                <th scope="row">Sign-in method</th>
                <td data-label="State">{deployment.identityMode}</td>
              </tr>
              <tr>
                <th scope="row">Cloudflare Access set up</th>
                <td data-label="State">{yesNo(deployment.accessConfigured)}</td>
              </tr>
              <tr>
                <th scope="row">Public web address set</th>
                <td data-label="State">{yesNo(deployment.canonicalOriginConfigured)}</td>
              </tr>
              <tr>
                <th scope="row">Database connected</th>
                <td data-label="State">{yesNo(deployment.databaseBound)}</td>
              </tr>
              <tr>
                <th scope="row">Original photo storage connected</th>
                <td data-label="State">{yesNo(deployment.mastersBound)}</td>
              </tr>
              <tr>
                <th scope="row">Public image storage connected</th>
                <td data-label="State">{yesNo(deployment.publicDerivativesBound)}</td>
              </tr>
              <tr>
                <th scope="row">Image processing connected</th>
                <td data-label="State">{yesNo(deployment.imageProcessorBound)}</td>
              </tr>
              <tr>
                <th scope="row">Test sign-in (development only)</th>
                <td data-label="State">{yesNo(deployment.developmentIdentity)}</td>
              </tr>
              <tr>
                <th scope="row">Sample content fallback (development only)</th>
                <td data-label="State">{yesNo(deployment.developmentSeed)}</td>
              </tr>
              <tr>
                <th scope="row">Preview notices (development only)</th>
                <td data-label="State">{yesNo(deployment.developmentNotices)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
