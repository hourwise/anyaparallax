/**
 * Public portfolio queries — the single boundary between stored portfolio data
 * and anything a visitor can see.
 *
 * Three contracts are enforced here:
 *
 * 1. VISIBILITY — a photograph is publicly visible only when `published` is
 *    true, and a gallery only when its own `published` flag is true.
 *    Unpublished and unknown items are indistinguishable publicly: public
 *    routes render the same 404 for both.
 *
 * 2. PROJECTION — every export returns explicit public view types built field
 *    by field, so private-master fields (for example `originalStorageKey`) and
 *    other internal columns cannot reach loader payloads. Loader data is
 *    serialised to the browser, so anything returned here is effectively public.
 *
 * 3. SOURCE — routes never touch a storage technology. This module selects the
 *    repository:
 *
 *      D1 binding present            → D1PortfolioRepository (the real store)
 *      no binding + seed allowed     → SeedPortfolioRepository (local only)
 *      no binding + seed not allowed → throws, so a misconfigured deployment
 *                                      fails loudly instead of serving stale data
 *
 *    The seed fallback is controlled by the `ALLOW_DEVELOPMENT_SEED` variable
 *    in `wrangler.jsonc`, which must be "false" for a real deployment.
 */
import type {
  PublicGallery,
  PublicGalleryWithPhotos,
  PublicPhoto,
  PublicPhotoWithGallery,
  PublicTag,
} from "./model";
import type { PortfolioRepository, PublicPhotoDetail } from "./repository";

/** The Cloudflare bindings and variables this application reads. */
export type AppEnvironment = {
  readonly DB?: unknown;
  readonly MASTERS?: unknown;
  readonly IMAGES?: unknown;
  readonly ALLOW_DEVELOPMENT_SEED?: string;
};

export type { PublicPhotoDetail };

/**
 * Repository instances are cached per binding object. They hold no per-request
 * state; the cache only avoids re-constructing them on every request.
 */
const d1Repositories = new WeakMap<object, PortfolioRepository>();
let seedRepository: PortfolioRepository | null = null;

async function repositoryFor(env: AppEnvironment | undefined): Promise<PortfolioRepository> {
  const db = env?.DB;
  if (db && typeof db === "object" && typeof (db as { prepare?: unknown }).prepare === "function") {
    const key = db as object;
    const cached = d1Repositories.get(key);
    if (cached) {
      return cached;
    }
    const { D1PortfolioRepository } = await import("./repository.d1.server");
    const repository: PortfolioRepository = new D1PortfolioRepository(
      db as ConstructorParameters<typeof D1PortfolioRepository>[0],
    );
    d1Repositories.set(key, repository);
    return repository;
  }

  if (env?.ALLOW_DEVELOPMENT_SEED === "true") {
    seedRepository ??= new (await import("./repository.seed.server")).SeedPortfolioRepository();
    return seedRepository;
  }

  throw new Error(
    "No D1 binding is available and ALLOW_DEVELOPMENT_SEED is not enabled. " +
      "Configure the DB binding in wrangler.jsonc, or run with ALLOW_DEVELOPMENT_SEED=true " +
      "for local development.",
  );
}

// ---------------------------------------------------------------------------
// Public API — async, projected, source-agnostic.
// ---------------------------------------------------------------------------

/** Published galleries, in configured display order. */
export async function listPublishedGalleries(
  env?: AppEnvironment,
): Promise<readonly PublicGallery[]> {
  return (await repositoryFor(env)).listGalleries();
}

/** A published gallery with its published photographs, or null. */
export async function getPublishedGallery(
  slug: string,
  env?: AppEnvironment,
): Promise<PublicGalleryWithPhotos | null> {
  return (await repositoryFor(env)).getGallery(slug);
}

/** Public counts of published photographs per gallery id. */
export async function publishedPhotoCounts(
  env?: AppEnvironment,
): Promise<ReadonlyMap<string, number>> {
  return (await repositoryFor(env)).photoCounts();
}

/** Every published photograph across published galleries, newest first. */
export async function listPublishedPhotos(
  env?: AppEnvironment,
): Promise<readonly PublicPhoto[]> {
  return (await repositoryFor(env)).listPhotos();
}

/** A published photograph with its publishing gallery, or null. */
export async function getPublishedPhoto(
  slug: string,
  env?: AppEnvironment,
): Promise<PublicPhotoWithGallery | null> {
  return (await repositoryFor(env)).getPhoto(slug);
}

/** A published photograph with previous/next navigation inside its gallery. */
export async function getPhotoDetail(
  slug: string,
  env?: AppEnvironment,
): Promise<PublicPhotoDetail | null> {
  return (await repositoryFor(env)).getPhotoDetail(slug);
}

/** Featured published photographs with gallery context, newest first. */
export async function listFeaturedWithGallery(
  limit?: number,
  env?: AppEnvironment,
): Promise<readonly PublicPhotoWithGallery[]> {
  return (await repositoryFor(env)).listFeatured(limit);
}

/** Recent published photographs with gallery context, newest first. */
export async function listRecentWithGallery(
  limit: number,
  env?: AppEnvironment,
): Promise<readonly PublicPhotoWithGallery[]> {
  return (await repositoryFor(env)).listRecent(limit);
}

/** Resolve tag ids to their public registry entries, preserving input order. */
export async function resolveTags(
  tagIds: readonly string[],
  env?: AppEnvironment,
): Promise<readonly PublicTag[]> {
  return (await repositoryFor(env)).resolveTags(tagIds);
}

/** Every tag used by at least one published photograph, A–Z. */
export async function listPublishedTags(env?: AppEnvironment): Promise<readonly PublicTag[]> {
  return (await repositoryFor(env)).listTags();
}

/** The gallery cover as a public photograph, or null when the gallery has none. */
export async function galleryCover(
  gallery: PublicGallery,
  env?: AppEnvironment,
): Promise<PublicPhoto | null> {
  return (await repositoryFor(env)).getGalleryCover(gallery);
}
