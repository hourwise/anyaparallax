import type { MetaFunction } from "react-router";
import { Link } from "react-router";

import { PlaceholderNotice } from "../components/PlaceholderNotice";

export const meta: MetaFunction = () => [
  { title: "Admin placeholder — Anyaparallax Photography" },
  { name: "robots", content: "noindex, nofollow" },
];

// Slice 05 adds Cloudflare Access identity verification, the application user
// lookup and deny-by-default role checks. Until then this route is only a shell.
const plannedAreas = [
  "Dashboard",
  "Photos",
  "Upload photos",
  "Galleries",
  "Enquiries",
  "Site content",
] as const;

export default function AdminPlaceholderRoute() {
  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Photographer area — not built yet</p>
        <h1>Admin placeholder</h1>
        <p className="lede">
          This is the reserved entry point for Anya's photography workspace.
        </p>
      </header>

      <PlaceholderNotice tone="warning">
        Not secured. There is no authentication, no identity verification and no
        server-side role check here yet — hiding or showing this page proves nothing.
        Cloudflare Access integration and deny-by-default authorization arrive in Slice
        05. The page holds no real functionality, no data and no secrets.
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
