import type { MetaFunction } from "react-router";
import { Outlet, useLoaderData } from "react-router";

import { requireAdminAccess } from "../auth/authorization.server";
import { accessLogoutUrl } from "../auth/identity";
import { AccessErrorPage } from "../components/AccessErrorPage";
import { AreaShell, type AreaNavItem } from "../components/AreaShell";
import { appEnvironmentFrom } from "../data/context.server";
import { site } from "../data/site";

export const meta: MetaFunction = () => [
  { title: `Admin — ${site.name}` },
  { name: "robots", content: "noindex, nofollow" },
];

/** Anya's workspace. Photo work is added in later slices; the boundary is here. */
const navItems: readonly AreaNavItem[] = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/photos", label: "Photos" },
  { to: "/admin/upload", label: "Upload photos" },
  { to: "/admin/galleries", label: "Galleries" },
  { to: "/admin/settings", label: "Settings" },
];

/**
 * Server-side guard for the whole `/admin` area. Child routes repeat the guard
 * in their own loaders — see the note in `app/routes.ts`.
 */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  const user = await requireAdminAccess(request, context);
  return { user, logoutUrl: accessLogoutUrl(appEnvironmentFrom(context)) };
}

export default function AdminLayout() {
  const { user, logoutUrl } = useLoaderData<typeof loader>();

  return (
    <AreaShell areaName="Admin" navItems={navItems} operator={user} logoutUrl={logoutUrl}>
      <Outlet />
    </AreaShell>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <AccessErrorPage error={error} />;
}
