import { Link } from "react-router";

import { primaryNav, site } from "../data/site";

/**
 * The public footer.
 *
 * REPAIR-09A: the two provisional/preview notices it used to render
 * unconditionally are now shown only when the caller says development notices are
 * enabled — the single switch in `app/data/site.ts`. With notices off the footer
 * keeps its brand, navigation, social and copyright blocks and simply states
 * nothing about the site being unfinished, which is what a published site must
 * do. No substitute wording is invented to fill the gap.
 */
export function SiteFooter({ showDevelopmentNotices = false }: { showDevelopmentNotices?: boolean }) {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="container footer__inner">
        <div className="footer__brand">
          <p className="footer__title">
            {site.name} {site.secondary}
          </p>
          {showDevelopmentNotices ? (
            <p className="footer__note">{site.provisionalNote}</p>
          ) : null}
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
            <Link to="/contact">Contact</Link> for enquiries, or <Link to="/prints">prints</Link> to
            register interest. Both are answered personally.
          </p>
        </div>

        <div className="footer__meta">
          <p>
            &copy; {year} {site.name} {site.secondary}
          </p>
          {showDevelopmentNotices ? (
            <p className="footer__note">{site.provisionalFooterNote}</p>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
