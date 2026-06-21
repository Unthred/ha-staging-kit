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

  const subtitle = loading
    ? "Loading live entity list…"
    : error
      ? error
      : rows.length === 0
        ? "No entities in this list."
        : `${rows.length} entit${rows.length === 1 ? "y" : "ies"}${
            side === "prodOnly" && domain === "sensor"
              ? " with live state on prod but not on staging."
              : side === "prodOnly"
                ? " on production only."
                : " on staging only."
          }`;

  return (
    <dialog
      ref={dialogRef}
      className="dash-git-files-dialog dash-entity-parity-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      onClose={onClose}
    >
      <div className="dash-git-files-dialog-panel dash-entity-parity-dialog-panel" onClick={(e) => e.stopPropagation()}>
        <header className="dash-git-files-dialog-head">
          <div>
            <h3>{title}</h3>
            <p className={error ? "dash-entity-parity-dialog-error" : "muted"}>{subtitle}</p>
          </div>
          <button type="button" className="btn secondary dash-git-files-close" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>

        <div className="dash-entity-parity-dialog-body">
          {!loading && !error && categories.length > 0 && (
            <section className="dash-entity-parity-categories" aria-label="Why they differ">
              <header className="dash-entity-parity-categories-head">
                <h4>Why they differ</h4>
              </header>
              <ul className="dash-entity-parity-category-list">
                {categories.map((c) => (
                  <li key={c.category}>
                    <strong>{c.label}</strong>
                    <span className="muted">{c.count}</span>
                  </li>
                ))}
              </ul>
            </section>
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
                        {row.inStagingRegistry ? (row.orphanedOnStaging ? "orphaned" : "yes") : "no"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {loading && <p className="muted dash-entity-parity-dialog-placeholder">Loading entity list…</p>}
        </div>
      </div>
    </dialog>
  );
}
