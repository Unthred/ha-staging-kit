import type { ActivityEvent } from "../../api";

const MAX_CARDS = 4;

function formatRelative(at: string): string {
  const diffMs = Date.now() - new Date(at).getTime();
  if (diffMs < 15_000) return "just now";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function ActivityNotificationStack({
  events,
  newestId,
}: {
  events: ActivityEvent[];
  newestId: string | null;
}) {
  const recent = events.slice(0, MAX_CARDS);

  if (recent.length === 0) {
    return <p className="activity-notify-empty muted">No recent runs</p>;
  }

  return (
    <ul className="activity-notify-stack" aria-label="Recent runs">
      {recent.map((event) => (
        <li
          key={event.id}
          className={`activity-notify-card ${event.parityMatch ? "activity-notify-card--parity" : ""} ${
            event.id === newestId ? "activity-notify-card--new" : ""
          }`}
          title={event.entityId}
        >
          <div className="activity-notify-card-head">
            <span className="activity-notify-domain">{event.domain}</span>
            <span className="activity-notify-when">{formatRelative(event.at)}</span>
          </div>
          <p className="activity-notify-name">{event.name}</p>
          {event.parityMatch ? <span className="activity-notify-parity">Both instances</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function filterLaneEvents(events: ActivityEvent[], instance: "prod" | "staging"): ActivityEvent[] {
  return events.filter((event) =>
    instance === "prod" ? event.instance.includes("Production") : event.instance.includes("Staging"),
  );
}

export function newestLaneEventId(events: ActivityEvent[], instance: "prod" | "staging"): string | null {
  return filterLaneEvents(events, instance)[0]?.id ?? null;
}
