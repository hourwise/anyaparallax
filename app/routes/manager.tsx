import type { MetaFunction } from "react-router";
import { Link } from "react-router";

import { PlaceholderNotice } from "../components/PlaceholderNotice";

export const meta: MetaFunction = () => [
  { title: "Manager placeholder — Anyaparallax Photography" },
  { name: "robots", content: "noindex, nofollow" },
];

// Slice 05 adds the separate Manager identity, server-side verification and the
// higher-authority technical surface. Until then this route is only a shell.
const plannedAreas = [
  "Site status",
  "Database status",
  "Storage status",
  "Authentication and authorised users",
  "Configuration",
  "Diagnostics",
  "Maintenance",
  "Test tools",
] as const;

export default function ManagerPlaceholderRoute() {
  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Manager area — not built yet</p>
        <h1>Manager placeholder</h1>
        <p className="lede">
          This is the reserved entry point for the site maintainer's technical interface.
        </p>
      </header>

      <PlaceholderNotice tone="warning">
        Not secured. No authentication, no separate Manager identity and no server-side
        role enforcement exist yet. Slice 05 adds them, along with deny-by-default
        authorization for every technical endpoint. No credentials, bindings or
        diagnostics are present on this page.
      </PlaceholderNotice>

      <h2>Planned areas</h2>
      <ul className="plain-list">
        {plannedAreas.map((area) => (
          <li key={area}>
            {area} <span className="muted">— not implemented</span>
          </li>
        ))}
      </ul>

      <p className="section-actions">
        <Link className="button" to="/">
          Back to public site
        </Link>
      </p>
    </section>
  );
}
