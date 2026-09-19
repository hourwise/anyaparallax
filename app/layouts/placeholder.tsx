import { Link, Outlet } from "react-router";

import { site } from "../data/site";

/**
 * Chrome for the /admin and /manager development placeholders. These routes are
 * not authenticated or authorized in any way yet.
 */
export default function PlaceholderLayout() {
  return (
    <div className="site-shell">
      <header className="placeholder-header">
        <div className="container placeholder-header__inner">
          <Link className="brand" to="/" aria-label="Anyaparallax Photography — home">
            <span className="brand__name">{site.name}</span>
            <span className="brand__tagline">{site.secondary}</span>
          </Link>
          <Link className="placeholder-header__back" to="/">
            Back to public site
          </Link>
        </div>
      </header>
      <main className="container placeholder-main" id="main" tabIndex={-1}>
        <p className="notice notice--warning">
          Development placeholder. This area is not authenticated, not authorized and holds
          no real functionality or data. Access control arrives in Slice 05.
        </p>
        <Outlet />
      </main>
    </div>
  );
}
