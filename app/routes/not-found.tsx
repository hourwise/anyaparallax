import { data, type MetaFunction } from "react-router";

import { NotFoundContent } from "../components/NotFoundContent";

export const meta: MetaFunction = () => [
  { title: "Page not found — Anyaparallax Photography" },
  { name: "robots", content: "noindex, nofollow" },
];

export function loader() {
  return data(null, { status: 404 });
}

export default function NotFoundRoute() {
  return <NotFoundContent />;
}
