import type { MetaFunction } from "react-router";

import { requireManagerAccess } from "../../auth/authorization.server";
import { PlaceholderNotice } from "../../components/PlaceholderNotice";

export const meta: MetaFunction = () => [
  { title: "Maintenance — Anyaparallax manager" },
  { name: "robots", content: "noindex, nofollow" },
];

/** Guarded endpoint: manager role only. */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  await requireManagerAccess(request, context);
  return null;
}

export default function ManagerMaintenanceRoute() {
  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Maintenance</p>
        <h1>Maintenance</h1>
      </header>
      <PlaceholderNotice tone="warning">
        No maintenance operation is implemented, and nothing destructive is wired to this
        page. When operations such as purging derivatives, resetting data or deleting
        accounts arrive, they must require explicit confirmation in the manager area —
        manager authority is not unrestricted destructive authority.
      </PlaceholderNotice>
    </section>
  );
}
