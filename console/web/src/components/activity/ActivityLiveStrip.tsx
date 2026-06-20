import type { ActivityEvent } from "../../api";
import type { ActivityPulseMetrics } from "../../hooks/useActivityPulseMetrics";
import {
  ActivityNotificationStack,
  filterLaneEvents,
  newestLaneEventId,
} from "./ActivityNotificationStack";
import { ActivityPulseSparkline } from "./ActivityPulseSparkline";

function PulseLane({
  label,
  laneClass,
  dotClass,
  metrics,
  barClass,
  laneEvents,
  newestId,
}: {
  label: string;
  laneClass: string;
  dotClass: string;
  metrics: ActivityPulseMetrics["prod"];
  barClass: string;
  laneEvents: ActivityEvent[];
  newestId: string | null;
}) {
  return (
    <div className={`activity-pulse-lane ${laneClass}`}>
      <div className="activity-pulse-lane-head">
        <span className="activity-pulse-lane-title">{label}</span>
        <span
          className={`activity-pulse-dot ${dotClass} ${metrics.isPulsing ? "activity-pulse-dot--live" : ""}`}
          aria-hidden="true"
        />
        <span className="activity-pulse-count muted">{metrics.recentCount} in last 15m</span>
      </div>
      <ActivityNotificationStack events={laneEvents} newestId={newestId} />
      <div className="activity-pulse-lane-body">
        <ActivityPulseSparkline buckets={metrics.buckets} barClass={barClass} ariaLabel={`${label} runs last 15 minutes`} />
      </div>
    </div>
  );
}

export function ActivityLiveStrip({
  metrics,
  parityFlash,
  events,
}: {
  metrics: ActivityPulseMetrics;
  parityFlash: boolean;
  events: ActivityEvent[];
}) {
  const prodEvents = filterLaneEvents(events, "prod");
  const stagingEvents = filterLaneEvents(events, "staging");

  return (
    <section
      className={`card activity-pulse-strip ${parityFlash ? "activity-pulse-strip--parity" : ""}`}
      aria-label="Live activity by instance"
    >
      <header className="activity-pulse-strip-head">
        <h3>Live activity</h3>
        {parityFlash ? <span className="activity-pulse-parity-badge">Both instances</span> : null}
      </header>
      <div className="activity-pulse-lanes">
        <PulseLane
          label="Production"
          laneClass="activity-pulse-lane--prod"
          dotClass="activity-pulse-dot--prod"
          metrics={metrics.prod}
          barClass="dash-spark-bar-prod"
          laneEvents={prodEvents}
          newestId={newestLaneEventId(events, "prod")}
        />
        <PulseLane
          label="Staging"
          laneClass="activity-pulse-lane--staging"
          dotClass="activity-pulse-dot--staging"
          metrics={metrics.staging}
          barClass="dash-spark-bar-staging"
          laneEvents={stagingEvents}
          newestId={newestLaneEventId(events, "staging")}
        />
      </div>
    </section>
  );
}
