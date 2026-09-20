import type { MetaFunction } from "react-router";

import { requireAdminAccess } from "../../auth/authorization.server";
import { PlaceholderNotice } from "../../components/PlaceholderNotice";

export const meta: MetaFunction = () => [
  { title: "Photos — Anyaparallax admin" },
  { name: "robots", content: "noindex, nofollow" },
];

/** Guarded endpoint: denies on its own, independently of the layout. */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
  return null;
}

export default function AdminPhotosRoute() {
  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Photos</p>
        <h1>Photo library</h1>
      </header>
      <PlaceholderNotice>
        Not built yet. Metadata editing, tag assignment, publish/unpublish and featured
        selection arrive with the upload and image slice. The page is already behind the
        photographer/manager guard, so the route itself is protected today.
      </PlaceholderNotice>
    </section>
  );
}
