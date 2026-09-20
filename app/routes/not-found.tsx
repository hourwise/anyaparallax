import { data, type MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { NotFoundContent } from "../components/NotFoundContent";
import { appEnvironmentFrom } from "../data/context.server";
import { developmentNoticesEnabled } from "../data/site";

export const meta: MetaFunction = () => [
  { title: "Page not found — Anyaparallax Photography" },
  { name: "robots", content: "noindex, nofollow" },
];

/**
 * REPAIR-09A: the 404 status is unchanged, and the body's preview sentence is
 * rendered only when the development notices are enabled — so a visitor to a
 * published site is told the address does not exist, not that the site is a
 * development preview.
 */
export function loader({ context }: { context: unknown }) {
  return data(
    { developmentPreview: developmentNoticesEnabled(appEnvironmentFrom(context)) },
    { status: 404 },
  );
}

export default function NotFoundRoute() {
  const { developmentPreview } = useLoaderData<typeof loader>();
  return <NotFoundContent developmentPreview={developmentPreview} />;
}
