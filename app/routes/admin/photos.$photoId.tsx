import type { MetaFunction } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";

import { requireAdminAccess } from "../../auth/authorization.server";
import { appEnvironmentFrom } from "../../data/context.server";
import {
  FEATURED_STATES,
  FEATURED_STATE_LABELS,
  PHOTO_FIELD_LIMITS,
  PUBLICATION_STATES,
  PUBLICATION_STATE_LABELS,
  parseFeaturedState,
  parsePublicationState,
  storageFieldsIn,
  type FeaturedState,
  type ManagedPhotoSummary,
  type PhotoFieldErrors,
  type PublicationState,
} from "../../data/photo-management";
import {
  managedPhotoEditorFor,
  photoManagerFor,
} from "../../data/photo-management.server";
import { listTagOptions } from "../../data/queries";
import { photoPath } from "../../lib/paths";
import { isSameOriginRequest, refuseCrossOriginRequest } from "../../lib/same-origin";

export const meta: MetaFunction = () => [
  { title: "Edit photograph — Anyaparallax admin" },
  { name: "robots", content: "noindex, nofollow" },
];

/**
 * Edit one photograph (REPAIR-09B).
 *
 * A dedicated screen rather than a form inside every row of the library table: the
 * fields an operator corrects are too many to read in a table cell, and the table is
 * where publication state needs to stay legible. The route is guarded in the loader
 * AND in the action.
 *
 * THE URL NAMES THE TARGET, NOT THE SUBMISSION. The photograph is resolved from the
 * route parameter, and a submitted `photoId` is ignored entirely, so a tampered
 * hidden field cannot retarget a save at a different photograph. Every other value is
 * validated server-side, and the storage identity fields (`original_storage_key`,
 * `web_storage_key`, `thumbnail_storage_key`, the measured dimensions) are not part
 * of this form at all: a submission that names one is REFUSED outright, because
 * ignoring it silently would leave the operator unable to tell whether it was
 * honoured.
 *
 * Saving is ONE atomic mutation covering the metadata, the tags and both state
 * fields, confirmed by reading the row back, so this screen can never report a save
 * that half-happened.
 */
export async function loader({
  request,
  context,
  params,
}: {
  request: Request;
  context: unknown;
  params: { photoId?: string };
}) {
  await requireAdminAccess(request, context);
  const env = appEnvironmentFrom(context);
  const view = await managedPhotoEditorFor(env, params.photoId ?? "");
  if (view.status === "not-found") {
    throw new Response("Photograph not found", { status: 404, statusText: "Not Found" });
  }
  // Tag options are read through the same registry reader the upload form uses, so
  // the editor cannot offer a tag the database does not hold. A D1 binding exists
  // whenever the view resolved, so this cannot fall through to the seed source.
  const tagOptions = view.status === "ok" ? await listTagOptions(env) : [];
  return { view, tagOptions };
}

/** The values the form re-renders with after a refusal, so nothing is retyped. */
type SubmittedValues = {
  readonly title: string;
  readonly description: string;
  readonly location: string;
  readonly captureDate: string;
  readonly galleryId: string;
  readonly tags: readonly string[];
  readonly published: string;
  readonly featured: string;
};

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** Truthful feedback, written from the state the database now holds. */
function describeSaved(persisted: ManagedPhotoSummary): string {
  const visibility = persisted.publiclyVisible
    ? "It is visible on the public site."
    : persisted.published
      ? `It is published, but its gallery (${persisted.galleryName}) is still a draft, so it is not visible on the public site.`
      : "It is a draft, so it is not served on the public site.";
  return `Saved. ${visibility} Featured: ${persisted.featured ? "yes" : "no"}. Print enquiries: ${
    persisted.printAvailable ? "offered" : "not offered"
  }.`;
}

