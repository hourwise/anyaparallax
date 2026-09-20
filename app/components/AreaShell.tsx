import { Link, NavLink } from "react-router";

import { site } from "../data/site";

/** One entry in an operator area's navigation. */
export type AreaNavItem = {
  readonly to: string;
  readonly label: string;
  /** Match the path exactly (used for the area index so it is not always active). */
  readonly end?: boolean;
};

/** The operator a request is running as. Mirrors the guard result; display only. */
export type AreaOperator = {
  readonly email: string;
  readonly role: string;
  readonly source: "cloudflare-access" | "development";
};

const ROLE_LABELS: Record<string, string> = {
  photographer: "Photographer",
  manager: "Manager",
};

/**
 * Shared chrome for the `/admin` and `/manager` areas.
 *
 * Presentation only: it renders whatever the loader's guard allowed and never
 * makes an authorization decision itself. The development banner matters —
 * a development identity must never look like a verified Cloudflare Access
 * one to the person using the interface.
 */
export function AreaShell({
  areaName,
  navItems,
  operator,
  logoutUrl,
  children,
}: {
  areaName: string;
  navItems: readonly AreaNavItem[];
  operator: AreaOperator;
  logoutUrl: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="area-shell">
      <header className="area-header">
        <div className="container area-header__inner">
          <Link className="brand" to="/" aria-label={`${site.name} — public site`}>
            <span className="brand__name">{site.name}</span>
            <span className="brand__tagline">{areaName}</span>
          </Link>
          <p className="area-identity">
            <span className="area-identity__role">
              {ROLE_LABELS[operator.role] ?? operator.role}
            </span>
            <span className="area-identity__email">{operator.email}</span>
            <span className="area-identity__source" data-source={operator.source}>
              {operator.source === "development" ? "development identity" : "Cloudflare Access"}
            </span>
          </p>
        </div>
        <nav className="area-nav" aria-label={`${areaName} navigation`}>
          <div className="container area-nav__inner">
            <ul className="area-nav__list">
              {navItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    className={({ isActive }) =>
                      isActive ? "area-nav__link area-nav__link--active" : "area-nav__link"
                    }
                    end={item.end ?? false}
                    to={item.to}
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
            <p className="area-nav__aside">
              <Link className="area-nav__link" to="/">
                View public site
              </Link>
              {logoutUrl ? (
                <a className="area-nav__link" href={logoutUrl}>
                  Log out
                </a>
              ) : (
                <span className="area-nav__link area-nav__link--static">
                  Log out via Cloudflare Access
                </span>
              )}
            </p>
          </div>
        </nav>
      </header>
      <main className="container area-main" id="main" tabIndex={-1}>
        {operator.source === "development" ? (
          <p className="notice notice--warning">
            Development identity in use. Cloudflare Access is not configured in this
            environment; this header is accepted on loopback only and must not be enabled in
            a deployment.
          </p>
        ) : null}
        {children}
      </main>
    </div>
  );
}
