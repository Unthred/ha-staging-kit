import type { PollHistoryPoint } from "../../api";

export function DashboardPollSparkline({ history }: { history: PollHistoryPoint[] }) {
  if (history.length === 0) {
    return (
      <section className="dash-panel dash-sparkline">
        <p className="dash-panel-eyebrow">Poll history</p>
        <h3>No history yet</h3>
        <p className="muted">Person poll counts will appear here as the sync loop runs.</p>
      </section>
    );
  }

  const max = Math.max(...history.map((p) => p.count), 1);
  const width = 280;
  const height = 72;
  const barW = Math.max(4, Math.floor(width / history.length) - 2);

  return (
    <section className="dash-panel dash-sparkline">
      <header className="dash-panel-head">
        <div>
          <p className="dash-panel-eyebrow">Poll history</p>
          <h3>Last {history.length} polls</h3>
        </div>
      </header>
      <svg viewBox={`0 0 ${width} ${height}`} className="dash-sparkline-svg" role="img" aria-label="Person poll history chart">
        {history.map((point, i) => {
          const h = Math.max(4, (point.count / max) * (height - 8));
          const x = i * (barW + 2) + 2;
          const y = height - h - 4;
          return (
            <rect
              key={`${point.at}-${i}`}
              x={x}
              y={y}
              width={barW}
              height={h}
              rx={2}
              className={point.ok ? "dash-spark-bar-ok" : "dash-spark-bar-warn"}
            />
          );
        })}
      </svg>
      <p className="muted dash-sparkline-meta">
        Latest: {history[history.length - 1]?.count ?? 0} states synced
      </p>
    </section>
  );
}
