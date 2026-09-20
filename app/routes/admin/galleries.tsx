import type { MetaFunction } from "react-router";

import { requireAdminAccess } from "../../auth/authorization.server";
import { PlaceholderNotice } from "../../components/PlaceholderNotice";

export const meta: MetaFunction = () => [
  { title: "Galleries — Anyaparallax admin" },
  { name: "robots", content: "noindex, nofollow" },
];

/** Guarded endpoint: denies on its own, independently of the layout. */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
  return null;
}

export default function AdminGalleriesRoute() {
  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Galleries</p>
        <h1>Manage galleries</h1>
      </header>
      <PlaceholderNotice>
        Not built yet. Creating collections, ordering them and choosing covers is part of
        the management slice. Until then, galleries come from the seeded data reading the
        same tables this page will edit.
      </PlaceholderNotice>
    </section>
  );
}
