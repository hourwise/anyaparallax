/**
 * Small label/state tables used by the Manager dashboard and diagnostics page.
 * Presentation only: the page's loader has already been authorised, and the
 * values are the low-sensitivity states produced by `app/data/diagnostics.server.ts`.
 */
export type StatusEntry = {
  readonly label: string;
  readonly state: string;
  readonly detail?: string;
};

export function StatusTable({
  caption,
  entries,
}: {
  caption: string;
  entries: readonly StatusEntry[];
}) {
  return (
    <table className="status-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Item</th>
          <th scope="col">State</th>
          <th scope="col">Notes</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.label}>
            <th scope="row">{entry.label}</th>
            <td>{entry.state}</td>
            <td className="muted">{entry.detail ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
