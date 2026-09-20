/**
 * Public derivative serving (Slice 06) — server side.
 *
 * `GET /media/*` is the only way a stored object reaches a browser, and this
 * module is where the decision lives. The route module next to it exports one
 * loader and nothing else, because React Router removes server code from
 * `loader` and `action` exports but NOT from any other export — a helper
 * exported from a route file drags its imports into the client build.
 *
 * Three rules, in order:
 *
 *  1. The path must name a PUBLIC image. `refFromPublicUrl` refuses anything
 *     outside `r2://images/`, so a PRIVATE key cannot be requested even by a
 *     caller who knows it. This is the load-bearing line: the masters bucket is
 *     unreachable over HTTP by construction, not by a check that could be
 *     reordered.
 *  2. The object must exist. An invalid path and a missing object return the
 *     same bare 404, so the route is not an existence oracle for either domain.
 *  3. The response is cacheable, because a derivative key is written once per
 *     upload and never rewritten.
 */
import { refFromPublicUrl } from "../data/storage";
import { isR2Bucket, readPublicImageFrom } from "../data/storage.server";

/** A derivative's key never changes, so the response may be cached for a year. */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

/** A bare 404: no body, and no hint about whether the object exists. */
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
 * server, and so the refusal behaviour is asserted directly rather than inferred
 * from served HTML.
 */
export async function serveMedia(splat: string, environment: unknown): Promise<Response> {
  // Rule 1: the key must be a public image reference. A well-formed PRIVATE key
  // is refused here, before any bucket is touched.
  const key = refFromPublicUrl(`/media/${splat}`);
  if (key === null) {
    return notFound();
  }

  const images = (environment as { IMAGES?: unknown } | undefined)?.IMAGES;
  if (!isR2Bucket(images)) {
    // No bucket bound: nothing can be served. A deployment missing the binding
    // fails closed instead of inventing an image.
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
