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
          A quick look at how the site is running, and who can sign in to manage it.
        </p>
      </header>

      <StatusTable caption="Authentication" entries={diagnostics.identity.entries} />
      <StatusTable caption="Database" entries={diagnostics.database.entries} />
      <StatusTable caption="Storage" entries={diagnostics.storage.entries} />

      <h2>Who can sign in</h2>
      <p className="muted">
        Photographers can use the photography workspace at <code>/admin</code>. Managers can
        use that and this area too. Role changes take effect straight away.
      </p>
      <table className="status-table">
        <caption>People who can sign in</caption>
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

      <h2>More tools</h2>
      <ul className="plain-list">
        <li>
          <Link className="text-link" to="/manager/diagnostics">
            Diagnostics
          </Link>{" "}
          <span className="muted">— a detailed technical health check, for troubleshooting</span>
        </li>
        <li>
          <Link className="text-link" to="/manager/settings">
            Settings
          </Link>{" "}
          <span className="muted">— add people, change roles and review how the site is set up</span>
        </li>
        <li>
          <Link className="text-link" to="/manager/maintenance">
            Maintenance
          </Link>{" "}
          <span className="muted">— check that stored photos and records are in good order</span>
        </li>
      </ul>
    </section>
  );
}
