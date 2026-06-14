import type { SyncActivitySnapshot } from "../../api";

type Row = {
  id: string;
  label: string;
  when?: string | null;
  detail: string;
  tone: "ok" | "idle" | "warn";
};

export function DashboardActivityTimeline({
  activity,
  compact,
}: {
  activity?: SyncActivitySnapshot | null;
  compact?: boolean;
}) {
  const rows: Row[] = [
    {
      id: "person",
      label: "Person poll",
      when: activity?.lastPersonPollRelative,
      detail:
        activity?.lastPersonPollCount != null
          ? `${activity.lastPersonPollCount} states from prod`
          : "Not logged yet",
      tone: activity?.lastPersonPollAt ? "ok" : "idle",
    },
    {
      id: "apply",
      label: "Config apply",
      when: activity?.lastApplyRelative,
      detail: activity?.lastApplyCommit ? `Commit ${activity.lastApplyCommit}` : "Not logged yet",
      tone: activity?.lastApplyAt ? "ok" : "idle",
    },
    {
      id: "storage",
      label: "Storage sync",
      when: activity?.lastStorageSyncRelative,
      detail: activity?.lastStorageSyncAt ? "Prod .storage copied" : "Not logged yet",
      tone: activity?.lastStorageSyncAt ? "ok" : "warn",
    },
  ];

  const grid = (
    <div className={`dash-timeline-grid ${compact ? "dash-timeline-grid-compact" : ""}`}>
      {rows.map((row) => (
        <article key={row.id} className={`dash-timeline-card dash-timeline-${row.tone}`}>
          <p className="dash-timeline-label">{row.label}</p>
          <p className="dash-timeline-when">{row.when ?? "Never"}</p>
          <p className="dash-timeline-detail">{row.detail}</p>
        </article>
      ))}
    </div>
  );

  if (compact) {
    return (
      <section className="dash-panel dash-activity-timeline dash-activity-timeline-compact">
        <header className="dash-panel-head dash-panel-head-tight">
          <h3>Last sync events</h3>
        </header>
        {grid}
      </section>
    );
  }

  return (
    <section className="dash-panel dash-activity-timeline">
      <header className="dash-panel-head">
        <div>
          <p className="dash-panel-eyebrow">Pipeline timing</p>
          <h3>Last sync events</h3>
        </div>
      </header>
      {grid}
    </section>
  );
}
