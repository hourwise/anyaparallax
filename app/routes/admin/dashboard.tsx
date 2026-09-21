import type { MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { requireAdminAccess } from "../../auth/authorization.server";
import { appEnvironmentFrom } from "../../data/context.server";
import { readEnquiryCounts } from "../../enquiries/enquiries.server";
import { readEngagementInsights } from "../../engagement/insights.server";
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
  const [galleries, photos, enquiryCounts, engagement] = await Promise.all([
    listPublishedGalleries(env),
    listPublishedPhotos(env),
    readEnquiryCounts(env),
    readEngagementInsights(env),
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
    engagement,
  };
}

const areas = [
  {
    to: "/admin/photos",
    label: "Photos",
    description:
      "Correct metadata, gallery and tags, and publish, withdraw or feature a photograph.",
  },
  {
    to: "/admin/upload",
    label: "Upload photos",
    description: "Upload originals, generate derivatives and watermarks.",
  },
  {
    to: "/admin/enquiries",
    label: "Enquiries",
    description: "Print enquiries and contact messages, and their handled state.",
  },
  {
    to: "/admin/prints",
    label: "Print eligibility",
    description: "Choose which photographs may be enquired about as prints.",
  },
  {
    to: "/admin/galleries",
    label: "Galleries",
    description: "Create collections, describe and order them, and choose each cover.",
  },
  {
    to: "/admin/settings",
    label: "Settings",
    description: "Watermark defaults, social profiles, page introductions and tags.",
  },
] as const;

export default function AdminDashboardRoute() {
  const { user, galleryCount, photoCount, newEnquiryCount, enquiriesAvailable, engagement } =
    useLoaderData<typeof loader>();

  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Signed in as {user.role}</p>
        <h1>Photography workspace</h1>
        <p className="lede">
          Upload and manage photographs, organise the galleries visitors browse, review
          enquiries and set the defaults new uploads inherit.
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

      {/*
        Engagement is an aggregate only. The application stores no IP, user agent,
        referrer, fingerprint or browser token it could show here, and "shares" means
        share actions initiated through this site — never a claim that an external share
        completed.
      */}
      <section className="workspace-block" aria-labelledby="engagement-heading">
        <h2 id="engagement-heading">Engagement</h2>
        {!engagement.available ? (
          <p className="notice notice--warning">{engagement.reason}</p>
        ) : (
          <>
            <div className="status-grid">
              <article className="status-card">
                <p className="status-card__label">Likes</p>
                <p className="status-card__value">{engagement.totalLikes}</p>
              </article>
              <article className="status-card">
                <p className="status-card__label">Share actions initiated</p>
                <p className="status-card__value">{engagement.totalShares}</p>
              </article>
            </div>
            {engagement.totalLikes === 0 && engagement.totalShares === 0 ? (
              <p className="field-help">
                No likes or shares recorded yet. Both appear here once visitors use the
                controls on a photograph's page.
              </p>
            ) : (
              <div className="table-scroll">
                <table className="admin-table">
                  <caption className="visually-hidden">
                    Most liked and most shared photographs, and the channels used
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Most liked</th>
                      <th scope="col">Most shared</th>
                      <th scope="col">Channels used</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td data-label="Most liked">
                        {engagement.topLiked.length === 0 ? (
                          "None yet"
                        ) : (
                          <ul className="plain-list">
                            {engagement.topLiked.map((item) => (
                              <li key={item.slug}>
                                <Link className="text-link" to={`/photo/${item.slug}`}>
                                  {item.title}
                                </Link>{" "}
                                <span className="muted">— {item.total}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td data-label="Most shared">
                        {engagement.mostShared.length === 0 ? (
                          "None yet"
                        ) : (
                          <ul className="plain-list">
                            {engagement.mostShared.map((item) => (
                              <li key={item.slug}>
                                <Link className="text-link" to={`/photo/${item.slug}`}>
                                  {item.title}
                                </Link>{" "}
                                <span className="muted">— {item.total}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td data-label="Channels used">
                        {engagement.channels.length === 0 ? (
                          "None yet"
                        ) : (
                          <ul className="plain-list">
                            {engagement.channels.map((row) => (
                              <li key={row.channel}>
                                {row.channel} <span className="muted">— {row.total}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

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
