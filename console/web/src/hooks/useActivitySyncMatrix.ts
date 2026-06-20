import { useMemo } from "react";
import type { ActivityEvent } from "../api";
import { formatDelta, buildActivityParitySummary } from "./useActivityParityPairs";

const HISTORY_MS = 15 * 60 * 1000;
const MAX_ROWS = 10;
const MAX_PROD_ONLY = 4;

export type ActivitySyncRow = {
  key: string;
  label: string;
  entityId: string;
  prodAt: string | null;
  stagingAt: string | null;
  synced: boolean;
  deltaMs: number | null;
  reason: string | null;
};

function isProd(event: ActivityEvent) {
  return event.instance.includes("Production");
}

function isStaging(event: ActivityEvent) {
  return event.instance.includes("Staging");
}

function inWindow(at: string) {
  return Date.now() - new Date(at).getTime() <= HISTORY_MS;
}

function rowKey(event: ActivityEvent) {
  return event.entityId.toLowerCase();
}

function reasonText(event: ActivityEvent | null) {
  if (!event) return null;
  if (event.message && event.message !== event.name) return event.message;
  return event.domain === "notify" ? "Notification sent" : "Triggered";
}

export function buildActivitySyncRows(events: ActivityEvent[]): ActivitySyncRow[] {
  const summary = buildActivityParitySummary(events);
  const rows: ActivitySyncRow[] = [];
  const usedKeys = new Set<string>();

  for (const pair of summary.pairs) {
    const key = rowKey(pair.prod);
    usedKeys.add(key);
    rows.push({
      key,
      label: pair.name,
      entityId: pair.entityId,
      prodAt: pair.prod.at,
      stagingAt: pair.staging.at,
      synced: true,
      deltaMs: pair.deltaMs,
      reason: pair.reason,
    });
  }

  const prodOnly = events
    .filter((event) => isProd(event) && inWindow(event.at))
    .filter((event) => !summary.pairs.some((pair) => pair.prod.id === event.id))
    .slice(0, MAX_PROD_ONLY);

  for (const event of prodOnly) {
    const key = rowKey(event);
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    rows.push({
      key,
      label: event.name,
      entityId: event.entityId,
      prodAt: event.at,
      stagingAt: null,
      synced: false,
      deltaMs: null,
      reason: reasonText(event),
    });
  }

  const stagingOnly = events.filter(
    (event) => isStaging(event) && inWindow(event.at) && !summary.pairs.some((pair) => pair.staging.id === event.id),
  );

  for (const event of stagingOnly) {
    const key = rowKey(event);
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    rows.push({
      key,
      label: event.name,
      entityId: event.entityId,
      prodAt: null,
      stagingAt: event.at,
      synced: false,
      deltaMs: null,
      reason: reasonText(event),
    });
  }

  return rows.slice(0, MAX_ROWS);
}

export function useActivitySyncRows(events: ActivityEvent[]) {
  return useMemo(() => buildActivitySyncRows(events), [events]);
}

export function formatSyncClock(at: string | null) {
  if (!at) return "—";
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export { formatDelta };
