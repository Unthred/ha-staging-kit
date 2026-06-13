import type { PersonSyncSnapshot } from "../../api";

export function DashboardPersonKpi({ personSync }: { personSync?: PersonSyncSnapshot | null }) {
  const count = personSync?.lastCount ?? null;

  return (
    <section className="dash-panel dash-person-kpi">
      <p className="dash-panel-eyebrow">Presence sync</p>
      <div className="dash-person-kpi-value">{count ?? "—"}</div>
      <p className="dash-person-kpi-label">states mirrored from prod</p>
      <p className="dash-person-kpi-meta">
        {personSync?.lastAtRelative
          ? `Last poll ${personSync.lastAtRelative}`
          : "No successful person poll logged yet"}
      </p>
    </section>
  );
}
