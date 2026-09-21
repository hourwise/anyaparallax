import type { MetaFunction } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";

import { requireAdminAccess } from "../../auth/authorization.server";
import { appEnvironmentFrom } from "../../data/context.server";
import { parsePhotoIntent, targetStateFor, type ManagedPhotoSummary } from "../../data/photo-management";
import { listManagedPhotos, photoManagerFor } from "../../data/photo-management.server";
import { isSameOriginRequest, refuseCrossOriginRequest } from "../../lib/same-origin";

export const meta: MetaFunction = () => [
  { title: "Photos — Anyaparallax admin" },
  { name: "robots", content: "noindex, nofollow" },
];

/**
 * Photograph management (REPAIR-09B).
 *
 * Replaces a placeholder that told the operator this was "not built yet". The
 * audited blocker was that a photograph could not be managed after upload — most
 * importantly that a PUBLISHED photograph could not be withdrawn without direct
 * database intervention, which V1 cannot accept: unpublishing is the withdrawal
 * mechanism, and it has to be reachable from the interface Anya actually uses.
 *
 * This page lists EVERY photograph, drafts first, and carries the two state actions
 * that need to be one click away. Metadata editing lives on the per-photograph edit
 * screen (`/admin/photos/:photoId`), because a full form for every row would bury
 * the publication controls in a dense table.
 *
 * The guard runs in BOTH the loader and the action: React Router may run nested
 * loaders in parallel and an action is reachable without the loader having run at
 * all, so neither may assume the other denied first. The `/admin` layout guard and
 * the Worker entry's `no-store`/`noindex` policy are additional layers, not
 * substitutes.
 */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
  const env = appEnvironmentFrom(context);
  return { view: await listManagedPhotos(env) };
}

/**
 * The list page's state actions.
 *
 * The submitted intent is parsed through an explicit allow-list, and the photo id is
 * treated as a LOOKUP KEY: the record is resolved server-side, so a hidden field can
 * point at a photograph but cannot describe one. Success is reported only from
 * `persisted` — the state read back from the database — never from what was
 * submitted.
 */
