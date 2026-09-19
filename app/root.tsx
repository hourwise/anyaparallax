import type { LinksFunction, MetaFunction } from "react-router";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import "./app.css";

export const links: LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
];

export const meta: MetaFunction = () => [
  { title: "Anyaparallax Photography" },
  {
    name: "description",
    content:
      "Anyaparallax photography — night cities, live music and the moments after dark. Development preview.",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <div className="site-shell">
      <main className="page container" id="main" tabIndex={-1}>
        <p className="eyebrow">{isNotFound ? "404" : "Error"}</p>
        <h1>{isNotFound ? "Page not found" : "Something went wrong"}</h1>
        <p className="lede">
          {isNotFound
            ? "That address does not exist in this development preview."
            : "This development preview could not render the page you asked for."}
        </p>
        {!isNotFound && import.meta.env.DEV && error instanceof Error ? (
          <pre className="error-detail">{error.message}</pre>
        ) : null}
        <p>
          <a className="button" href="/">
            Back to home
          </a>
        </p>
      </main>
    </div>
  );
}
