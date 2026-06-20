import { useEffect, useRef } from "react";
import type { ActivityEvent } from "../../api";
import { ActivityEventRow } from "./ActivityEventRow";

export function ActivityFeed({
  events,
  paused,
}: {
  events: ActivityEvent[];
  paused: boolean;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const wasAtTop = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (!el || paused || !wasAtTop.current) return;
    el.scrollTop = 0;
  }, [events, paused]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    wasAtTop.current = el.scrollTop < 40;
  };

  const empty = events.length === 0;

  return (
    <div className="activity-feed">
      {empty ? (
        <p className="muted activity-feed-empty">
          No automation or script runs in the last 15 minutes. Staging may be quiet — many triggers only fire on prod.
        </p>
      ) : (
        <ul ref={listRef} className="activity-feed-list" onScroll={onScroll}>
          {events.map((event) => (
            <ActivityEventRow key={event.id} event={event} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function filterActivityEvents(
  events: ActivityEvent[],
  opts: {
    instance: "all" | "prod" | "staging";
    domain: "all" | "automation" | "script" | "notify";
    query: string;
  },
): ActivityEvent[] {
  const q = opts.query.trim().toLowerCase();
  return events.filter((e) => {
    if (opts.instance === "prod" && !e.instance.includes("Production")) return false;
    if (opts.instance === "staging" && !e.instance.includes("Staging")) return false;
    if (opts.domain !== "all" && e.domain !== opts.domain) return false;
    if (!q) return true;
    return (
      e.name.toLowerCase().includes(q) ||
      e.entityId.toLowerCase().includes(q) ||
      e.message.toLowerCase().includes(q)
    );
  });
}
