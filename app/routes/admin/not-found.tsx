import type { MetaFunction } from "react-router";
import { Link } from "react-router";

import { requireAdminAccess } from "../../auth/authorization.server";

export const meta: MetaFunction = () => [
  { title: "Not found — Anyaparallax admin" },
  { name: "robots", content: "noindex, nofollow" },
];

/**
 * The guard runs BEFORE the 404 is rendered, so an unauthorised request cannot
 * use unknown `/admin` paths to learn which addresses exist.
 */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
  return null;
}

export default function AdminNotFoundRoute() {
  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">404</p>
        <h1>That admin page does not exist</h1>
        <p className="lede">
          Check the address, or return to your dashboard.
        </p>
      </header>
      <p className="section-actions">
        <Link className="button" to="/admin">
          Back to dashboard
        </Link>
      </p>
    </section>
  );
}
