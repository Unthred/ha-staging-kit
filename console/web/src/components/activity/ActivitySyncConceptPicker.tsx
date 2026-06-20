import { useMemo, useState } from "react";
import type { ActivityEvent } from "../../api";
import { ActivitySyncHeatmap } from "./ActivitySyncHeatmap";
import { ActivitySyncMatrix } from "./ActivitySyncMatrix";
import { ActivitySyncSwimlanes } from "./ActivitySyncSwimlanes";
import { ActivitySyncTiles } from "./ActivitySyncTiles";
import { getActivitySyncDemoEvents } from "./activitySyncDemo";

export type SyncConceptId = "matrix" | "swimlanes" | "heatmap" | "tiles";

const CONCEPTS: { id: SyncConceptId; label: string; blurb: string }[] = [
  {
    id: "matrix",
    label: "Sync matrix",
    blurb: "Row per entity with prod dot — bar — staging dot.",
  },
  {
    id: "swimlanes",
    label: "Swimlanes",
    blurb: "Two time tracks; see when things fired and how pairs align.",
  },
  {
    id: "heatmap",
    label: "Heatmap",
    blurb: "Density at a glance — who fired in each time slice.",
  },
  {
    id: "tiles",
    label: "Tiles",
    blurb: "Big cards — overall score plus a few recent runs.",
  },
];

export function ActivitySyncConceptPicker({
  events,
  parityFlash,
}: {
  events: ActivityEvent[];
  parityFlash?: boolean;
}) {
  const [concept, setConcept] = useState<SyncConceptId>("matrix");
  const previewEvents = useMemo(() => (events.length > 0 ? events : getActivitySyncDemoEvents()), [events]);
  const usingDemo = events.length === 0;

  return (
    <div className="activity-sync-picker">
      <div className="activity-sync-picker-bar card">
        <div className="activity-sync-picker-copy">
          <h2>Pick a sync view</h2>
          <p className="muted">
            Compare layouts below — same data in each. Tell me which one to keep.
            {usingDemo ? " Showing sample data until live events arrive." : " Using your live stream."}
          </p>
        </div>
        <div className="activity-sync-picker-tabs" role="tablist" aria-label="Sync view concepts">
          {CONCEPTS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={concept === item.id}
              className={`activity-sync-picker-tab ${concept === item.id ? "is-active" : ""}`}
              onClick={() => setConcept(item.id)}
            >
              <span className="activity-sync-picker-tab-label">{item.label}</span>
              <span className="activity-sync-picker-tab-blurb">{item.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" aria-label={CONCEPTS.find((c) => c.id === concept)?.label}>
        {concept === "matrix" ? (
          <ActivitySyncMatrix events={previewEvents} parityFlash={parityFlash && !usingDemo} />
        ) : null}
        {concept === "swimlanes" ? <ActivitySyncSwimlanes events={previewEvents} /> : null}
        {concept === "heatmap" ? <ActivitySyncHeatmap events={previewEvents} /> : null}
        {concept === "tiles" ? <ActivitySyncTiles events={previewEvents} /> : null}
      </div>
    </div>
  );
}
