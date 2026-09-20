/**
 * Public derivative serving (Slice 06 repair 01) — server side.
 *
 * `GET /media/*` is the only way a stored object reaches a browser, and this
 * module is where the decision lives. The route module next to it exports one
 * loader and nothing else, because React Router removes server code from
 * `loader` and `action` exports but NOT from any other export — a helper
 * exported from a route file drags its imports into the client build.
 *
 * Four rules, in order:
 *
 *  1. The path must name a PUBLIC image. `refFromPublicUrl` refuses anything
 *     outside `r2://images/`, so a PRIVATE key cannot be requested even by a
 *     caller who knows it.
 *  2. The key must belong to a PUBLISHED photograph in a PUBLISHED gallery.
 *     Existence in the bucket is not authority: drafts live there too. This is
 *     the rule that keeps an unpublished upload unreachable even when its exact
 *     URL is known.
 *  3. The object must exist. Every refusal above returns the same bare 404, so
 *     the response cannot distinguish "not published" from "not there".
 *  4. The response is cacheable, because a derivative key is written once per
 *     upload and never rewritten.
 */
import { appEnvironmentFrom } from "../data/context.server";
import { isD1Binding } from "../data/repository.d1.server";
import { refFromPublicUrl } from "../data/storage";
import { isR2Bucket, readPublicImageFrom } from "../data/storage.server";
import { isPublishedDerivative } from "./media-publication.server";

/** A derivative's key never changes, so the response may be cached for a year. */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

/** A bare 404: no body, and no hint about which rule refused the request. */
function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

/**
 * Resolve and serve one public derivative.
 *
 * Exported so the media check can exercise the real path without a running
 * server, and so every refusal is asserted directly rather than inferred from
 * served HTML.
 */
export async function serveMedia(splat: string, environment: unknown): Promise<Response> {
  // Rule 1: the key must be a public image reference. A well-formed PRIVATE key
  // is refused here, before any bucket or database is touched.
  const key = refFromPublicUrl(`/media/${splat}`);
  if (key === null) {
    return notFound();
  }

  const env = environment as { DB?: unknown; IMAGES?: unknown } | undefined;

  // Rule 2: publication. Without a database there is no way to prove the
  // derivative is published, and an unprovable claim is refused rather than
  // assumed — a deployment missing its binding fails closed.
  if (!isD1Binding(env?.DB)) {
    return notFound();
  }
  try {
    if (!(await isPublishedDerivative(env.DB, key))) {
      return notFound();
    }
  } catch {
    // A database error must not become an accidental grant.
    return notFound();
  }

  // Rule 3: the object itself.
  const images = env?.IMAGES;
  if (!isR2Bucket(images)) {
    return notFound();
  }
  try {
    const object = await readPublicImageFrom(images, key);
    if (!object) {
      return notFound();
    }
    return new Response(object.bytes, {
      status: 200,
      headers: {
        "content-type": object.contentType,
        "content-length": String(object.bytes.byteLength),
        "cache-control": CACHE_CONTROL,
        // Derivatives are images, never documents: no sniffing, no indexing.
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex",
        etag: `"${key}"`,
      },
    });
  } catch {
    // A key that fails its own domain validation is treated exactly like a
    // missing object: the caller learns nothing about why.
    return notFound();
  }
}

/** The route entry point. A `*` splat carries the object path. */
export async function loader({
  params,
  context,
}: {
  params: Record<string, string | undefined>;
  context: unknown;
}): Promise<Response> {
  return serveMedia(params["*"] ?? "", appEnvironmentFrom(context));
}
