import type { MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { requireManagerAccess } from "../../auth/authorization.server";
import { listAccounts } from "../../auth/accounts.server";
import { StatusTable } from "../../components/StatusTable";
import { appEnvironmentFrom } from "../../data/context.server";
import { loadManagerDiagnostics } from "../../data/diagnostics.server";

export const meta: MetaFunction = () => [
  { title: "Manager dashboard — Anyaparallax Photography" },
  { name: "robots", content: "noindex, nofollow" },
];

/**
 * Manager surface. The guard runs in this loader as well as in the layout, and
 * the account list is read from the authorised-user directory — the same source
 * the guard used — never from anything the client supplied.
 */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  const user = await requireManagerAccess(request, context);
  const env = appEnvironmentFrom(context);
  const [diagnostics, accounts] = await Promise.all([
    loadManagerDiagnostics(env),
    listAccounts(env),
  ]);
  return { user, diagnostics, accounts };
}

export default function ManagerDashboardRoute() {
  const { diagnostics, accounts } = useLoaderData<typeof loader>();

  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Manager</p>
        <h1>Site status</h1>
        <p className="lede">
          Functional foundations for maintenance: live binding, storage and identity state
          from this deployment, plus the authorised users who can sign in.
        </p>
      </header>

      <StatusTable caption="Authentication" entries={diagnostics.identity.entries} />
      <StatusTable caption="Database" entries={diagnostics.database.entries} />
      <StatusTable caption="Storage" entries={diagnostics.storage.entries} />

      <h2>Authorised users</h2>
      <p className="muted">
        Roles are read from the database on every request. A photographer signs into
        <code> /admin</code> only; managers may use both areas.
      </p>
      <table className="status-table">
        <caption>Authorised-user directory</caption>
        <thead>
          <tr>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            <th scope="col">Active</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id}>
              <th scope="row">{account.email}</th>
              <td>{account.role}</td>
              <td>{account.active ? "yes" : "no"}</td>
              <td className="muted">{account.updatedAt.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Technical areas</h2>
      <ul className="plain-list">
        <li>
          <Link className="text-link" to="/manager/diagnostics">
            Diagnostics
          </Link>{" "}
          <span className="muted">— bindings, object counts and configuration state</span>
        </li>
        <li>
          <Link className="text-link" to="/manager/settings">
            Settings
          </Link>{" "}
          <span className="muted">— application accounts and this deployment's state</span>
        </li>
        <li>
          <Link className="text-link" to="/manager/maintenance">
            Maintenance
          </Link>{" "}
          <span className="muted">— integrity checks and stored-object reporting</span>
        </li>
      </ul>
    </section>
  );
}
