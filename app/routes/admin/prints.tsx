import type { MetaFunction } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";

import { requireAdminAccess } from "../../auth/authorization.server";
import { appEnvironmentFrom } from "../../data/context.server";
import {
  listPhotoPrintOptions,
  setPhotoPrintAvailable,
} from "../../enquiries/print-eligibility.server";
import { photoPath } from "../../lib/paths";
import { isSameOriginRequest, refuseCrossOriginRequest } from "../../lib/same-origin";

export const meta: MetaFunction = () => [
  { title: "Print eligibility — Anyaparallax admin" },
  { name: "robots", content: "noindex, nofollow" },
];

/**
 * Print eligibility (Slice 08).
 *
 * This is the EDITORIAL DECISION the print feature needs: whether a photograph is
 * offered for print enquiries. It exists because `photos.print_available` could
 * previously only be set while uploading, which is not a decision an operator can
 * revise — and print availability that cannot be changed is not an editorial
 * decision at all.
 *
 * It is deliberately NOT a metadata editor. It lists photographs, shows their
 * publication state and their print state, and changes exactly one column.
 * Publication, titles, tags, watermarking and galleries are untouched, and the
 * statement cannot alter them.
 *
 * The list includes UNPUBLISHED photographs on purpose: what will be offered is
 * decided before publication, and a list that hid drafts would force the decision
 * to be made in the wrong order. Each row states its publication state plainly, so
 * "offered for print" can never be mistaken for "visible to visitors" — marking a
 * draft eligible does not publish it, which the checks prove against real D1.
 *
 * The guard runs in both the loader and the action, for the same reason it does
 * everywhere else in `/admin`.
 */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
  const env = appEnvironmentFrom(context);
  return { view: await listPhotoPrintOptions(env) };
}

export async function action({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
  // Marking a photograph print-eligible is a public consequence, so the request must
  // have come from this site: authentication is checked first, the origin second, and
  // the body is not parsed until both hold (REPAIR-09E).
  if (!isSameOriginRequest(request)) {
    throw refuseCrossOriginRequest();
  }
  const env = appEnvironmentFrom(context);
  const form = await request.formData();
  // A checkbox sends "on" when it is checked and nothing when it is not, so the
  // requested state is an explicit boolean rather than a missing-value guess.
  const available = form.get("printAvailable") === "on";
  const result = await setPhotoPrintAvailable(env, form.get("photoId"), available);

  switch (result.status) {
    case "ok":
      return {
        message: result.printAvailable
          ? "This photograph is now offered for print enquiries."
          : "This photograph is no longer offered for print enquiries.",
        tone: "ok" as const,
      };
    case "not-found":
      return { message: "That photograph no longer exists, so nothing was changed.", tone: "warning" as const };
    case "bad-request":
      return { message: "That request was not understood, so nothing was changed.", tone: "warning" as const };
    default:
      return {
        message: "The change could not be saved, so print eligibility is unchanged.",
        tone: "warning" as const,
      };
  }
}

export default function AdminPrintsRoute() {
  const { view } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Prints</p>
        <h1>Print eligibility</h1>
        <p className="lede">
          Choose which photographs may be enquired about as prints. This changes only the print
          flag: it never publishes a photograph, and it never makes a draft visible.
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

      {view.available && view.photos.length === 0 ? (
        <p className="muted">No photographs have been uploaded yet.</p>
      ) : null}

      {view.available && view.photos.length > 0 ? (
        <table className="status-table print-table">
          <caption>
            {view.photos.length === 1 ? "1 photograph" : `${view.photos.length} photographs`}
          </caption>
          <thead>
            <tr>
              <th scope="col">Photograph</th>
              <th scope="col">Publicly visible</th>
              <th scope="col">Offered for print</th>
              <th scope="col">Save</th>
            </tr>
          </thead>
          <tbody>
            {view.photos.map((photo) => (
              <tr key={photo.id}>
                <th scope="row">
                  {photo.published ? (
                    <Link className="text-link" to={photoPath(photo.slug)}>
                      {photo.title}
                    </Link>
                  ) : (
                    <span>{photo.title}</span>
                  )}
                  <br />
                  <span className="muted">{photo.slug}</span>
                </th>
                <td>
                  {photo.published ? "Published" : <span className="muted">Draft — not public</span>}
                </td>
                <td>
                  <Form method="post" className="print-table__form">
                    <input type="hidden" name="photoId" value={photo.id} />
                    <label htmlFor={`print-${photo.id}`} className="checkbox">
                      <input
                        id={`print-${photo.id}`}
                        name="printAvailable"
                        type="checkbox"
                        defaultChecked={photo.printAvailable}
                      />
                      Available for print enquiries
                    </label>
                    <button type="submit" disabled={busy}>
                      Save
                    </button>
                  </Form>
                </td>
                <td className="muted">
                  {photo.printAvailable ? "Offered" : "Not offered"}
                  {photo.published ? "" : " (still a draft)"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <p className="muted">
        A draft marked here stays invisible on the public site, is not listed on{" "}
        <Link className="text-link" to="/prints">
          /prints
        </Link>
        , and cannot be attached to an enquiry.
      </p>
    </section>
  );
}
