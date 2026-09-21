import type { MetaFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";

import { requireAdminAccess } from "../../auth/authorization.server";
import { appEnvironmentFrom } from "../../data/context.server";
import {
  GALLERY_FIELD_LIMITS,
  MAX_GALLERY_ORDER,
  parseDisplayOrder,
  parseGalleryIntent,
  parsePublicationState,
  type GalleryFieldErrors,
} from "../../data/gallery-management";
import {
  galleryManagerFor,
  managedGalleriesView,
  type GalleryMutationResult,
  type ManagedGallerySummary,
} from "../../data/gallery-management.server";
import { isSameOriginRequest, refuseCrossOriginRequest } from "../../lib/same-origin";

export const meta: MetaFunction = () => [
  { title: "Galleries — Anyaparallax admin" },
  { name: "robots", content: "noindex, nofollow" },
];

/**
 * Gallery management.
 *
 * This replaced a "Not built yet" placeholder, and it is the surface that makes the
 * site Anya's: a photograph belongs to a gallery, production begins with none, and
 * without this screen a collection cannot be created without a developer.
 *
 * One page rather than a list plus a detail screen, because the four things an
 * operator does most — rename, reorder, publish and pick a cover — should all be
 * visible together rather than behind a navigation step.
 *
 * The guard runs in BOTH the loader and the action, since React Router may run nested
 * loaders in parallel and an action is reachable without the loader having run at all.
 * The action then applies the same-origin boundary BEFORE it parses anything, so a
 * cross-site POST is refused before a body is read: authorization → same-origin →
 * body → validation → mutation.
 */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
  const env = appEnvironmentFrom(context);
  return { view: await managedGalleriesView(env) };
}

type ActionData = {
  readonly message: string;
  readonly tone: "ok" | "warning";
  readonly errors?: GalleryFieldErrors;
  readonly createdSlug?: string;
};

function refused(errors: GalleryFieldErrors): ActionData {
  return {
    message: Object.values(errors)[0] ?? "That request was not understood, so nothing was changed.",
    tone: "warning",
    errors,
  };
}

/**
 * A persisted gallery, described from what the database now holds.
 *
 * The visibility sentence states the invariant an operator has to know: publishing a
 * gallery makes the COLLECTION public, and a photograph inside it appears only when
 * the photograph is published too.
 */
function describe(gallery: ManagedGallerySummary, verb: string): string {
  const visibility = gallery.published
    ? `It is published, so it appears on the public site${
        gallery.publishedPhotoCount === 0 ? " once it holds a published photograph" : ""
      }.`
    : "It is a draft, so it is not visible on the public site.";
  return `“${gallery.name}” ${verb}. ${visibility} It holds ${gallery.photoCount} photograph${
    gallery.photoCount === 1 ? "" : "s"
  }, ${gallery.publishedPhotoCount} of them published.`;
}

function report(result: GalleryMutationResult, verb: string, created?: string): ActionData {
  switch (result.status) {
    case "ok":
      return {
        message: created ?? describe(result.persisted, verb),
        tone: "ok",
        createdSlug: result.createdSlug,
      };
    case "not-found":
      return { message: "That gallery no longer exists, so nothing was changed.", tone: "warning" };
    case "bad-request":
      return refused(result.errors);
    default:
      return { message: result.reason, tone: "warning" };
  }
}

