import type { MetaFunction } from "react-router";

import { requireManagerAccess } from "../../auth/authorization.server";
import { PlaceholderNotice } from "../../components/PlaceholderNotice";

export const meta: MetaFunction = () => [
  { title: "Settings — Anyaparallax manager" },
  { name: "robots", content: "noindex, nofollow" },
];

/** Guarded endpoint: manager role only. */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  await requireManagerAccess(request, context);
  return null;
}

export default function ManagerSettingsRoute() {
  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Settings</p>
        <h1>Deployment settings</h1>
      </header>
      <PlaceholderNotice>
        Not built yet. Deployment preferences will live here, behind the same manager
        guard. Identity configuration (Cloudflare Access team domain and audience) is
        deployment configuration and is documented in README.md rather than edited from
        the interface.
      </PlaceholderNotice>
    </section>
  );
}
