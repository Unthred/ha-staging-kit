import type { ActivityEvent } from "../../api";
import {
  formatDelta,
  formatPairClock,
  useActivityParitySummary,
  type ActivityParityPair,
} from "../../hooks/useActivityParityPairs";

function StatChip({ label, value, tone }: { label: string; value: number; tone?: "ok" | "prod" | "staging" }) {
  return (
    <span className={`activity-parity-stat activity-parity-stat--${tone ?? "neutral"}`}>
      <span className="activity-parity-stat-value">{value}</span>
      <span className="activity-parity-stat-label">{label}</span>
    </span>
  );
}

function ParityPairRow({ pair, highlight }: { pair: ActivityParityPair; highlight: boolean }) {
  return (
    <li className={`activity-parity-row ${highlight ? "activity-parity-row--flash" : ""}`}>
      <div className="activity-parity-row-sync" aria-hidden="true">
        <span className="activity-parity-node activity-parity-node--prod" />
        <span className="activity-parity-bridge" />
        <span className="activity-parity-node activity-parity-node--staging" />
      </div>
      <div className="activity-parity-row-body">
        <div className="activity-parity-row-head">
          <strong className="activity-parity-row-name">{pair.name}</strong>
          <span className="activity-parity-row-badge">In sync</span>
        </div>
        <div className="activity-parity-row-times">
          <span>
            <span className="activity-parity-time-label">Prod</span> {formatPairClock(pair.prod.at)}
          </span>
          <span>
            <span className="activity-parity-time-label">Staging</span> {formatPairClock(pair.staging.at)}
          </span>
          <span className="activity-parity-row-delta">{formatDelta(pair.deltaMs)}</span>
        </div>
        <p className="activity-parity-row-reason muted">{pair.reason}</p>
        <code className="activity-parity-row-entity">{pair.entityId}</code>
      </div>
    </li>
  );
}

export function ActivityParityPanel({
  events,
  parityFlash,
}: {
  events: ActivityEvent[];
  parityFlash?: boolean;
}) {
  const summary = useActivityParitySummary(events);
  const newestPairKey = summary.pairs[0]?.key ?? null;

  return (
    <section
      className={`card activity-parity-panel ${parityFlash ? "activity-parity-panel--flash" : ""}`}
      aria-label="Prod and staging parity"
    >
      <header className="activity-parity-head">
        <div>
          <h3>Prod ↔ staging sync</h3>
          <p className="muted activity-parity-lead">
            Same automation, script, or notify on both instances within 60 seconds.
          </p>
        </div>
        <div className="activity-parity-stats">
          <StatChip label="in sync" value={summary.matchedCount} tone="ok" />
          <StatChip label="prod only" value={summary.prodOnlyCount} tone="prod" />
          <StatChip label="staging only" value={summary.stagingOnlyCount} tone="staging" />
        </div>
      </header>

      {summary.pairs.length === 0 ? (
        <p className="activity-parity-empty muted">
          No matched runs in the last 15 minutes.
          {summary.prodRecentCount > 0 || summary.stagingRecentCount > 0
            ? ` Prod fired ${summary.prodRecentCount} time(s), staging ${summary.stagingRecentCount} — check the timeline below for details.`
            : " Waiting for activity…"}
        </p>
      ) : (
        <ul className="activity-parity-list">
          {summary.pairs.map((pair) => (
            <ParityPairRow key={pair.key} pair={pair} highlight={Boolean(parityFlash && pair.key === newestPairKey)} />
          ))}
        </ul>
      )}
    </section>
  );
}
