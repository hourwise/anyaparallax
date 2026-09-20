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

/**
 * Cache policy for a served derivative (Slice 06 repair 02).
 *
 * `no-store`, and NOT the immutable one-year policy this route used to send.
 *
 * The reason is that the publication decision is MUTABLE while the object key is
 * not. A photograph can be unpublished, or its gallery can be, and that change
 * has to take effect for the very next request to the same URL. A response
 * cached for a year would outlive the database permission that allowed it: a
 * visitor holding a warm cache — or a CDN edge holding one — would keep being
 * served an image the operator has withdrawn, and nothing in this slice can
 * purge it.
 *
 * V1 has no publication-aware cache invalidation or key versioning, so the only
 * honest policy is to revalidate on every request. When versioned derivative
 * keys arrive, this can become immutable again *because the key itself would
 * change on unpublish*, which is the condition that is missing today.
 *
 * The ETag is gone with it: an entity tag only has a purpose when something may
 * reuse a stored representation, and `no-store` forbids exactly that.
 */
const CACHE_CONTROL = "no-store";

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
