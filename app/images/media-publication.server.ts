/**
 * Publication boundary for public derivative serving (Slice 06 repair 01).
 *
 * An object existing in the IMAGES bucket is NOT authority to serve it. The
 * bucket holds derivatives for drafts too — an operator uploads and reviews
 * before publishing — so "the key exists" would make every unpublished
 * photograph readable by anyone who guessed or kept its URL.
 *
 * Before any object is read, the EXACT requested key must belong to a
 * photograph that is published inside a gallery that is published. Anything
 * else — an unpublished photograph, a photograph in an unpublished gallery, a
 * key that belongs to no photograph, a malformed path, a master-shaped path — is
 * the same bare 404, so the response cannot be used to discover whether an
 * unpublished object exists.
 *
 * Server-only: it reads D1.
 */
import type { D1DatabaseBinding } from "../data/repository.d1.server";

/**
 * Is `key` a derivative of a published photograph in a published gallery?
 *
 * Matches on the stored column rather than reconstructing a key from parts, so
 * there is exactly one definition of what a photograph's derivative key is: the
 * one `processUpload` wrote into the row.
 */
export async function isPublishedDerivative(
  db: D1DatabaseBinding,
  key: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `SELECT 1 AS allowed
         FROM photos p
         JOIN galleries g ON g.id = p.gallery_id
        WHERE p.published = 1
          AND g.published = 1
          AND (p.web_storage_key = ?1 OR p.thumbnail_storage_key = ?1)
        LIMIT 1`,
    )
    .bind(key)
    .all<{ allowed: number }>();
  return (result.results?.length ?? 0) > 0;
}
