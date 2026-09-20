import type { MetaFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";

import { requireAdminAccess } from "../../auth/authorization.server";
import { appEnvironmentFrom } from "../../data/context.server";
import { listPublishedGalleries, listTagOptions } from "../../data/queries";
import {
  DEFAULT_WATERMARK_POSITION,
  WATERMARK_POSITIONS,
  type WatermarkPosition,
} from "../../images/image-processor";

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
  const [galleries, tags] = await Promise.all([listPublishedGalleries(env), listTagOptions(env)]);
  return { user, galleries, tags };
}

/** Read the operator's choices, rejecting anything the form could not have sent. */
function readOptions(form: FormData) {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const requested = text("watermarkPosition");
  const watermarkPosition: WatermarkPosition = (
    WATERMARK_POSITIONS as readonly string[]
  ).includes(requested)
    ? (requested as WatermarkPosition)
    : DEFAULT_WATERMARK_POSITION;
  return {
    title: text("title"),
    description: text("description"),
    galleryId: text("galleryId"),
    tags: form.getAll("tags").map((value) => String(value)),
    location: text("location") || null,
    captureDate: text("captureDate") || null,
    watermarkEnabled: form.get("watermarkEnabled") === "on",
    watermarkPosition,
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
 *   2. `assertRequestWithinLimit` — the request is refused from its
 *      `Content-Length` HEADER, before the body is parsed at all. A request whose
 *      size is undeclared is refused here too: an unbounded request cannot be
 *      given a memory ceiling;
 *   3. `request.formData()` — the only step that buffers the multipart body;
 *   4. `fileSourcesFrom` — the batch policy is applied to the parsed Files'
 *      METADATA, still before any file body is read;
 *   5. `ingestUploads` — reads and processes ONE file at a time.
 *
 * What this does NOT claim: that the body is never buffered. `formData()` holds
 * the file parts. The claim is that an oversized or unbounded request never
 * reaches that point, and that file bodies are materialised one at a time.
 */
export async function action({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
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

  const env = appEnvironmentFrom(context);
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

  // 5. Read and process the files one at a time.
  const report = await ingestUploads({
    env,
    files,
    options: readOptions(form),
  });
  return { report, message: null };
}

export default function AdminUploadRoute() {
  const { user, galleries, tags } = useLoaderData<typeof loader>();
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
            <input id="watermarkEnabled" name="watermarkEnabled" type="checkbox" defaultChecked />
            Watermark the public derivatives
          </label>
          <label htmlFor="watermarkPosition">
            Position
            <select
              id="watermarkPosition"
              name="watermarkPosition"
              defaultValue={DEFAULT_WATERMARK_POSITION}
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
