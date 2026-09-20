/**
 * Platform verification route (Slice 06 repair 01).
 *
 * The Cloudflare Images binding, the R2 buckets and D1 exist only inside the
 * Worker runtime, so the only way to verify the REAL image adapter against them
 * is to drive the running app. This route is that driver — and nothing else.
 *
 * It is deliberately inert outside local development:
 *
 *   * it refuses every request unless `ALLOW_DEVELOPMENT_IDENTITY` is exactly
 *     "true", the same development-only switch the local sign-in header uses, so
 *     a deployment that has not disabled its development switches is the only
 *     place this can respond at all;
 *   * it performs no privileged action of its own: it calls the SAME production
 *     pipeline (`ingestUploads`) that `/admin/upload` calls, with the same
 *     validation, the same buckets and the same atomic commit. It cannot store
 *     anything the admin form could not.
 *
 * It is a verification surface, not a second upload path: the route adds no new
 * capability, which is why it is safe to keep in the tree rather than deleting
 * it and losing the ability to measure the platform on demand.
 */
import { appEnvironmentFrom } from "../data/context.server";

type Bindings = {
  ALLOW_DEVELOPMENT_IDENTITY?: string;
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value, null, 2), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** The same bare 404 the media route uses, so the route is indistinguishable when off. */
function unavailable(): Response {
  return new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

function flagsOf(context: unknown): Bindings {
  return (appEnvironmentFrom(context) ?? {}) as Bindings;
}

/** Report which platform pieces this environment has. */
export async function loader({ context }: { context: unknown }) {
  const env = appEnvironmentFrom(context);
  if (flagsOf(context).ALLOW_DEVELOPMENT_IDENTITY !== "true") {
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
  if (flagsOf(context).ALLOW_DEVELOPMENT_IDENTITY !== "true") {
    return unavailable();
  }

  const url = new URL(request.url);
  const form = await request.formData();
  const files: { filename: string; declaredType: string; bytes: Uint8Array }[] = [];
  for (const entry of form.getAll("photos")) {
    if (typeof entry === "string") {
      continue;
    }
    const file = entry as File;
    files.push({
      filename: file.name,
      declaredType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }
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