export async function action({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
  if (!isSameOriginRequest(request)) {
    throw refuseCrossOriginRequest();
  }
  const env = appEnvironmentFrom(context);
  const manager = galleryManagerFor(env);
  if (!manager) {
    return {
      message: "No database is configured in this environment, so nothing was changed.",
      tone: "warning" as const,
    };
  }

  const form = await request.formData();
  const intent = parseGalleryIntent(form.get("intent"));
  if (!intent) {
    return {
      message: "That action was not recognised, so nothing was changed.",
      tone: "warning" as const,
    };
  }
  const galleryId = String(form.get("galleryId") ?? "");

  switch (intent) {
    case "create": {
      const published = parsePublicationState(form.get("published"));
      if (published === null) {
        return refused({ name: "Choose whether the gallery starts as a draft or published." });
      }
      const name = String(form.get("name") ?? "").trim();
      return report(
        await manager.create({
          name,
          description: String(form.get("description") ?? ""),
          displayOrder: String(form.get("displayOrder") ?? ""),
          published,
        }),
        "is created",
        `Created “${name}”.`,
      );
    }
    case "update": {
      const published = parsePublicationState(form.get("published"));
      if (published === null) {
        return refused({ name: "Choose whether the gallery is a draft or published." });
      }
      return report(
        await manager.update(galleryId, {
          name: String(form.get("name") ?? ""),
          description: String(form.get("description") ?? ""),
          displayOrder: String(form.get("displayOrder") ?? ""),
          published,
        }),
        "is saved",
      );
    }
    case "publish":
    case "unpublish":
      return report(
        await manager.setPublication(galleryId, intent === "publish"),
        intent === "publish" ? "is published" : "is withdrawn to a draft",
      );
    case "order": {
      const order = parseDisplayOrder(form.get("displayOrder"));
      if (order === null) {
        return refused({ displayOrder: `Use a whole number between 0 and ${MAX_GALLERY_ORDER}.` });
      }
      return report(await manager.setOrder(galleryId, order), `now sits at position ${order}`);
    }
    case "cover":
    case "clear-cover": {
      const photoId = intent === "clear-cover" ? null : String(form.get("coverPhotoId") ?? "");
      if (intent === "cover" && photoId === "") {
        return refused({ coverPhotoId: "Choose a photograph from this gallery." });
      }
      return report(
        await manager.setCover(galleryId, photoId),
        intent === "clear-cover" ? "no longer has a cover" : "has a new cover",
      );
    }
    default:
      return {
        message: "That action was not recognised, so nothing was changed.",
        tone: "warning" as const,
      };
  }
}

export default function AdminGalleriesRoute() {
  const { view } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const busy = useNavigation().state !== "idle";

  if (!view.available) {
    return (
      <section className="page">
        <header className="page__header">
          <p className="eyebrow">Galleries</p>
          <h1>Manage galleries</h1>
        </header>
        <p className="notice notice--warning">{view.reason}</p>
      </section>
    );
  }

  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Galleries</p>
        <h1>Manage galleries</h1>
        <p className="lede">
          Galleries are the collections visitors browse. A photograph belongs to one gallery,
          and it appears publicly only when both it and its gallery are published.
        </p>
      </header>

      {actionData ? (
        <p
          className={actionData.tone === "ok" ? "notice notice--ok" : "notice notice--warning"}
          role="status"
        >
          {actionData.message}
        </p>
      ) : null}

      <section className="workspace-block" aria-labelledby="create-gallery-heading">
        <h2 id="create-gallery-heading">Create a gallery</h2>
        <Form method="post" className="stack-form">
          <input type="hidden" name="intent" value="create" />
          <label htmlFor="new-gallery-name">Name</label>
          <input
            id="new-gallery-name"
            name="name"
            type="text"
            required
            maxLength={GALLERY_FIELD_LIMITS.name}
          />
          {actionData?.errors?.name ? <p className="field-error">{actionData.errors.name}</p> : null}

          <label htmlFor="new-gallery-description">Description</label>
          <textarea
            id="new-gallery-description"
            name="description"
            rows={3}
            maxLength={GALLERY_FIELD_LIMITS.description}
          />
          {actionData?.errors?.description ? (
            <p className="field-error">{actionData.errors.description}</p>
          ) : null}

          <label htmlFor="new-gallery-order">Display order (optional)</label>
          <input
            id="new-gallery-order"
            name="displayOrder"
            type="number"
            min={0}
            max={MAX_GALLERY_ORDER}
            step={1}
          />
          <p className="field-help">Lower numbers appear first. Leave blank to add it last.</p>
          {actionData?.errors?.displayOrder ? (
            <p className="field-error">{actionData.errors.displayOrder}</p>
          ) : null}

          <fieldset className="fieldset">
            <legend>Visibility</legend>
            <label className="checkbox">
              <input type="radio" name="published" value="draft" defaultChecked /> Keep it a draft
            </label>
            <label className="checkbox">
              <input type="radio" name="published" value="published" /> Publish it
            </label>
          </fieldset>

          <button type="submit" disabled={busy}>
            Create gallery
          </button>
        </Form>
      </section>

      <section className="workspace-block" aria-labelledby="gallery-list-heading">
        <h2 id="gallery-list-heading">
          {view.galleries.length === 0
            ? "No galleries yet"
            : `${view.galleries.length} galler${view.galleries.length === 1 ? "y" : "ies"}`}
        </h2>
        {view.galleries.length === 0 ? (
          <p className="notice">
            Create the first gallery above. Photographs are uploaded into a gallery, so this is
            the first step before any photograph can appear on the public site.
          </p>
        ) : null}

        <ul className="gallery-admin-list">
          {view.galleries.map((gallery) => {
            const photos = view.photosByGallery[gallery.id] ?? [];
            return (
              <li key={gallery.id} className="gallery-admin-item">
                <div className="gallery-admin-item__header">
                  <h3>{gallery.name}</h3>
                  <p className="state-badge" data-state={gallery.published ? "published" : "draft"}>
                    {gallery.published ? "Published" : "Draft — not public"}
                  </p>
                </div>
                <p className="field-help">
                  /gallery/{gallery.slug} · position {gallery.displayOrder} · {gallery.photoCount}{" "}
                  photograph{gallery.photoCount === 1 ? "" : "s"} ({gallery.publishedPhotoCount}{" "}
                  published) · cover: {gallery.coverPhotoTitle ?? "none"}
                </p>

                <Form method="post" className="inline-form">
                  <input type="hidden" name="intent" value="update" />
                  <input type="hidden" name="galleryId" value={gallery.id} />
                  <input
                    type="hidden"
                    name="published"
                    value={gallery.published ? "published" : "draft"}
                  />
                  <label htmlFor={`name-${gallery.id}`}>Name</label>
                  <input
                    id={`name-${gallery.id}`}
                    name="name"
                    type="text"
                    defaultValue={gallery.name}
                    maxLength={GALLERY_FIELD_LIMITS.name}
                  />
                  <label htmlFor={`description-${gallery.id}`}>Description</label>
                  <textarea
                    id={`description-${gallery.id}`}
                    name="description"
                    rows={2}
                    defaultValue={gallery.description}
                    maxLength={GALLERY_FIELD_LIMITS.description}
                  />
                  <label htmlFor={`order-${gallery.id}`}>Display order</label>
                  <input
                    id={`order-${gallery.id}`}
                    name="displayOrder"
                    type="number"
                    min={0}
                    max={MAX_GALLERY_ORDER}
                    step={1}
                    defaultValue={gallery.displayOrder}
                  />
                  <button type="submit" disabled={busy}>
                    Save changes
                  </button>
                </Form>

                <div className="gallery-admin-item__actions">
                  <Form method="post" className="inline-form">
                    <input type="hidden" name="intent" value="order" />
                    <input type="hidden" name="galleryId" value={gallery.id} />
                    <label htmlFor={`order-only-${gallery.id}`}>Set position</label>
                    <input
                      id={`order-only-${gallery.id}`}
                      name="displayOrder"
                      type="number"
                      min={0}
                      max={MAX_GALLERY_ORDER}
                      step={1}
                      defaultValue={gallery.displayOrder}
                    />
                    <button type="submit" disabled={busy}>
                      Save position
                    </button>
                  </Form>

                  <Form method="post" className="inline-form">
                    <input
                      type="hidden"
                      name="intent"
                      value={gallery.published ? "unpublish" : "publish"}
                    />
                    <input type="hidden" name="galleryId" value={gallery.id} />
                    <button type="submit" disabled={busy}>
                      {gallery.published ? "Withdraw to draft" : "Publish gallery"}
                    </button>
                  </Form>
                </div>

                <Form method="post" className="inline-form">
                  <input type="hidden" name="intent" value="cover" />
                  <input type="hidden" name="galleryId" value={gallery.id} />
                  <label htmlFor={`cover-${gallery.id}`}>Cover photograph</label>
                  <select
                    id={`cover-${gallery.id}`}
                    name="coverPhotoId"
                    defaultValue={gallery.coverPhotoId ?? ""}
                  >
                    <option value="">
                      {photos.length === 0 ? "No photographs in this gallery yet" : "No cover"}
                    </option>
                    {photos.map((photo) => (
                      <option key={photo.id} value={photo.id}>
                        {photo.title}
                        {photo.published ? "" : " (draft)"}
                      </option>
                    ))}
                  </select>
                  <button type="submit" disabled={busy || photos.length === 0}>
                    Save cover
                  </button>
                </Form>

                {gallery.coverPhotoId ? (
                  <Form method="post" className="inline-form">
                    <input type="hidden" name="intent" value="clear-cover" />
                    <input type="hidden" name="galleryId" value={gallery.id} />
                    <button type="submit" disabled={busy}>
                      Remove cover
                    </button>
                  </Form>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </section>
  );
}
