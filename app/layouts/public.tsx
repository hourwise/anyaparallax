import { Outlet, useLoaderData } from "react-router";

import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { appEnvironmentFrom } from "../data/context.server";
import { developmentNoticesEnabled } from "../data/site";
import { readPublicSiteSettings } from "../data/site-settings.server";

/**
 * The public shell.
 *
 * REPAIR-09A: this loader decides whether the site's development/preview notices are
 * rendered, from the single configuration value they all depend on.
 *
 * It also reads the operator's workspace settings, because the footer is where the
 * configured social profiles appear. Settings are read for EVERY public page: one small
 * query, and the alternative — a second loader on each page — would read the same table
 * repeatedly.
 */
export async function loader({ context }: { context: unknown }) {
  const env = appEnvironmentFrom(context);
  const [showDevelopmentNotices, settings] = await Promise.all([
    Promise.resolve(developmentNoticesEnabled(env)),
    readPublicSiteSettings(env),
  ]);
  return {
    showDevelopmentNotices,
    socialLinks: settings.socialLinks,
    strapline: settings.strapline,
  };
}

export default function PublicLayout() {
  const { showDevelopmentNotices, socialLinks, strapline } = useLoaderData<typeof loader>();

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main className="site-main" id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <SiteFooter
        showDevelopmentNotices={showDevelopmentNotices}
        socialLinks={socialLinks}
        strapline={strapline}
      />
    </div>
  );
}
