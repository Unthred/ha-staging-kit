import type { ConfigDriftStatus } from "../../api";

export function DashboardDriftCard({ drift }: { drift?: ConfigDriftStatus | null }) {
  if (!drift) return null;

  return (
    <section className={`dash-panel dash-drift ${drift.hasDrift ? "drift-yes" : "drift-no"}`}>
      <header className="dash-panel-head">
        <div>
          <p className="dash-panel-eyebrow">Config drift</p>
          <h3>{drift.hasDrift ? "Apply pending" : "In sync"}</h3>
        </div>
        <span className={`dash-badge ${drift.hasDrift ? "dash-badge-warn" : "dash-badge-ok"}`}>
          {drift.hasDrift ? "Drift" : "OK"}
        </span>
      </header>
      <p className="muted">{drift.detail}</p>
      {drift.repoCommit && (
        <p className="dash-drift-meta">
          Git <code>{drift.repoCommit}</code>
          {drift.lastAppliedCommit && (
            <>
              {" "}
              · applied <code>{drift.lastAppliedCommit}</code>
            </>
          )}
        </p>
      )}
    </section>
  );
}
