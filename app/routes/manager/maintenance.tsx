import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { requireManagerAccess } from "../../auth/authorization.server";
import { appEnvironmentFrom } from "../../data/context.server";
import { maintenanceReport } from "../../data/maintenance.server";

export const meta: MetaFunction = () => [
  { title: "Maintenance — Anyaparallax manager" },
  { name: "robots", content: "noindex, nofollow" },
];

/**
 * Maintenance: what the stored data looks like, and whether it still makes sense.
 *
 * This replaced a placeholder that said no maintenance operation existed. The useful
 * V1 answer to "is anything wrong?" is an integrity report an operator can actually
 * read — counts, broken relationships, publication states that disagree, and whether
 * the expected objects are still in the buckets.
 *
 * NO DESTRUCTIVE CONTROL IS WIRED TO THIS PAGE, deliberately. Resetting data, purging
 * derivatives or deleting accounts would each be one mistyped click away from an
 * archive with no backup, and nothing in V1 requires them. The page says so, rather
 * than leaving an operator to wonder whether the tools are merely hidden.
 */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  await requireManagerAccess(request, context);
  const report = await maintenanceReport(appEnvironmentFrom(context));
  return { report };
}

export default function ManagerMaintenanceRoute() {
  const { report } = useLoaderData<typeof loader>();

  if (!report.available) {
    return (
      <section className="page">
        <header className="page__header">
          <p className="eyebrow">Maintenance</p>
          <h1>Maintenance</h1>
        </header>
        <p className="notice notice--warning">{report.reason}</p>
      </section>
    );
  }

  const attention = report.findings.filter((finding) => finding.level === "attention");

  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Maintenance</p>
        <h1>Maintenance</h1>
        <p className="lede">
          Read-only integrity checks over the stored data and the storage bindings. Nothing on
          this page changes anything.
        </p>
      </header>

      <p className={attention.length === 0 ? "notice notice--ok" : "notice notice--warning"}>
        {attention.length === 0
          ? "Every check passed: the stored data is internally consistent."
          : `${attention.length} check${attention.length === 1 ? "" : "s"} need attention — see below. Nothing has been changed automatically.`}
      </p>

      <section className="workspace-block" aria-labelledby="counts-heading">
        <h2 id="counts-heading">Stored records</h2>
        <div className="table-scroll">
          <table className="admin-table">
            <caption className="visually-hidden">Record counts</caption>
            <tbody>
              {[
                ["Authorised accounts", `${report.counts.users} (${report.counts.activeManagers} active manager(s))`],
                ["Galleries", `${report.counts.galleries} (${report.counts.publishedGalleries} published)`],
                ["Photographs", `${report.counts.photos} (${report.counts.publishedPhotos} published)`],
                ["Tags", `${report.counts.tags} across ${report.counts.tagLinks} photograph links`],
                ["Enquiries", `${report.counts.enquiries} (${report.counts.newEnquiries} new)`],
                ["Likes", String(report.counts.likes)],
                ["Share events", String(report.counts.shareEvents)],
              ].map(([label, value]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td data-label="Count">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="workspace-block" aria-labelledby="integrity-heading">
        <h2 id="integrity-heading">Integrity checks</h2>
        <div className="table-scroll">
          <table className="admin-table">
            <caption className="visually-hidden">Integrity check results</caption>
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {report.findings.map((finding) => (
                <tr key={finding.label}>
                  <th scope="row">{finding.label}</th>
                  <td data-label="Result">
                    <span className={finding.level === "ok" ? "state-badge" : "state-badge state-badge--attention"}>
                      {finding.level === "ok" ? "OK" : "Attention"}
                    </span>{" "}
                    {finding.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="workspace-block" aria-labelledby="storage-heading">
        <h2 id="storage-heading">Stored objects</h2>
        {!report.storage.bound ? (
          <p className="notice notice--warning">{report.storage.note}</p>
        ) : report.storage.status === "degraded" ? (
          <>
            <p className="notice notice--warning">{report.storage.note}</p>
            <div className="table-scroll">
              <table className="admin-table">
                <caption className="visually-hidden">Object existence probe, partially read</caption>
                <tbody>
                  <tr>
                    <th scope="row">Photographs inspected</th>
                    <td data-label="Count">{report.storage.checked}</td>
                  </tr>
                  <tr>
                    <th scope="row">Objects reported missing so far</th>
                    <td data-label="Count">
                      {report.storage.missingMasters +
                        report.storage.missingDerivatives +
                        report.storage.missingThumbnails}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <caption className="visually-hidden">Object existence probe</caption>
              <tbody>
                <tr>
                  <th scope="row">Photographs inspected</th>
                  <td data-label="Count">{report.storage.checked}</td>
                </tr>
                <tr>
                  <th scope="row">Private masters missing</th>
                  <td data-label="Count">{report.storage.missingMasters}</td>
                </tr>
                <tr>
                  <th scope="row">Web derivatives missing</th>
                  <td data-label="Count">{report.storage.missingDerivatives}</td>
                </tr>
                <tr>
                  <th scope="row">Thumbnails missing</th>
                  <td data-label="Count">{report.storage.missingThumbnails}</td>
                </tr>
              </tbody>
            </table>
            <p className="field-help">{report.storage.note}</p>
          </div>
        )}
      </section>

      <section className="workspace-block" aria-labelledby="destructive-heading">
        <h2 id="destructive-heading">Destructive tools</h2>
        <p className="notice">
          There are none, by design. Nothing here resets data, purges derivatives or deletes
          accounts: those operations would risk an archive that has no backup, and no part of
          V1 needs them. Unpublishing a photograph or a gallery is the reversible withdrawal
          mechanism, and it lives on those screens.
        </p>
      </section>
    </section>
  );
}
