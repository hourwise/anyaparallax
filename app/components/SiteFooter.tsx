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
          <h2 className="footer__heading">Explore</h2>
          <ul>
            {primaryNav.map((item) => (
              <li key={item.to}>
                <Link to={item.to}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="footer__social">
          <h2 className="footer__heading">Social</h2>
          <p className="footer__note">
            Anya&rsquo;s social accounts are added once the operator confirms the exact
            links. Nothing is linked here yet.
          </p>
          <p className="footer__note">
            <Link to="/contact">Contact</Link> for enquiries — the form arrives later.
          </p>
        </div>

        <div className="footer__meta">
          <p>
            &copy; {year} {site.name} {site.secondary}
          </p>
          <p className="footer__note">Development preview. Not approved final content.</p>
        </div>
      </div>
    </footer>
  );
}
