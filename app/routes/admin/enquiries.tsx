import type { MetaFunction } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";

import { requireAdminAccess } from "../../auth/authorization.server";
import { appEnvironmentFrom } from "../../data/context.server";
import {
  ENQUIRY_CATEGORY_LABELS,
  ENQUIRY_STATUSES,
  ENQUIRY_STATUS_LABELS,
  PRINT_FORMAT_LABELS,
} from "../../enquiries/enquiry";
import { readEnquiries, updateEnquiryStatus } from "../../enquiries/enquiries.server";
import { photoPath } from "../../lib/paths";
import { isSameOriginRequest, refuseCrossOriginRequest } from "../../lib/same-origin";

export const meta: MetaFunction = () => [
  { title: "Enquiries — Anyaparallax admin" },
  { name: "robots", content: "noindex, nofollow" },
];

/**
 * Enquiry management (Slice 08).
 *
 * The guard runs in BOTH the loader and the action: React Router may run nested
 * loaders in parallel and an action is reachable without the loader having run at
 * all, so neither may assume the other denied first. The `/admin` layout's guard
 * and the Worker entry's `no-store` header are additional layers, not substitutes.
 *
 * WHAT IS SHOWN IS THE BOUNDED V1 SET and nothing else: when it arrived, who sent
 * it, which photograph it names, the format and size preference if one was given,
 * the message, and the handled state. There is no customer account, no order, no
 * payment state and no history — because none of those exist. The row carries no
 * address, user agent, referrer, fingerprint or engagement identifier to show.
 *
 * This loader is the ONLY place customer details are read, and no public route
 * imports it.
 */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
  const env = appEnvironmentFrom(context);
  return { view: await readEnquiries(env) };
}

/** Handle a submission, reporting the real outcome rather than assuming success. */
export async function action({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
  // An authenticated enquiry update is still refused when it did not come from this
  // site, and the refusal precedes the body parse: a cross-site POST must not reach
  // customer data at all (REPAIR-09E). Authorization stays first, so an
  // unauthenticated request keeps its existing 401.
  if (!isSameOriginRequest(request)) {
    throw refuseCrossOriginRequest();
  }
  const env = appEnvironmentFrom(context);
  const form = await request.formData();
  const result = await updateEnquiryStatus(
    String(form.get("enquiryId") ?? ""),
    form.get("status"),
    env,
  );
  switch (result.status) {
    case "ok":
      return { message: `Marked as ${ENQUIRY_STATUS_LABELS[result.enquiryStatus].toLowerCase()}.`, tone: "ok" as const };
    case "not-found":
      return { message: "That enquiry no longer exists, so nothing was changed.", tone: "warning" as const };
    case "bad-request":
      return { message: "That state is not one this application recognises.", tone: "warning" as const };
    default:
      return {
        message: "The change could not be saved, so the enquiry is unchanged.",
        tone: "warning" as const,
      };
  }
}

/** Render a stored timestamp in the operator's locale, or the raw value. */
function displayTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export default function AdminEnquiriesRoute() {
  const { view } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Enquiries</p>
        <h1>Enquiries</h1>
        <p className="lede">
          Print enquiries and contact messages, newest first. Reply from your own email; this
          application does not send mail itself.
        </p>
      </header>

      {result ? (
        <p
          className={result.tone === "ok" ? "notice" : "notice notice--warning"}
          role="status"
        >
          {result.message}
        </p>
      ) : null}

      {view.available ? null : (
        <p className="notice notice--warning" role="status">
          {view.reason}
        </p>
      )}

      {view.available && view.enquiries.length === 0 ? (
        <p className="muted">No enquiries have been received yet.</p>
      ) : null}

      {view.available && view.enquiries.length > 0 ? (
        <table className="status-table enquiry-table">
          <caption>
            {view.enquiries.length === 1
              ? "1 enquiry"
              : `${view.enquiries.length} enquiries, newest first`}
          </caption>
          <thead>
            <tr>
              <th scope="col">Received</th>
              <th scope="col">From</th>
              <th scope="col">About</th>
              <th scope="col">Preference</th>
              <th scope="col">Message</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {view.enquiries.map((enquiry) => (
              <tr key={enquiry.id}>
                <td>{displayTimestamp(enquiry.createdAt)}</td>
                <td>
                  <strong>{enquiry.name}</strong>
                  <br />
                  {/* A mailto link opens the operator's own client: no address is
                      sent anywhere by this application. */}
                  <a href={`mailto:${encodeURIComponent(enquiry.email)}`}>{enquiry.email}</a>
                </td>
                <td>
                  {ENQUIRY_CATEGORY_LABELS[enquiry.category]}
                  {enquiry.photoSlug ? (
                    <>
                      <br />
                      <Link className="text-link" to={photoPath(enquiry.photoSlug)}>
                        {enquiry.photoTitle ?? enquiry.photoSlug}
                      </Link>
                    </>
                  ) : null}
                </td>
                <td>
                  {enquiry.printFormat || enquiry.printSize ? (
                    <>
                      {enquiry.printFormat ? (
                        <span>{PRINT_FORMAT_LABELS[enquiry.printFormat]}</span>
                      ) : null}
                      {enquiry.printSize ? (
                        <>
                          <br />
                          <span className="muted">{enquiry.printSize}</span>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="enquiry-table__message">{enquiry.message}</td>
                <td>
                  <Form method="post" className="enquiry-table__state">
                    <input type="hidden" name="enquiryId" value={enquiry.id} />
                    <label htmlFor={`status-${enquiry.id}`} className="visually-hidden">
                      Handled state for the enquiry from {enquiry.name}
                    </label>
                    <select
                      id={`status-${enquiry.id}`}
                      name="status"
                      defaultValue={enquiry.status}
                    >
                      {ENQUIRY_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {ENQUIRY_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                    <button type="submit" disabled={busy}>
                      Save
                    </button>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
