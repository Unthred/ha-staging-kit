import { useState } from "react";

export function DashboardLogTail({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="dash-panel dash-log-tail">
      <header className="dash-panel-head">
        <div>
          <p className="dash-panel-eyebrow">Sync log</p>
          <h3>Recent lines</h3>
        </div>
        <button type="button" className="btn ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Collapse" : "Expand"}
        </button>
      </header>
      {lines.length === 0 ? (
        <p className="muted">No sync log lines available.</p>
      ) : (
        <pre className={`dash-log-pre ${open ? "expanded" : ""}`}>{lines.join("\n")}</pre>
      )}
    </section>
  );
}
