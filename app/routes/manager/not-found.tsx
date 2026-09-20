import type { MetaFunction } from "react-router";
import { Link } from "react-router";

import { requireManagerAccess } from "../../auth/authorization.server";

export const meta: MetaFunction = () => [
  { title: "Not found — Anyaparallax manager" },
  { name: "robots", content: "noindex, nofollow" },
];

/**
 * The guard runs BEFORE the 404 is rendered: unknown `/manager` paths must be
 * denied to non-managers exactly like the known ones.
 */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  await requireManagerAccess(request, context);
  return null;
}

export default function ManagerNotFoundRoute() {
  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">404</p>
        <h1>That manager page does not exist</h1>
        <p className="lede">Check the address, or return to the manager dashboard.</p>
      </header>
      <p className="section-actions">
        <Link className="button" to="/manager">
          Back to dashboard
        </Link>
      </p>
    </section>
  );
}
