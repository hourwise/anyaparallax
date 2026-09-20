/**
 * Platform verification route (Slice 06 repairs 01–02).
 *
 * The Cloudflare Images binding, the R2 buckets and D1 exist only inside the
 * Worker runtime, so the only way to verify the REAL image adapter against them
 * is to drive the running app. This route is that driver — and nothing else.
 *
 * It is deliberately inert outside a local development machine, and the gate is
 * TWO conditions, both required:
 *
 *   1. `ALLOW_DEVELOPMENT_IDENTITY` is exactly "true" (the same development-only
 *      switch the local sign-in header uses; a case variant is not a match);
 *   2. the request's hostname is LOOPBACK, judged by `isLoopbackHostname()` — the
 *      SAME rule the authentication boundary uses, not a second implementation.
 *
 * The second condition is what makes this safe. Repair 01 checked only the flag,
 * and since `pnpm dev` sets that flag to "true" in `wrangler.jsonc`, a deployment
 * that inherited the development configuration would have exposed an
 * unauthenticated path into the real upload pipeline: it would mutate D1 and R2
 * without ever calling `requireAdminAccess`. Loopback-only means a request must
 * already have arrived on the operator's own machine.
 *
 * The gate runs BEFORE `request.formData()` and before any binding or database
 * work, so a refused request cannot parse a body, read a bucket or touch a row.
 *
 * It is a verification surface, not a second upload path: it adds no capability,
 * because it calls the same production pipeline as `/admin/upload` with the same
 * validation and the same atomic commit.
 */
import { appEnvironmentFrom } from "../data/context.server";
import { isLoopbackHostname } from "../auth/identity";

/** The same bare 404 the media route uses, so the route is indistinguishable when off. */
function unavailable(): Response {
  return new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value, null, 2), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * True when this request may use the verification surface.
 *
 * Exported so the rule itself is testable, and so both the loader and the action
 * are provably using the same decision rather than two copies of it.
 */
export function isVerificationRequest(request: Request, environment: unknown): boolean {
  const flag = (environment as { ALLOW_DEVELOPMENT_IDENTITY?: unknown } | undefined)
    ?.ALLOW_DEVELOPMENT_IDENTITY;
  if (flag !== "true") {
    return false;
  }
  try {
    // The SAME loopback rule as the authentication boundary: localhost, 127.0.0.1
    // and ::1 only. A lookalike such as `localhost.attacker.example` is not
    // loopback, and `URL` lower-cases and brackets IPv6 consistently.
    return isLoopbackHostname(new URL(request.url).hostname);
  } catch {
    // An unparseable URL cannot be shown to be loopback, so it is not.
    return false;
  }
}

/** Report which platform pieces this environment has. */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  const env = appEnvironmentFrom(context);
  // Gate FIRST: no body parsing, no binding access, no database work.
  if (!isVerificationRequest(request, env)) {
    return unavailable();
  }
  // The readiness check lives in the server module: a route must not name a
  // binding, or its imports reach the client bundle and the build refuses them.
  const { platformReadiness } = await import("../images/upload.server");
  return json({ bound: platformReadiness(env) });
}

/**
 * Ingest a multipart submission through the production pipeline and report both
 * the pipeline's own outcome and the rows that now exist, so a check can compare
 * the report against the database rather than trusting either alone.
 */
export async function action({ request, context }: { request: Request; context: unknown }) {
  const env = appEnvironmentFrom(context);
  // Gate FIRST, and before `request.formData()`: a request that is not from the
  // operator's own machine must not cause this route to parse a body, read a
  // bucket or touch a row. The same rule the loader uses, from one function.
  if (!isVerificationRequest(request, env)) {
    return unavailable();
  }

  const { fileSourcesFrom } = await import("../images/upload-request.server");
  const url = new URL(request.url);
  const form = await request.formData();
  // Lazy sources: the batch policy is applied to the parsed metadata here, and
  // the bodies are read one at a time inside `ingestUploads`. This route never
  // builds an array of byte arrays.
  const files = fileSourcesFrom(form);
  if (files.length === 0) {
    return json({ error: "no files" });
  }

  const { ingestUploads } = await import("../images/upload.server");
  const report = await ingestUploads({
    env: env as never,
    files,
    options: {
      title: url.searchParams.get("title") ?? "Verification upload",
      description: "platform verification",
      galleryId: url.searchParams.get("gallery") ?? "gallery-nightlife",
      tags: url.searchParams.getAll("tag"),
      location: null,
      captureDate: null,
      watermarkEnabled: url.searchParams.get("watermark") !== "off",
      watermarkPosition:
        (url.searchParams.get("position") as "bottom-right" | "center" | "none") ?? "bottom-right",
      published: url.searchParams.get("published") !== "false",
      featured: false,
      printAvailable: false,
    },
  });

  // Read the rows back so the check can assert on the DATABASE, not on the
  // report the same code produced. The environment is narrowed structurally
  // rather than by naming the binding type, so this route stays free of any
  // storage or database coupling.
  const db = (env as { DB?: { prepare(query: string): { all<T>(): Promise<{ results?: T[] }> } } } | undefined)
    ?.DB;
  const rows = db
    ? (
        await db
          .prepare(
            "SELECT id, slug, title, published, gallery_id, width, height, original_storage_key, web_storage_key, thumbnail_storage_key, watermark_enabled, watermark_position FROM photos ORDER BY created_at DESC LIMIT 12",
          )
          .all<Record<string, unknown>>()
      ).results ?? []
    : [];

  return json({ report, rows });
}
