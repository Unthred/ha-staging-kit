import { useMemo } from "react";
import type { ActivityEvent } from "../../api";
import { buildActivityParitySummary, formatDelta } from "../../hooks/useActivityParityPairs";
import { buildActivitySyncRows, formatSyncClock } from "../../hooks/useActivitySyncMatrix";
import { eventsInWindow } from "./activitySyncDemo";

function SummaryTile({ matched, prodOnly, stagingOnly }: { matched: number; prodOnly: number; stagingOnly: number }) {
  const total = matched + prodOnly + stagingOnly;
  const pct = total > 0 ? Math.round((matched / total) * 100) : 0;
  return (
    <div className="activity-tile activity-tile--summary">
      <span className="activity-tile-kicker">Last 15 min</span>
      <strong className="activity-tile-big">{pct}%</strong>
      <span className="activity-tile-caption">in sync</span>
      <div className="activity-tile-breakdown">
        <span className="activity-tile-chip activity-tile-chip--ok">{matched} matched</span>
        <span className="activity-tile-chip activity-tile-chip--prod">{prodOnly} prod</span>
        <span className="activity-tile-chip activity-tile-chip--staging">{stagingOnly} staging</span>
      </div>
    </div>
  );
}

function EntityTile({
  label,
  prodAt,
  stagingAt,
  synced,
  deltaMs,
  reason,
}: {
  label: string;
  prodAt: string | null;
  stagingAt: string | null;
  synced: boolean;
  deltaMs: number | null;
  reason: string | null;
}) {
  return (
    <div className={`activity-tile activity-tile--entity ${synced ? "activity-tile--synced" : ""}`}>
      <div className="activity-tile-top">
        <strong className="activity-tile-name">{label}</strong>
        {synced ? (
          <span className="activity-tile-badge activity-tile-badge--ok">In sync</span>
        ) : prodAt && !stagingAt ? (
          <span className="activity-tile-badge activity-tile-badge--prod">Prod only</span>
        ) : stagingAt && !prodAt ? (
          <span className="activity-tile-badge activity-tile-badge--staging">Staging only</span>
        ) : (
          <span className="activity-tile-badge muted">Drift</span>
        )}
      </div>
      <div className="activity-tile-visual" aria-hidden="true">
        <div className={`activity-tile-node activity-tile-node--prod ${prodAt ? "is-on" : ""}`}>
          <span>P</span>
          <small>{formatSyncClock(prodAt)}</small>
        </div>
        <div className={`activity-tile-bridge ${synced ? "activity-tile-bridge--ok" : "activity-tile-bridge--open"}`} />
        <div className={`activity-tile-node activity-tile-node--staging ${stagingAt ? "is-on" : ""}`}>
          <span>S</span>
          <small>{formatSyncClock(stagingAt)}</small>
        </div>
      </div>
      {reason ? <p className="muted activity-tile-reason">{reason}</p> : null}
      {synced && deltaMs != null ? <p className="activity-tile-delta">{formatDelta(deltaMs)}</p> : null}
    </div>
  );
}

export function ActivitySyncTiles({ events }: { events: ActivityEvent[] }) {
  const windowEvents = useMemo(() => eventsInWindow(events), [events]);
  const summary = useMemo(() => buildActivityParitySummary(windowEvents), [windowEvents]);
  const rows = useMemo(() => buildActivitySyncRows(windowEvents).slice(0, 5), [windowEvents]);

  return (
    <section className="card activity-sync-concept activity-tiles" aria-label="Status tiles sync preview">
      <header className="activity-sync-concept-head">
        <div>
          <h3>Big status tiles</h3>
          <p className="muted activity-sync-concept-lead">
            Fewer items, larger visuals — summary score plus one card per recent run.
          </p>
        </div>
      </header>

      <div className="activity-tile-grid">
        <SummaryTile
          matched={summary.matchedCount}
          prodOnly={summary.prodOnlyCount}
          stagingOnly={summary.stagingOnlyCount}
        />
        {rows.map((row) => (
          <EntityTile
            key={row.key}
            label={row.label}
            prodAt={row.prodAt}
            stagingAt={row.stagingAt}
            synced={row.synced}
            deltaMs={row.deltaMs}
            reason={row.reason}
          />
        ))}
      </div>
    </section>
  );
}
