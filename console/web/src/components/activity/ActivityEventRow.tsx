import type { ActivityEvent } from "../../api";

export function ActivityEventRow({ event }: { event: ActivityEvent }) {
  const when = new Date(event.at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const isProd = event.instance.includes("Production");
  const rowTone = event.domain === "notify" ? "notify" : isProd ? "prod" : "staging";

  return (
    <li className={`activity-event-row activity-event-row--${rowTone}`}>
      <div className="activity-event-meta">
        <span className="activity-event-time">{when}</span>
        <span className={`activity-event-instance activity-event-instance--${isProd ? "prod" : "staging"}`}>
          {isProd ? "Production" : "Staging"}
        </span>
        <span className="activity-event-domain">{event.domain}</span>
        {event.parityMatch ? <span className="activity-event-parity">Both instances</span> : null}
      </div>
      <div className="activity-event-body">
        <strong className="activity-event-name">{event.name}</strong>
        <code className="activity-event-entity">{event.entityId}</code>
        {event.message && event.message !== event.name ? (
          <span className="activity-event-message muted">{event.message}</span>
        ) : null}
      </div>
    </li>
  );
}
