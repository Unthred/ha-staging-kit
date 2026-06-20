import { HubConnection, HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import { useCallback, useEffect, useRef, useState } from "react";
import { activityApi, type ActivityEvent, type ActivityInstanceStatus, type ActivitySnapshot } from "../api";

const MAX_EVENTS = 1000;

function upsertEvent(list: ActivityEvent[], evt: ActivityEvent): ActivityEvent[] {
  if (list.some((e) => e.id === evt.id)) return list;
  return [evt, ...list].slice(0, MAX_EVENTS);
}

export function useActivityStream() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [statuses, setStatuses] = useState<ActivityInstanceStatus[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectionRef = useRef<HubConnection | null>(null);

  const applySnapshot = useCallback((snapshot: ActivitySnapshot) => {
    setEvents(snapshot.events ?? []);
    setStatuses(snapshot.statuses ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      try {
        const snapshot = await activityApi.snapshot();
        if (!cancelled) applySnapshot(snapshot);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load activity snapshot");
      }

      const connection = new HubConnectionBuilder()
        .withUrl("/hubs/activity")
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(LogLevel.Warning)
        .build();

      connection.on("snapshot", (snapshot: ActivitySnapshot) => {
        applySnapshot(snapshot);
      });

      connection.on("event", (evt: ActivityEvent) => {
        setEvents((prev) => upsertEvent(prev, evt));
      });

      connection.on("status", (next: ActivityInstanceStatus[]) => {
        setStatuses(next ?? []);
      });

      connection.onreconnecting(() => setConnected(false));
      connection.onreconnected(() => setConnected(true));
      connection.onclose(() => setConnected(false));

      try {
        await connection.start();
        if (!cancelled) {
          connectionRef.current = connection;
          setConnected(true);
          setError(null);
        } else {
          await connection.stop();
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Activity stream connection failed");
          setConnected(false);
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      const conn = connectionRef.current;
      connectionRef.current = null;
      if (conn) void conn.stop();
    };
  }, [applySnapshot]);

  return { events, statuses, connected, error };
}
