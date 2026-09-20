import type { MetaFunction } from "react-router";

import { requireAdminAccess } from "../../auth/authorization.server";
import { PlaceholderNotice } from "../../components/PlaceholderNotice";

export const meta: MetaFunction = () => [
  { title: "Settings — Anyaparallax admin" },
  { name: "robots", content: "noindex, nofollow" },
];

/** Guarded endpoint: denies on its own, independently of the layout. */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
  return null;
}

export default function AdminSettingsRoute() {
  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Settings</p>
        <h1>Workspace settings</h1>
      </header>
      <PlaceholderNotice>
        Not built yet. Watermark defaults, gallery copy and enquiry preferences belong to
        Anya's workspace and arrive with the relevant slices. Technical configuration is
        deliberately NOT exposed here — that surface belongs to the manager area.
      </PlaceholderNotice>
    </section>
  );
}
