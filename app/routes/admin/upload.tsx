import type { MetaFunction } from "react-router";

import { requireAdminAccess } from "../../auth/authorization.server";
import { PlaceholderNotice } from "../../components/PlaceholderNotice";

export const meta: MetaFunction = () => [
  { title: "Upload photos — Anyaparallax admin" },
  { name: "robots", content: "noindex, nofollow" },
];

/** Guarded endpoint: denies on its own, independently of the layout. */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
  return null;
}

export default function AdminUploadRoute() {
  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Upload</p>
        <h1>Upload photos</h1>
      </header>
      <PlaceholderNotice>
        Not built yet. Upload validation, original preservation, derivatives and
        watermarks arrive in the upload and image slice. Uploads will write the private
        master to the masters bucket and only ever serve generated derivatives.
      </PlaceholderNotice>
    </section>
  );
}
