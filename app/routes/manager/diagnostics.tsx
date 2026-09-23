import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { requireManagerAccess } from "../../auth/authorization.server";
import { StatusTable } from "../../components/StatusTable";
import { appEnvironmentFrom } from "../../data/context.server";
import { loadManagerDiagnostics } from "../../data/diagnostics.server";

export const meta: MetaFunction = () => [
  { title: "Diagnostics — Anyaparallax manager" },
  { name: "robots", content: "noindex, nofollow" },
];

/**
 * Read-only diagnostics. Everything reported here is a binding presence, a row
 * or object count, or a configuration STATE — never a secret, token or key.
 */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  await requireManagerAccess(request, context);
  return { diagnostics: await loadManagerDiagnostics(appEnvironmentFrom(context)) };
}

export default function ManagerDiagnosticsRoute() {
  const { diagnostics } = useLoaderData<typeof loader>();

  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Diagnostics</p>
        <h1>Technical health check</h1>
        <p className="lede">
          A detailed view for troubleshooting. Counts are read live, and each setting is only
          shown as present or missing. No passwords, keys or other secret values appear here.
        </p>
      </header>

      <StatusTable caption="Identity" entries={diagnostics.identity.entries} />
      <StatusTable caption="Database" entries={diagnostics.database.entries} />
      <StatusTable caption="Storage" entries={diagnostics.storage.entries} />
      <StatusTable caption="Configuration" entries={diagnostics.configuration} />
    </section>
  );
}
