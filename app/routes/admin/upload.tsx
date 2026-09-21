import type { MetaFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";

import { requireAdminAccess } from "../../auth/authorization.server";
import { appEnvironmentFrom } from "../../data/context.server";
import { listPublishedGalleries, listTagOptions } from "../../data/queries";
import {
  PHOTO_FIELD_LIMITS,
  validatePhotoMetadata,
} from "../../data/photo-management";
import { knownReferenceIds } from "../../data/photo-management.server";
import { readPublicSiteSettings } from "../../data/site-settings.server";
import {
  WATERMARK_POSITIONS,
  type WatermarkPosition,
} from "../../images/image-processor";
import { isSameOriginRequest, refuseCrossOriginRequest } from "../../lib/same-origin";

export const meta: MetaFunction = () => [
  { title: "Upload photos — Anyaparallax admin" },
  { name: "robots", content: "noindex, nofollow" },
];

/**
 * The guard runs in BOTH the loader and the action.
 *
 * They are separate calls on purpose: React Router can run the layout and the
 * route in parallel, and an action is reachable without the loader having run at
 * all, so neither may assume the other denied first.
 */

export async function loader({ request, context }: { request: Request; context: unknown }) {
  const user = await requireAdminAccess(request, context);
  const env = appEnvironmentFrom(context);
  // Galleries and tags come from the PUBLIC query boundary for galleries (an
  // upload may only be filed into a gallery a visitor can see, so the operator
  // cannot accidentally publish into a hidden collection) and from the tag
  // registry for tags, because `photo_tags` needs tag IDS and the public
  // projection deliberately omits them.
  const [galleries, tags, settings] = await Promise.all([
    listPublishedGalleries(env),
    listTagOptions(env),
    readPublicSiteSettings(env),
  ]);
  // The workspace defaults the operator set in /admin/settings. They are DEFAULTS for the
  // form, never a restriction: the per-upload control still decides what this upload does.
  return {
    user,
    galleries,
    tags,
    watermarkDefaults: {
      enabled: settings.watermarkDefaultEnabled,
      position: settings.watermarkDefaultPosition,
    },
  };
}

/** Read the operator's choices, rejecting anything the form could not have sent. */
function readOptions(form: FormData) {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const requested = text("watermarkPosition");
  // An unrecognised position is REPORTED, not quietly replaced: the default belongs to a
  // form that did not choose, not to a submission that chose something impossible.
  const watermarkPosition: WatermarkPosition | null = (
    WATERMARK_POSITIONS as readonly string[]
  ).includes(requested)
    ? (requested as WatermarkPosition)
    : null;
  return {
    title: text("title"),
    description: text("description"),
    galleryId: text("galleryId"),
    tags: form.getAll("tags").map((value) => String(value)),
    location: text("location") || null,
    captureDate: text("captureDate") || null,
    watermarkEnabled: form.get("watermarkEnabled") === "on",
    watermarkPosition,
    rawWatermarkPosition: requested,
    published: form.get("published") === "on",
    featured: form.get("featured") === "on",
    printAvailable: form.get("printAvailable") === "on",
  };
}

/**
 * The write path.
 *
 * The order here is the memory policy, and each step exists because the previous
 * one cannot bound what the next one allocates:
 *
 *   1. the admin guard;
 *   2. the same-origin guard (REPAIR-09E) — an authenticated upload that did not
 *      come from this site is refused here, before the pipeline is even loaded and
 *      long before a byte of multipart data is parsed;
 *   3. `assertRequestWithinLimit` — the request is refused from its
 *      `Content-Length` HEADER, before the body is parsed at all. A request whose
 *      size is undeclared is refused here too: an unbounded request cannot be
 *      given a memory ceiling;
 *   4. `request.formData()` — the only step that buffers the multipart body;
 *   5. `fileSourcesFrom` — the batch policy is applied to the parsed Files'
 *      METADATA, still before any file body is read;
 *   6. `ingestUploads` — reads and processes ONE file at a time.
 *
 * What this does NOT claim: that the body is never buffered. `formData()` holds
 * the file parts. The claim is that an oversized or unbounded request never
 * reaches that point, and that file bodies are materialised one at a time.
 */
export async function action({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
  // Step 2. Authentication says who is asking; this says where the request came
  // from, and both must hold before the expensive path begins.
  if (!isSameOriginRequest(request)) {
    throw refuseCrossOriginRequest();
  }
  const { assertRequestWithinLimit, fileSourcesFrom } = await import(
    "../../images/upload-request.server"
  );
  const { hasUploadStorage, ingestUploads } = await import("../../images/upload.server");
  const { UploadError } = await import("../../images/upload-validation");

  // 2. Header-only gate. Nothing is parsed and no binding is touched yet.
  try {
    assertRequestWithinLimit(request);
  } catch (error) {
    return {
      report: null,
      message:
        error instanceof UploadError
          ? error.message
          : "The upload could not be accepted.",
    };
  }

  // 3. Parse. 4. Apply the batch policy to metadata before reading any body.
  const form = await request.formData();
  const env = appEnvironmentFrom(context);

  /**
   * APV1-03: the metadata contract is enforced HERE, on the server, before a single byte
   * of image data is processed and before any binding is touched.
   *
   * A browser's `required`, `maxlength` and `<select>` are conveniences for a person
   * using the form; a direct POST has none of them. The rules are the SAME rules the
   * photograph editor applies — one contract, one implementation — so an upload and an
   * edit cannot disagree about what a valid title, description, location, capture date,
   * gallery or tag set is.
   */
  const submitted = readOptions(form);
  const references = await knownReferenceIds(env);
  const metadata = validatePhotoMetadata(
    {
      title: submitted.title,
      description: submitted.description,
      location: submitted.location ?? "",
      captureDate: submitted.captureDate ?? "",
      galleryId: submitted.galleryId,
      tags: submitted.tags,
    },
    references,
  );
  if (!metadata.ok) {
    return {
      report: null,
      message:
        Object.values(metadata.errors)[0] ??
        "That upload's details were not understood, so nothing was uploaded.",
    };
  }
  if (submitted.watermarkPosition === null) {
    return {
      report: null,
      message: "Choose a watermark position this application understands, or turn the watermark off.",
    };
  }
  if (submitted.title.length > PHOTO_FIELD_LIMITS.title) {
    return {
      report: null,
      message: `Please keep the title to ${PHOTO_FIELD_LIMITS.title} characters or fewer.`,
    };
  }
  let files;
  try {
    files = fileSourcesFrom(form);
  } catch (error) {
    return {
      report: null,
      message: error instanceof UploadError ? error.message : "The upload could not be accepted.",
    };
  }

  if (files.length === 0) {
    return {
      report: null,
      message: "Choose at least one JPEG or PNG to upload.",
    };
  }

  // A bucket-less deployment (or a plain Node run) cannot upload; saying so is
  // better than a generic failure, and it never silently pretends to succeed.
  // The decision itself lives in the server module so this route never names a
  // binding.
  if (!hasUploadStorage(env)) {
    return {
      report: null,
      message: "Storage is not configured in this environment, so uploads are unavailable.",
    };
  }

  // 5. Read and process the files one at a time. The options are the SAME object the
  // metadata validation above approved — re-reading the form here would open a gap
  // between what was validated and what is stored.
  const report = await ingestUploads({
    env,
    files,
    options: {
      title: metadata.value.title,
      description: metadata.value.description,
      galleryId: metadata.value.galleryId,
      tags: [...metadata.value.tags],
      location: metadata.value.location,
      captureDate: metadata.value.captureDate,
      watermarkEnabled: submitted.watermarkEnabled,
      watermarkPosition: submitted.watermarkPosition,
      published: submitted.published,
      featured: submitted.featured,
      printAvailable: submitted.printAvailable,
    },
  });
  return { report, message: null };
}

export default function AdminUploadRoute() {
  const { user, galleries, tags, watermarkDefaults } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const report = result?.report ?? null;

  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Upload</p>
        <h1>Upload photos</h1>
        <p className="lede">
          Originals are stored privately and never altered, watermarked or served. Public
          derivatives are generated from them and are the only images a visitor can fetch.
        </p>
      </header>

      <Form method="post" encType="multipart/form-data" className="upload-form">
        <fieldset>
          <legend>Files</legend>
          <label htmlFor="photos">
            Photographs (JPEG or PNG, several allowed)
            <input
              id="photos"
              name="photos"
              type="file"
              accept="image/jpeg,image/png"
              multiple
              required
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>Metadata</legend>
          <label htmlFor="title">
            Title
            <input id="title" name="title" type="text" maxLength={120} />
          </label>
          <label htmlFor="description">
            Description
            <textarea id="description" name="description" rows={3} maxLength={600} />
          </label>
          <label htmlFor="galleryId">
            Gallery
            <select id="galleryId" name="galleryId" required>
              {galleries.map((gallery) => (
                <option key={gallery.id} value={gallery.id}>
                  {gallery.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="tags">
            Tags
            <select id="tags" name="tags" multiple size={Math.min(6, Math.max(2, tags.length))}>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="location">
            Location
            <input id="location" name="location" type="text" maxLength={120} />
          </label>
          <label htmlFor="captureDate">
            Capture date
            <input id="captureDate" name="captureDate" type="date" />
          </label>
        </fieldset>

        <fieldset>
          <legend>Watermark</legend>
          <label htmlFor="watermarkEnabled" className="checkbox">
            <input
              id="watermarkEnabled"
              name="watermarkEnabled"
              type="checkbox"
              defaultChecked={watermarkDefaults.enabled}
            />
            Watermark the public derivatives
          </label>
          <label htmlFor="watermarkPosition">
            Position
            <select
              id="watermarkPosition"
              name="watermarkPosition"
              defaultValue={watermarkDefaults.position}
            >
              {WATERMARK_POSITIONS.map((position) => (
                <option key={position} value={position}>
                  {position.replace("-", " ")}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            The archival master is never watermarked, whichever position is chosen.
          </p>
        </fieldset>

        <fieldset>
          <legend>Publication</legend>
          <label htmlFor="published" className="checkbox">
            <input id="published" name="published" type="checkbox" />
            Publish immediately
          </label>
          <label htmlFor="featured" className="checkbox">
            <input id="featured" name="featured" type="checkbox" />
            Feature on the homepage
          </label>
          <label htmlFor="printAvailable" className="checkbox">
            <input id="printAvailable" name="printAvailable" type="checkbox" />
            Prints available
          </label>
        </fieldset>

        <button type="submit" disabled={busy}>
          {busy ? "Processing…" : "Upload"}
        </button>
      </Form>

      {result?.message ? (
        <p className="notice notice--warning" role="status">
          {result.message}
        </p>
      ) : null}

      {report ? (
        <section aria-live="polite">
          <h2>Result</h2>
          <p>
            {report.accepted} accepted, {report.rejected} refused
            {report.persisted
              ? "."
              : " — not persisted: this environment serves the development seed set, so the upload lasts only for this process."}
          </p>
          <ul className="plain-list">
            {report.outcomes.map((outcome) => (
              <li key={outcome.filename}>
                <strong>{outcome.filename}</strong>{" "}
                {outcome.ok && outcome.photo ? (
                  <span className="muted">
                    — stored as “{outcome.photo.title}” ({outcome.photo.slug}), original{" "}
                    {outcome.photo.width}×{outcome.photo.height}, public{" "}
                    {outcome.photo.webWidth}×{outcome.photo.webHeight}
                    {outcome.photo.watermarked ? ", watermarked" : ", no watermark"}
                  </span>
                ) : (
                  <span className="muted">— refused: {outcome.error?.message}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="muted">
        Signed in as {user.role}. A refused file is listed with the reason and nothing is
        stored for it; the other files in the same submission are still processed.
      </p>
    </section>
  );
}