export async function action({
  request,
  context,
  params,
}: {
  request: Request;
  context: unknown;
  params: { photoId?: string };
}) {
  await requireAdminAccess(request, context);
  // Same-origin before anything else that costs work: an authenticated edit is still
  // refused when it did not come from this site, and the refusal precedes the body
  // parse so a hostile request never reaches field validation or the database
  // (REPAIR-09E). Authorization stays first so an unauthenticated request keeps its
  // existing 401.
  if (!isSameOriginRequest(request)) {
    throw refuseCrossOriginRequest();
  }
  const env = appEnvironmentFrom(context);
  const photoId = params.photoId ?? "";

  const manager = photoManagerFor(env);
  if (!manager) {
    return {
      tone: "warning" as const,
      message: "No database is configured in this environment, so nothing was changed.",
      errors: {} as PhotoFieldErrors,
      values: null as SubmittedValues | null,
    };
  }

  const form = await request.formData();
  const refused = storageFieldsIn(form);
  if (refused.length > 0) {
    return {
      tone: "warning" as const,
      message: `This form cannot change ${refused.join(", ")}. Storage identity and image geometry are fixed when a photograph is uploaded, and nothing was changed.`,
      errors: {} as PhotoFieldErrors,
      values: null as SubmittedValues | null,
    };
  }

  const view = await managedPhotoEditorFor(env, photoId);
  if (view.status === "not-found") {
    throw new Response("Photograph not found", { status: 404, statusText: "Not Found" });
  }
  if (view.status === "unavailable") {
    return {
      tone: "warning" as const,
      message: view.reason,
      errors: {} as PhotoFieldErrors,
      values: null as SubmittedValues | null,
    };
  }

  // Both state fields are parsed through an explicit contract: a submitted value
  // this application does not recognise is a refusal, never a guess at what was
  // meant.
  const published = parsePublicationState(form.get("published"));
  const featured = parseFeaturedState(form.get("featured"));
  const values: SubmittedValues = {
    title: text(form, "title"),
    description: text(form, "description"),
    location: text(form, "location"),
    captureDate: text(form, "captureDate"),
    galleryId: text(form, "galleryId"),
    tags: form.getAll("tags").map((tag) => String(tag)),
    published: text(form, "published"),
    featured: text(form, "featured"),
  };
  if (published === null || featured === null) {
    return {
      tone: "warning" as const,
      message:
        "The publication and featured states must be chosen from the listed options, so nothing was changed.",
      errors: {} as PhotoFieldErrors,
      values,
    };
  }

  const tagIds = (await listTagOptions(env)).map((tag) => tag.id);
  const result = await manager.updatePhoto(
    photoId,
    {
      title: form.get("title"),
      description: form.get("description"),
      location: form.get("location"),
      captureDate: form.get("captureDate"),
      galleryId: form.get("galleryId"),
      tags: values.tags,
      published,
      featured,
    },
    { galleryIds: view.galleries.map((gallery) => gallery.id), tagIds },
  );

  switch (result.status) {
    case "ok":
      return { tone: "ok" as const, message: describeSaved(result.persisted), errors: {} as PhotoFieldErrors, values: null };
    case "not-found":
      return {
        tone: "warning" as const,
        message: "That photograph no longer exists, so nothing was changed.",
        errors: {} as PhotoFieldErrors,
        values: null,
      };
    case "invalid":
      return {
        tone: "warning" as const,
        message: "Nothing was saved — please correct the fields below.",
        errors: result.errors,
        values,
      };
    case "bad-request":
      return {
        tone: "warning" as const,
        message: Object.values(result.errors)[0] ?? "That request was not understood, so nothing was changed.",
        errors: result.errors,
        values,
      };
    default:
      return { tone: "warning" as const, message: result.reason, errors: {} as PhotoFieldErrors, values };
  }
}

