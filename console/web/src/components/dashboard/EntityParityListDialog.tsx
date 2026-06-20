import { useEffect, useRef, useState } from "react";
import { dashboardApi, toApiError, type EntityParityDetailSnapshot } from "../../api";

export function EntityParityListDialog({
  open,
  onClose,
  domain,
  title,
  side,
}: {
  open: boolean;
  onClose: () => void;
  domain: string;
  title: string;
  side: "prodOnly" | "stagingOnly";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [details, setDetails] = useState<EntityParityDetailSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open || !domain) return;
    setLoading(true);
    setError(null);
    dashboardApi
      .entityParityDetails(domain)
      .then(setDetails)
      .catch((err) => setError(toApiError(err).message))
      .finally(() => setLoading(false));
  }, [open, domain]);

  const rows = side === "prodOnly" ? details?.prodOnly ?? [] : details?.stagingOnly ?? [];
  const categories = side === "prodOnly" ? details?.prodOnlyCategories ?? [] : [];

  return (
    <dialog ref={dialogRef} className="dash-dialog dash-entity-parity-dialog" onClose={onClose}>
      <div className="dash-dialog-header">
        <h3>{title}</h3>
        <button type="button" className="dash-dialog-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="dash-dialog-body">
        {loading && <p className="muted">Loading entity list…</p>}
        {error && <p className="dash-detail-warn">{error}</p>}
        {!loading && !error && categories.length > 0 && (
          <div className="dash-entity-parity-categories">
            <p className="dash-detail-files-col-title">Why they differ</p>
            <ul className="dash-detail-file-list">
              {categories.map((c) => (
                <li key={c.category}>
                  <strong>{c.label}</strong> — {c.count}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!loading && !error && (
          <p className="muted dash-detail-lead">
            {rows.length} entit{rows.length === 1 ? "y" : "ies"}
            {side === "prodOnly" && domain === "sensor"
              ? " with live state on prod but not on staging."
              : "."}
          </p>
        )}
        {!loading && !error && rows.length > 0 && (
          <div className="dash-entity-parity-table-wrap">
            <table className="dash-entity-parity-table">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Category</th>
                  <th>Reason</th>
                  {side === "prodOnly" && <th>Prod state</th>}
                  <th>Registry</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.entityId} className={row.orphanedOnStaging ? "dash-entity-parity-orphaned" : undefined}>
                    <td>
                      <code title={row.entityId}>{row.entityId}</code>
                    </td>
                    <td>{row.platform ?? row.category}</td>
                    <td>{row.reason}</td>
                    {side === "prodOnly" && <td>{row.prodState ?? "—"}</td>}
                    <td>
                      {row.inStagingRegistry
                        ? row.orphanedOnStaging
                          ? "orphaned"
                          : "yes"
                        : "no"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </dialog>
  );
}
