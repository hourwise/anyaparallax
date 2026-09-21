import { Link } from "react-router";

import { primaryNav, site } from "../data/site";

/** A social profile the operator has configured, in the order the settings screen lists them. */
export type FooterSocialLink = {
  readonly id: string;
  readonly label: string;
  readonly url: string;
};

type SiteFooterProps = {
  /** Development/preview notices. Set only by the single configuration switch. */
  showDevelopmentNotices?: boolean;
  /** Only the links actually configured; an empty list renders no social chrome at all. */
  socialLinks?: readonly FooterSocialLink[];
  /** The operator's short strapline, rendered only when configured. */
  strapline?: string;
};

/**
 * The public footer.
 *
 * REPAIR-09A gated the two provisional notices; REPAIR-09E gated the social block, whose
 * "accounts are added once the operator confirms the links" sentence was operator process
 * rather than public content. This version completes that arc: the footer renders a Follow
 * list ONLY from profiles the operator has actually configured, so an unconfigured site
 * has no social chrome and an empty heading is impossible.
 *
 * It also carries the two additions the operator asked for: a Privacy link (the site needs
 * a destination for it before anonymous launch) and the PCGSoft build credit, kept
 * understated and marked up as an ordinary link.
 */
export function SiteFooter({
  showDevelopmentNotices = false,
  socialLinks = [],
  strapline = "",
}: SiteFooterProps) {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="container footer__inner">
        <div className="footer__brand">
          <p className="footer__title">
            {site.name} {site.secondary}
          </p>
          {strapline.length > 0 ? <p className="footer__note">{strapline}</p> : null}
          {showDevelopmentNotices ? <p className="footer__note">{site.provisionalNote}</p> : null}
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

        {socialLinks.length > 0 ? (
          <nav className="footer__social" aria-label="Social profiles">
            <h2 className="footer__heading">Follow</h2>
            <ul>
              {socialLinks.map((link) => (
                <li key={link.id}>
                  <a href={link.url} rel="me noopener noreferrer" target="_blank">
                    {link.label}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <div className="footer__meta">
          <p>
            &copy; {year} {site.name} {site.secondary}
          </p>
          <p className="footer__note">
            <Link to="/privacy">Privacy</Link>
          </p>
          <p className="footer__note footer__credit">
            Built by{" "}
            <a href="https://pcgsoft.co.uk" rel="noopener noreferrer" target="_blank">
              PCGSoft
            </a>{" "}
            &copy; 2026
          </p>
          {showDevelopmentNotices ? (
            <p className="footer__note">{site.provisionalFooterNote}</p>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