export async function action({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
  // Authentication says WHO is asking; it says nothing about where the request came
  // from. Both must hold before the body is parsed, so a hostile page's cross-site
  // POST — which the operator's browser would send with Access credentials attached
  // — is refused here rather than after `formData()` has materialised it
  // (REPAIR-09E). The refusal is thrown, so it cannot be mistaken for an outcome.
  if (!isSameOriginRequest(request)) {
    throw refuseCrossOriginRequest();
  }
  const env = appEnvironmentFrom(context);
  const manager = photoManagerFor(env);
  if (!manager) {
    return {
      message: "No database is configured in this environment, so nothing was changed.",
      tone: "warning" as const,
    };
  }

  const form = await request.formData();
  const intent = parsePhotoIntent(form.get("intent"));
  if (!intent) {
    return {
      message: "That action was not recognised, so nothing was changed.",
      tone: "warning" as const,
    };
  }
  const target = targetStateFor(intent);
  const photoId = form.get("photoId");

  const result =
    target.field === "published"
      ? await manager.setPublication(photoId, target.value)
      : await manager.setFeatured(photoId, target.value);

  switch (result.status) {
    case "ok": {
      return { message: describe(intent, result.persisted), tone: "ok" as const };
    }
    case "not-found":
      return {
        message: "That photograph no longer exists, so nothing was changed.",
        tone: "warning" as const,
      };
    case "bad-request":
    case "invalid":
      return {
        message: Object.values(result.errors)[0] ?? "That request was not understood, so nothing was changed.",
        tone: "warning" as const,
      };
    default:
      return { message: result.reason, tone: "warning" as const };
  }
}

/**
 * Truthful feedback, written from the state the database now holds.
 *
 * The withdrawal case says explicitly that the photograph has stopped being served,
 * because that is the outcome an operator needs to be sure of — and it is also true:
 * every public read consults `published` on each request.
 */
function describe(intent: string, persisted: ManagedPhotoSummary): string {
  const named = `“${persisted.title}”`;
  switch (intent) {
    case "publish":
      return persisted.publiclyVisible
        ? `${named} is now published and visible on the public site.`
        : `${named} is now published, but its gallery (${persisted.galleryName}) is still a draft, so it is not visible on the public site yet.`;
    case "unpublish":
      return `${named} is now a draft. It is no longer served on the public site, and its image is no longer served through /media.`;
    case "feature":
      return `${named} is now featured, so it can appear in the homepage selection.`;
    default:
      return `${named} is no longer featured and has been removed from the homepage selection.`;
  }
}

/** A publication badge: state, not decoration — the operator reads this first. */
function PublicationState({ photo }: { photo: ManagedPhotoSummary }) {
  if (!photo.published) {
    return <span className="state-badge state-badge--draft">Draft — not public</span>;
  }
  if (!photo.galleryPublished) {
    return (
      <span className="state-badge state-badge--draft">
        Published, but {photo.galleryName} is a draft gallery, so it is not public
      </span>
    );
  }
  return <span className="state-badge state-badge--live">Published — public</span>;
}

export default function AdminPhotosRoute() {
  const { view } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  const photos = view.available ? view.photos : [];
  const drafts = photos.filter((photo) => !photo.publiclyVisible).length;

  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Photos</p>
        <h1>Photo library</h1>
        <p className="lede">
          Every uploaded photograph, drafts first. Metadata, gallery, tags, featured state and
          publication state can be changed here — including withdrawing a published photograph,
          which stops it being served publicly on the next request.
        </p>
      </header>

      {result ? (
        <p className={result.tone === "ok" ? "notice" : "notice notice--warning"} role="status">
          {result.message}
        </p>
      ) : null}

      {view.available ? null : (
        <p className="notice notice--warning" role="status">
          {view.reason}
        </p>
      )}

      {view.available && photos.length === 0 ? (
        <p className="muted">
          No photographs have been uploaded yet. <Link to="/admin/upload">Upload photographs</Link>{" "}
          to begin.
        </p>
      ) : null}

      {photos.length > 0 ? (
        <>
          <p className="muted">
            {photos.length === 1 ? "1 photograph" : `${photos.length} photographs`} —{" "}
            {drafts === 1 ? "1 not publicly visible" : `${drafts} not publicly visible`}.
          </p>
          <div className="table-scroll">
        <table className="status-table photo-table admin-table">
            <caption>Newest first within each group; drafts are listed first.</caption>
            <thead>
              <tr>
                <th scope="col">Photograph</th>
                <th scope="col">Public state</th>
                <th scope="col">Gallery</th>
                <th scope="col">Flags</th>
                <th scope="col">Manage</th>
              </tr>
            </thead>
            <tbody>
              {photos.map((photo) => (
                <tr key={photo.id}>
                  <th scope="row">
                    <Link className="text-link" to={`/admin/photos/${encodeURIComponent(photo.id)}`}>
                      {photo.title}
                    </Link>
                    <br />
                    <span className="muted">{photo.slug}</span>
                  </th>
                  <td data-label="Public state">
                    <PublicationState photo={photo} />
                  </td>
                  <td data-label="Gallery">
                    {photo.galleryName}
                    {photo.galleryPublished ? null : <span className="muted"> (draft gallery)</span>}
                  </td>
                  <td data-label="Flags">
                    {photo.featured ? <span className="state-badge">Featured</span> : null}
                    {photo.featured ? <br /> : null}
                    {photo.printAvailable ? <span className="state-badge">Print enquiries</span> : null}
                    {photo.featured || photo.printAvailable ? null : <span className="muted">—</span>}
                  </td>
                  <td data-label="Manage">
                    <div className="photo-table__actions">
                      <Link className="button" to={`/admin/photos/${encodeURIComponent(photo.id)}`}>
                        Edit
                      </Link>
                      {/*
                        Each control names the state it will produce, so there is no
                        ambiguity about whether it publishes or withdraws. The
                        destructive direction (withdrawing a published photograph) is
                        labelled plainly rather than hidden behind a toggle.
                      */}
                      <Form method="post">
                        <input type="hidden" name="photoId" value={photo.id} />
                        {photo.published ? (
                          <button
                            type="submit"
                            name="intent"
                            value="unpublish"
                            disabled={busy}
                            title={`Withdraw “${photo.title}” from the public site`}
                          >
                            Unpublish
                          </button>
                        ) : (
                          <button
                            type="submit"
                            name="intent"
                            value="publish"
                            disabled={busy}
                            title={`Publish “${photo.title}”`}
                          >
                            Publish
                          </button>
                        )}
                      </Form>
                      <Form method="post">
                        <input type="hidden" name="photoId" value={photo.id} />
                        {photo.featured ? (
                          <button
                            type="submit"
                            name="intent"
                            value="unfeature"
                            disabled={busy}
                            title={`Remove “${photo.title}” from the homepage selection`}
                          >
                            Unfeature
                          </button>
                        ) : (
                          <button
                            type="submit"
                            name="intent"
                            value="feature"
                            disabled={busy}
                            title={`Feature “${photo.title}” on the homepage`}
                          >
                            Feature
                          </button>
                        )}
                      </Form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      ) : null}

      <p className="muted">
        Print eligibility has its own screen: <Link className="text-link" to="/admin/prints">print
        eligibility</Link>. Deleting a photograph is not available in V1 — unpublishing is how a
        photograph is withdrawn.
      </p>
    </section>
  );
}
