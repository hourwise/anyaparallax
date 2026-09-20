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
import { site } from "./data/site";

export const links: LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
];

/**
 * The default document metadata.
 *
 * REPAIR-09A: the description is the site's own truthful description, with no
 * development/preview wording. Root metadata is the fallback for any route that
 * does not set its own description, so a preview sentence here would reach pages
 * that have nothing to do with the preview state.
 */
export const meta: MetaFunction = () => [
  { title: "Anyaparallax Photography" },
  { name: "description", content: site.description },
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
        {/*
          REPAIR-09A: stage-neutral wording. This boundary is the last resort when a
          loader has already failed, so it has no configuration to read and must not
          guess at the preview state; "this development preview" described the whole
          site as unfinished on every error a visitor could reach.
        */}
        <p className="lede">
          {isNotFound
            ? "That address does not exist."
            : "The page you asked for could not be rendered."}
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
