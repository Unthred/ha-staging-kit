import { useMemo } from "react";
import type { ActivityEvent } from "../../api";
import {
  eventsInWindow,
  isProdEvent,
  isStagingEvent,
  SYNC_HISTORY_MS,
} from "./activitySyncDemo";

const BUCKET_COUNT = 5;
const BUCKET_MS = SYNC_HISTORY_MS / BUCKET_COUNT;
const MAX_ROWS = 8;

type HeatCell = "empty" | "prod" | "staging" | "both" | "skewed";

type HeatRow = {
  key: string;
  label: string;
  cells: HeatCell[];
};

function bucketIndex(at: string) {
  const age = Date.now() - new Date(at).getTime();
  const idx = BUCKET_COUNT - 1 - Math.floor(age / BUCKET_MS);
  return Math.max(0, Math.min(BUCKET_COUNT - 1, idx));
}

function buildHeatRows(events: ActivityEvent[]): HeatRow[] {
  const windowEvents = eventsInWindow(events);
  const byEntity = new Map<string, { label: string; prod: Set<number>; staging: Set<number> }>();

  for (const event of windowEvents) {
    const key = event.entityId.toLowerCase();
    const entry = byEntity.get(key) ?? { label: event.name, prod: new Set(), staging: new Set() };
    entry.label = event.name;
    const bucket = bucketIndex(event.at);
    if (isProdEvent(event)) entry.prod.add(bucket);
    if (isStagingEvent(event)) entry.staging.add(bucket);
    byEntity.set(key, entry);
  }

  const rows: HeatRow[] = [];
  for (const [key, entry] of byEntity) {
    const cells: HeatCell[] = [];
    for (let i = 0; i < BUCKET_COUNT; i++) {
      const hasProd = entry.prod.has(i);
      const hasStaging = entry.staging.has(i);
      if (hasProd && hasStaging) cells.push("both");
      else if (hasProd) cells.push("prod");
      else if (hasStaging) cells.push("staging");
      else cells.push("empty");
    }
    rows.push({ key, label: entry.label, cells });
  }

  rows.sort((a, b) => {
    const score = (row: HeatRow) => row.cells.filter((c) => c !== "empty").length;
    return score(b) - score(a);
  });

  return rows.slice(0, MAX_ROWS);
}

export function ActivitySyncHeatmap({ events }: { events: ActivityEvent[] }) {
  const rows = useMemo(() => buildHeatRows(events), [events]);
  const bucketLabels = useMemo(() => {
    const labels: string[] = [];
    for (let i = 0; i < BUCKET_COUNT; i++) {
      const endMin = Math.round(((BUCKET_COUNT - i) * BUCKET_MS) / 60_000);
      const startMin = Math.round(((BUCKET_COUNT - 1 - i) * BUCKET_MS) / 60_000);
      labels.push(i === BUCKET_COUNT - 1 ? "now" : `−${endMin}–${startMin}m`);
    }
    return labels;
  }, []);

  return (
    <section className="card activity-sync-concept activity-heatmap" aria-label="Heatmap sync preview">
      <header className="activity-sync-concept-head">
        <div>
          <h3>Heatmap grid</h3>
          <p className="muted activity-sync-concept-lead">
            Each row is an automation or reminder; columns are 3-minute slices. Color shows who fired.
          </p>
        </div>
        <div className="activity-heatmap-legend" aria-hidden="true">
          <span><i className="activity-heat-cell activity-heat-cell--both" /> Both</span>
          <span><i className="activity-heat-cell activity-heat-cell--prod" /> Prod</span>
          <span><i className="activity-heat-cell activity-heat-cell--staging" /> Staging</span>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="muted activity-sync-concept-empty">No runs in the last 15 minutes.</p>
      ) : (
        <div className="activity-heatmap-wrap">
          <table className="activity-heatmap-table">
            <thead>
              <tr>
                <th scope="col">Entity</th>
                {bucketLabels.map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  {row.cells.map((cell, index) => (
                      <td key={index}>
                        <span
                          className={`activity-heat-cell activity-heat-cell--${cell}`}
                          title={cell === "empty" ? "Quiet" : cell}
                        />
                      </td>
                    ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
