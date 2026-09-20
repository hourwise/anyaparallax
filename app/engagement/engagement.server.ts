/**
 * Engagement service (Slice 07) — server only.
 *
 * The single place that answers "what is this photograph's engagement, and may
 * this request change it". Routes stay thin; the checks drive this directly.
 *
 * Three rules are enforced here rather than in a route:
 *
 *   1. A like is allowed only for a PUBLISHED photograph in a PUBLISHED gallery,
 *      verified against the database. The caller passes the photo's id, which it
 *      obtained from the published-photo lookup — but this module re-checks
 *      publication anyway, because a mutation must not depend on a caller having
 *      done the right lookup.
 *   2. The server is authoritative about the count and about whether THIS browser
 *      has liked. Neither is ever accepted from the client.
 *   3. With no database, engagement is UNAVAILABLE. It is never fabricated.
 */
import {
  browserTokenFromCookieHeader,
  buildBrowserIdCookie,
  digestBrowserToken,
  newBrowserToken,
} from "./anonymous-browser.server";
import {
  isShareChannel,
  type EngagementAvailability,
  type EngagementMutationResult,
  type PhotoEngagement,
  type ShareChannel,
} from "./engagement";
import { engagementStoreFor, type EngagementEnvironment, type EngagementStore } from "./store.server";

/** A photograph the caller has already resolved through the public query boundary. */
export type EngageablePhoto = {
  readonly id: string;
  readonly slug: string;
};

/** Engagement for a page view, with an explicit availability answer. */
export type EngagementView = {
  readonly availability: EngagementAvailability;
  readonly engagement: PhotoEngagement | null;
};

/** The outcome of a mutation attempt. */
export type MutationOutcome =
  | { readonly status: "ok"; readonly result: EngagementMutationResult; readonly setCookie: string | null }
  | { readonly status: "not-found" }
  | { readonly status: "unavailable" }
  | { readonly status: "bad-request"; readonly reason: string };

const UNAVAILABLE: EngagementView = {
  availability: {
    available: false,
    reason: "Likes are unavailable right now. Nothing is recorded and no count is shown.",
  },
  engagement: null,
};

/** The store, or null when this environment cannot persist engagement. */
function storeFor(env: EngagementEnvironment | undefined): EngagementStore | null {
  return engagementStoreFor(env);
}

/**
 * Read the engagement shown on a photograph page.
 *
 * A visitor with no cookie yet still sees the true count; `likedByThisBrowser` is
 * false because no like can be attributed to them. This never writes anything and
 * never sets a cookie: merely viewing a page must not create an identifier.
 */
export async function readEngagement(
  photo: EngageablePhoto,
  request: Request,
  env: EngagementEnvironment | undefined,
): Promise<EngagementView> {
  const store = storeFor(env);
  if (!store) {
    return UNAVAILABLE;
  }
  const token = browserTokenFromCookieHeader(request.headers.get("cookie"));
  const digest = token === null ? null : await digestBrowserToken(token);
  try {
    return { availability: { available: true }, engagement: await store.likeState(photo.id, digest) };
  } catch {
    // A database error is not a reason to show a number that may be wrong.
    return UNAVAILABLE;
  }
}

/**
 * Add a like for this browser.
 *
 * The identifier is created on demand — that is the one moment an anonymous
 * browser identifier comes into existence — and hashed before storage. A browser
 * that already liked this photograph is a no-op thanks to the table's unique
 * constraint, which is also what makes a concurrent double-submit safe.
 */
export async function likePhoto(
  photo: EngageablePhoto,
  request: Request,
  env: EngagementEnvironment | undefined,
  secureRequest: boolean,
): Promise<MutationOutcome> {
  return mutateLike("add", photo, request, env, secureRequest);
}

/** Remove THIS browser's like. Removing nothing is not an error. */
export async function unlikePhoto(
  photo: EngageablePhoto,
  request: Request,
  env: EngagementEnvironment | undefined,
  secureRequest: boolean,
): Promise<MutationOutcome> {
  return mutateLike("remove", photo, request, env, secureRequest);
}

async function mutateLike(
  operation: "add" | "remove",
  photo: EngageablePhoto,
  request: Request,
  env: EngagementEnvironment | undefined,
  secureRequest: boolean,
): Promise<MutationOutcome> {
  const store = storeFor(env);
  if (!store) {
    return { status: "unavailable" };
  }

  // Publication is re-verified here, against the database, before anything is
  // written. A caller that resolved a draft through some other path cannot use
  // this endpoint to engage with it.
  let engageable: boolean;
  try {
    engageable = await store.isPubliclyEngageable(photo.id);
  } catch {
    return { status: "unavailable" };
  }
  if (!engageable) {
    return { status: "not-found" };
  }

  const existing = browserTokenFromCookieHeader(request.headers.get("cookie"));
  const token = existing ?? newBrowserToken();
  const digest = await digestBrowserToken(token);

  try {
    if (operation === "add") {
      await store.addLike(photo.id, digest);
    } else {
      await store.removeLike(photo.id, digest);
    }
    // The count is read back from storage, never incremented locally: two
    // browsers liking at once must both see the state that actually persists.
    const engagement = await store.likeState(photo.id, digest);
    return {
      status: "ok",
      result: engagement,
      // Only a brand-new identifier is returned for setting, so a visitor who
      // already has one never has their cookie rewritten.
      setCookie: existing === null ? buildBrowserIdCookie(token, secureRequest) : null,
    };
  } catch {
    return { status: "unavailable" };
  }
}

/** What a share-initiation attempt can produce. Each failure is its own variant. */
export type ShareOutcome =
  | { readonly status: "ok"; readonly channel: ShareChannel }
  | { readonly status: "bad-request" }
  | { readonly status: "not-found" }
  | { readonly status: "unavailable" };

/** Record a share INITIATION for an allow-listed channel. */
export async function recordShare(
  photo: EngageablePhoto,
  channel: unknown,
  env: EngagementEnvironment | undefined,
): Promise<ShareOutcome> {
  // The allow-list is applied before anything else: an arbitrary channel string
  // from the client is a bad request, not a row.
  if (!isShareChannel(channel)) {
    return { status: "bad-request" };
  }
  const store = storeFor(env);
  if (!store) {
    return { status: "unavailable" };
  }
  try {
    if (!(await store.isPubliclyEngageable(photo.id))) {
      return { status: "not-found" };
    }
    await store.recordShareInitiation(photo.id, channel);
    return { status: "ok", channel };
  } catch {
    return { status: "unavailable" };
  }
}