export default function AdminPhotoEditRoute() {
  const { view, tagOptions } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  if (view.status !== "ok") {
    return (
      <section className="page">
        <header className="page__header">
          <p className="eyebrow">Photos</p>
          <h1>Photograph unavailable</h1>
        </header>
        <p className="notice notice--warning" role="status">
          {view.reason}
        </p>
        <p>
          <Link className="text-link" to="/admin/photos">
            Back to the photo library
          </Link>
        </p>
      </section>
    );
  }

  const { photo, galleries } = view;
  const submitted = result?.values ?? null;
  const publicationValue: PublicationState = submitted
    ? submitted.published === "published"
      ? "published"
      : "draft"
    : photo.published
      ? "published"
      : "draft";
  const featuredValue: FeaturedState = submitted
    ? submitted.featured === "featured"
      ? "featured"
      : "not-featured"
    : photo.featured
      ? "featured"
      : "not-featured";
  const selectedTags = submitted ? submitted.tags : photo.tags;

  return (
    <section className="page">
      <p className="eyebrow">
        <Link to="/admin/photos">Photos</Link>
      </p>
      <header className="page__header">
        <h1>{photo.title}</h1>
        <p className="lede">
          {photo.publiclyVisible
            ? "This photograph is visible on the public site."
            : photo.published
              ? `Published, but not public: its gallery (${photo.galleryName}) is a draft gallery.`
              : "This photograph is a draft and is not served on the public site."}
        </p>
      </header>

      {result ? (
        <p className={result.tone === "ok" ? "notice" : "notice notice--warning"} role="status">
          {result.message}
        </p>
      ) : null}

      {Object.keys(result?.errors ?? {}).length > 0 ? (
        <ul className="plain-list field-error-list" role="alert">
          {Object.entries(result?.errors ?? {}).map(([field, message]) => (
            <li key={field}>{message}</li>
          ))}
        </ul>
      ) : null}

      <dl className="photo-meta photo-meta--admin">
        <div className="photo-meta__row">
          <dt>Slug</dt>
          <dd>{photo.slug}</dd>
        </div>
        <div className="photo-meta__row">
          <dt>Public</dt>
          <dd>{photo.publiclyVisible ? "Yes" : "No"}</dd>
        </div>
        <div className="photo-meta__row">
          <dt>Print</dt>
          <dd>
            {photo.printAvailable ? "Offered for print enquiries" : "Not offered"} —{" "}
            <Link className="text-link" to="/admin/prints">
              change print eligibility
            </Link>
          </dd>
        </div>
        <div className="photo-meta__row">
          <dt>Updated</dt>
          <dd>{photo.updatedAt}</dd>
        </div>
      </dl>

      <Form method="post" className="photo-form">
        <fieldset>
          <legend>Text</legend>
          <label htmlFor="title">
            Title
            <input
              id="title"
              name="title"
              type="text"
              required
              maxLength={PHOTO_FIELD_LIMITS.title}
              defaultValue={submitted ? submitted.title : photo.title}
            />
          </label>
          <label htmlFor="description">
            Description
            <textarea
              id="description"
              name="description"
              rows={4}
              maxLength={PHOTO_FIELD_LIMITS.description}
              defaultValue={submitted ? submitted.description : photo.description}
            />
          </label>
          <p className="muted">
            The description doubles as this photograph&rsquo;s alternative text when it has one, so
            write it as something a visitor would want read out.
          </p>
          <label htmlFor="location">
            Location
            <input
              id="location"
              name="location"
              type="text"
              maxLength={PHOTO_FIELD_LIMITS.location}
              defaultValue={submitted ? submitted.location : (photo.location ?? "")}
            />
          </label>
          <label htmlFor="captureDate">
            Capture date
            <input
              id="captureDate"
              name="captureDate"
              type="date"
              defaultValue={
                submitted ? submitted.captureDate : (photo.captureDate ?? "")
              }
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>Gallery and tags</legend>
          <label htmlFor="galleryId">
            Gallery
            <select
              id="galleryId"
              name="galleryId"
              required
              defaultValue={submitted ? submitted.galleryId : photo.galleryId}
            >
              {galleries.map((gallery) => (
                <option key={gallery.id} value={gallery.id}>
                  {gallery.published
                    ? gallery.name
                    : `${gallery.name} — draft gallery (photographs in it are not public)`}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="tags">
            Tags
            <select
              id="tags"
              name="tags"
              multiple
              size={Math.min(8, Math.max(3, tagOptions.length))}
              defaultValue={selectedTags}
            >
              {tagOptions.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            Select several with Ctrl or Cmd. Clearing the selection removes every tag from this
            photograph; other photographs are unaffected.
          </p>
        </fieldset>

        <fieldset>
          <legend>Visibility</legend>
          {/*
            Both state controls are explicit two-option selects whose labels name the
            OUTCOME, not a checkbox whose meaning depends on the current value.
          */}
          <label htmlFor="published">
            Publication state
            <select id="published" name="published" defaultValue={publicationValue}>
              {PUBLICATION_STATES.map((state) => (
                <option key={state} value={state}>
                  {PUBLICATION_STATE_LABELS[state]}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="featured">
            Homepage
            <select id="featured" name="featured" defaultValue={featuredValue}>
              {FEATURED_STATES.map((state) => (
                <option key={state} value={state}>
                  {FEATURED_STATE_LABELS[state]}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            Setting this photograph to draft withdraws it: the public page, its image through
            /media, its place in galleries and the homepage, and print enquiries about it all stop
            on the next request. The original and its derivatives are kept, so publishing it again
            restores all of it. Up to five featured photographs appear on the homepage.
          </p>
        </fieldset>

        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </Form>

      <p className="section-actions">
        <Link className="button" to="/admin/photos">
          Back to the photo library
        </Link>
        {photo.publiclyVisible ? (
          <Link className="button" to={photoPath(photo.slug)}>
            View the public page
          </Link>
        ) : null}
      </p>
    </section>
  );
}
