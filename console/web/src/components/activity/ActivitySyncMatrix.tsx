import { useMemo } from "react";
import type { ActivityEvent } from "../../api";
import { buildActivityParitySummary } from "../../hooks/useActivityParityPairs";
import {
  formatDelta,
  formatSyncClock,
  useActivitySyncRows,
  type ActivitySyncRow,
} from "../../hooks/useActivitySyncMatrix";

function SyncDot({ active, tone }: { active: boolean; tone: "prod" | "staging" }) {
  return (
    <span
      className={`activity-sync-dot activity-sync-dot--${tone} ${active ? "activity-sync-dot--on" : ""}`}
      aria-hidden="true"
    />
  );
}

function SyncConnector({ row }: { row: ActivitySyncRow }) {
  if (row.synced) {
    return <span className="activity-sync-connector activity-sync-connector--synced" aria-hidden="true" />;
  }
  if (row.prodAt && row.stagingAt) {
    return <span className="activity-sync-connector activity-sync-connector--skewed" aria-hidden="true" />;
  }
  return <span className="activity-sync-connector activity-sync-connector--open" aria-hidden="true" />;
}

function SyncRow({ row }: { row: ActivitySyncRow }) {
  return (
    <li
      className={`activity-sync-row ${row.synced ? "activity-sync-row--synced" : ""}`}
      title={`${row.label} · ${row.entityId}`}
    >
      <div className="activity-sync-row-label">
        <strong>{row.label}</strong>
        {row.reason ? <span className="muted activity-sync-row-reason">{row.reason}</span> : null}
      </div>
      <div className="activity-sync-row-visual">
        <div className="activity-sync-row-lane">
          <SyncDot active={Boolean(row.prodAt)} tone="prod" />
          <SyncConnector row={row} />
          <SyncDot active={Boolean(row.stagingAt)} tone="staging" />
        </div>
        <div className="activity-sync-row-times">
          <span className="activity-sync-time activity-sync-time--prod">{formatSyncClock(row.prodAt)}</span>
          <span className="activity-sync-time activity-sync-time--staging">{formatSyncClock(row.stagingAt)}</span>
        </div>
      </div>
      <div className="activity-sync-row-status">
        {row.synced ? (
          <span className="activity-sync-badge activity-sync-badge--ok">In sync · {formatDelta(row.deltaMs ?? 0)}</span>
        ) : row.prodAt && !row.stagingAt ? (
          <span className="activity-sync-badge activity-sync-badge--prod">Prod only</span>
        ) : row.stagingAt && !row.prodAt ? (
          <span className="activity-sync-badge activity-sync-badge--staging">Staging only</span>
        ) : (
          <span className="activity-sync-badge muted">No match</span>
        )}
      </div>
    </li>
  );
}

export function ActivitySyncMatrix({
  events,
  parityFlash,
}: {
  events: ActivityEvent[];
  parityFlash?: boolean;
}) {
  const summary = useMemo(() => buildActivityParitySummary(events), [events]);
  const rows = useActivitySyncRows(events);
  const syncedRows = rows.filter((row) => row.synced).length;

  return (
    <section
      className={`card activity-sync-matrix ${parityFlash ? "activity-sync-matrix--flash" : ""}`}
      aria-label="Production and staging sync matrix"
    >
      <header className="activity-sync-head">
        <div>
          <h3>Instance sync</h3>
          <p className="muted activity-sync-lead">Green bridge = same run on prod and staging within 60s.</p>
        </div>
        <div className="activity-sync-legend" aria-hidden="true">
          <span>
            <span className="activity-sync-dot activity-sync-dot--prod activity-sync-dot--on activity-sync-dot--legend" />{" "}
            Prod
          </span>
          <span>
            <span className="activity-sync-dot activity-sync-dot--staging activity-sync-dot--on activity-sync-dot--legend" />{" "}
            Staging
          </span>
          <span>
            <span className="activity-sync-connector activity-sync-connector--synced activity-sync-connector--legend" />{" "}
            Matched
          </span>
        </div>
      </header>

      <div className="activity-sync-summary-bar" aria-hidden="true">
        <div
          className="activity-sync-summary-fill"
          style={{
            width: summary.prodRecentCount
              ? `${Math.min(100, (summary.matchedCount / Math.max(summary.prodRecentCount, 1)) * 100)}%`
              : "0%",
          }}
        />
      </div>
      <p className="activity-sync-summary-text muted">
        {summary.matchedCount} matched · {summary.prodOnlyCount} prod-only · {summary.stagingOnlyCount} staging-only
        {summary.prodRecentCount > 0 ? ` (${syncedRows} shown below)` : ""}
      </p>

      {rows.length === 0 ? (
        <p className="activity-sync-empty muted">No runs in the last 15 minutes yet.</p>
      ) : (
        <ul className="activity-sync-list">
          {rows.map((row) => (
            <SyncRow key={row.key} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
