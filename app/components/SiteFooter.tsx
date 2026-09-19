import { Link } from "react-router";

import { primaryNav, site } from "../data/site";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="container footer__inner">
        <div className="footer__brand">
          <p className="footer__title">
            {site.name} {site.secondary}
          </p>
          <p className="footer__note">{site.provisionalNote}</p>
        </div>

        <nav className="footer__nav" aria-label="Footer">
          <ul>
            {primaryNav.map((item) => (
              <li key={item.to}>
                <Link to={item.to}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="footer__meta">
          <p>
            &copy; {year} {site.name} {site.secondary}
          </p>
          <p className="footer__note">
            Social links and the contact address are added once the operator confirms them.
          </p>
        </div>
      </div>
    </footer>
  );
}
