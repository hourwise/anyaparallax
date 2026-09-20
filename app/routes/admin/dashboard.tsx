import type { MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { requireAdminAccess } from "../../auth/authorization.server";
import { appEnvironmentFrom } from "../../data/context.server";
import { readEnquiryCounts } from "../../enquiries/enquiries.server";
import { listPublishedGalleries, listPublishedPhotos } from "../../data/queries";

export const meta: MetaFunction = () => [
  { title: "Admin dashboard — Anyaparallax Photography" },
  { name: "robots", content: "noindex, nofollow" },
];

/**
 * The route guard runs HERE, not only in the layout: React Router may run
 * nested loaders in parallel, so a protected endpoint must be able to deny on
 * its own. The public counts below come from the public query boundary.
 */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  const user = await requireAdminAccess(request, context);
  const env = appEnvironmentFrom(context);
  const [galleries, photos, enquiryCounts] = await Promise.all([
    listPublishedGalleries(env),
    listPublishedPhotos(env),
    readEnquiryCounts(env),
  ]);
  /**
   * Enquiries awaiting attention (REPAIR-09D).
   *
   * The count comes from the stored `status` column — `new` is the state an enquiry
   * is created in and the one the operator clears by reading it — rather than from a
   * timestamp. Two cases are deliberately not conflated:
   *
   *   * `enquiryCounts === null` means the counts could not be READ, and the page says
   *     so rather than showing a zero it cannot support;
   *   * a map without a `new` key means the read succeeded and there are none, which
   *     is a truthful zero.
   */
  return {
    user,
    galleryCount: galleries.length,
    photoCount: photos.length,
    newEnquiryCount: enquiryCounts === null ? null : (enquiryCounts.get("new") ?? 0),
    enquiriesAvailable: enquiryCounts !== null,
  };
}

const areas = [
  {
    to: "/admin/photos",
    label: "Photos",
    description:
      "Correct metadata, gallery and tags, and publish, withdraw or feature a photograph (REPAIR-09B).",
  },
  {
    to: "/admin/upload",
    label: "Upload photos",
    description: "Upload originals, generate derivatives and watermarks.",
  },
  {
    to: "/admin/enquiries",
    label: "Enquiries",
    description: "Print enquiries and contact messages, and their handled state (Slice 08).",
  },
  {
    to: "/admin/prints",
    label: "Print eligibility",
    description: "Choose which photographs may be enquired about as prints (Slice 08).",
  },
  {
    to: "/admin/galleries",
    label: "Galleries",
    description: "Create and order collections, choose covers (later slice).",
  },
  {
    to: "/admin/settings",
    label: "Settings",
    description: "Watermark defaults and site content for Anya's workspace (later slice).",
  },
] as const;

export default function AdminDashboardRoute() {
  const { user, galleryCount, photoCount, newEnquiryCount, enquiriesAvailable } =
    useLoaderData<typeof loader>();

  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Signed in as {user.role}</p>
        <h1>Photography workspace</h1>
        <p className="lede">
          This dashboard is real: the identity above was verified server-side and looked up
          in the authorised-user directory on this request. Uploading, watermarking and the
          enquiry list work; the remaining editing tools are listed below.
        </p>
      </header>

      {/*
        The enquiries needing attention come FIRST, and above the informational counts,
        because they are the only thing on this page that is waiting for a person. The
        wording says what the number means ("awaiting a reply") rather than leaving the
        operator to infer it, and it states plainly when the count could not be read.
      */}
      <section className="status-card status-card--attention" aria-labelledby="enquiries-heading">
        <p className="status-card__label" id="enquiries-heading">
          Enquiries awaiting a reply
        </p>
        <p className="status-card__value">
          {!enquiriesAvailable
            ? "Unavailable"
            : newEnquiryCount === 0
              ? "No new enquiries"
              : `${newEnquiryCount} new ${newEnquiryCount === 1 ? "enquiry" : "enquiries"}`}
        </p>
        <p className="status-card__note">
          {enquiriesAvailable
            ? "Print enquiries and contact messages that have not been marked as read yet."
            : "The enquiry list could not be read in this environment."}{" "}
          <Link className="text-link" to="/admin/enquiries">
            Open the enquiry list
          </Link>
        </p>
      </section>

      <div className="status-grid">
        <article className="status-card">
          <p className="status-card__label">Published galleries</p>
          <p className="status-card__value">{galleryCount}</p>
        </article>
        <article className="status-card">
          <p className="status-card__label">Published photographs</p>
          <p className="status-card__value">{photoCount}</p>
        </article>
      </div>

      <h2>Operator areas</h2>
      <ul className="plain-list">
        {areas.map((area) => (
          <li key={area.to}>
            <Link className="text-link" to={area.to}>
              {area.label}
            </Link>{" "}
            <span className="muted">— {area.description}</span>
          </li>
        ))}
      </ul>

      <p className="muted">
        Unpublished photographs and galleries stay hidden from the public site. Marking a
        photograph as available for print enquiries does not publish it.
      </p>
    </section>
  );
}
