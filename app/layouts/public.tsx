import { Outlet, useLoaderData } from "react-router";

import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { appEnvironmentFrom } from "../data/context.server";
import { developmentNoticesEnabled } from "../data/site";

/**
 * The public shell.
 *
 * REPAIR-09A: the one thing this loader does is decide whether the site's
 * development/preview notices are rendered, from the single configuration value
 * they all depend on. It is read here because the footer needs it and the footer
 * belongs to this layout; the value is also returned by the routes whose own
 * sections carry a notice or a preview meta description.
 */
export async function loader({ context }: { context: unknown }) {
  return { showDevelopmentNotices: developmentNoticesEnabled(appEnvironmentFrom(context)) };
}

export default function PublicLayout() {
  const { showDevelopmentNotices } = useLoaderData<typeof loader>();

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main className="site-main" id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <SiteFooter showDevelopmentNotices={showDevelopmentNotices} />
    </div>
  );
}
