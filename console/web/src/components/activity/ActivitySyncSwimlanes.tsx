import { useMemo } from "react";
import type { ActivityEvent } from "../../api";
import { buildActivityParitySummary } from "../../hooks/useActivityParityPairs";
import { eventsInWindow, isProdEvent, isStagingEvent, timePositionPct } from "./activitySyncDemo";

const TICKS = [0, 5, 10, 15];

function SwimlaneDot({
  event,
  tone,
  paired,
}: {
  event: ActivityEvent;
  tone: "prod" | "staging";
  paired?: boolean;
}) {
  const left = timePositionPct(event.at);
  return (
    <button
      type="button"
      className={`activity-swim-dot activity-swim-dot--${tone} ${paired ? "activity-swim-dot--paired" : ""}`}
      style={{ left: `${left}%` }}
      title={`${event.name} · ${new Date(event.at).toLocaleTimeString()}`}
      aria-label={`${event.name} at ${new Date(event.at).toLocaleTimeString()}`}
    />
  );
}

function PairBridges({ pairs }: { pairs: ReturnType<typeof buildActivityParitySummary>["pairs"] }) {
  return (
    <svg className="activity-swim-bridges" aria-hidden="true">
      {pairs.map((pair) => {
        const x1 = timePositionPct(pair.prod.at);
        const x2 = timePositionPct(pair.staging.at);
        const y1 = 28;
        const y2 = 72;
        return (
          <line
            key={pair.key}
            x1={`${x1}%`}
            y1={y1}
            x2={`${x2}%`}
            y2={y2}
            className="activity-swim-bridge"
          />
        );
      })}
    </svg>
  );
}

export function ActivitySyncSwimlanes({ events }: { events: ActivityEvent[] }) {
  const windowEvents = useMemo(() => eventsInWindow(events), [events]);
  const summary = useMemo(() => buildActivityParitySummary(windowEvents), [windowEvents]);
  const prodEvents = windowEvents.filter(isProdEvent);
  const stagingEvents = windowEvents.filter(isStagingEvent);
  const pairedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const pair of summary.pairs) {
      ids.add(pair.prod.id);
      ids.add(pair.staging.id);
    }
    return ids;
  }, [summary.pairs]);

  return (
    <section className="card activity-sync-concept activity-swimlanes" aria-label="Dual swimlane sync preview">
      <header className="activity-sync-concept-head">
        <div>
          <h3>Dual swimlanes</h3>
          <p className="muted activity-sync-concept-lead">
            Prod and staging on separate tracks; dots sit on a 15-minute timeline. Green lines link matched pairs.
          </p>
        </div>
      </header>

      <div className="activity-swim-chart">
        <div className="activity-swim-axis">
          {TICKS.map((min) => (
            <span key={min} style={{ left: `${100 - (min / 15) * 100}%` }}>
              {min === 0 ? "now" : `−${min}m`}
            </span>
          ))}
        </div>
        <div className="activity-swim-tracks">
          <PairBridges pairs={summary.pairs} />
          <div className="activity-swim-lane activity-swim-lane--prod">
            <span className="activity-swim-lane-label">Prod</span>
            <div className="activity-swim-lane-track">
              {prodEvents.map((event) => (
                <SwimlaneDot key={event.id} event={event} tone="prod" paired={pairedIds.has(event.id)} />
              ))}
            </div>
          </div>
          <div className="activity-swim-lane activity-swim-lane--staging">
            <span className="activity-swim-lane-label">Staging</span>
            <div className="activity-swim-lane-track">
              {stagingEvents.map((event) => (
                <SwimlaneDot key={event.id} event={event} tone="staging" paired={pairedIds.has(event.id)} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="muted activity-sync-concept-foot">
        {summary.matchedCount} matched · {summary.prodOnlyCount} prod-only · {summary.stagingOnlyCount} staging-only
      </p>
    </section>
  );
}
