import { isRouteErrorResponse, Link } from "react-router";

/**
 * Error boundary content for the operator areas (Slice 05).
 *
 * A guard denial arrives as a route error response with status 401 or 403: the
 * boundary explains who to ask for access without echoing the account, the
 * email or whether an account exists at all. Anything else (for example a
 * missing D1 binding) is reported as a plain error, with the message shown only
 * during local development.
 */
export function AccessErrorPage({ error }: { error: unknown }) {
  const isDenial =
    isRouteErrorResponse(error) && (error.status === 401 || error.status === 403);

  const message =
    isDenial && typeof (error.data as { message?: unknown } | undefined)?.message === "string"
      ? ((error.data as { message: string }).message)
      : "This area is restricted to site operators.";

  const title = !isDenial
    ? "Something went wrong"
    : error.status === 401
      ? "Sign in required"
      : "Access denied";

  return (
    <div className="area-shell">
      <main className="page container" id="main" tabIndex={-1}>
        <p className="eyebrow">Restricted area</p>
        <h1>{title}</h1>
        <p className="lede">{isDenial ? message : "This area could not be served."}</p>
        {!isDenial && import.meta.env.DEV && error instanceof Error ? (
          <pre className="error-detail">{error.message}</pre>
        ) : null}
        <p className="section-actions">
          <Link className="button" to="/">
            Back to public site
          </Link>
        </p>
      </main>
    </div>
  );
}
