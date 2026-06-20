import { useMemo } from "react";
import type { ActivityEvent } from "../api";

const PARITY_WINDOW_MS = 60_000;
const HISTORY_MS = 15 * 60 * 1000;
const MAX_PAIRS = 8;

export type ActivityParityPair = {
  key: string;
  name: string;
  entityId: string;
  domain: string;
  reason: string;
  prod: ActivityEvent;
  staging: ActivityEvent;
  deltaMs: number;
  latestAt: string;
};

export type ActivityParitySummary = {
  pairs: ActivityParityPair[];
  matchedCount: number;
  prodOnlyCount: number;
  stagingOnlyCount: number;
  prodRecentCount: number;
  stagingRecentCount: number;
};

function isProd(event: ActivityEvent) {
  return event.instance.includes("Production");
}

function isStaging(event: ActivityEvent) {
  return event.instance.includes("Staging");
}

function inWindow(event: ActivityEvent) {
  return Date.now() - new Date(event.at).getTime() <= HISTORY_MS;
}

function sameLogicalEntity(a: ActivityEvent, b: ActivityEvent) {
  if (a.entityId.toLowerCase() === b.entityId.toLowerCase()) return true;
  return a.name === b.name && a.domain === b.domain;
}

function reasonText(event: ActivityEvent) {
  if (event.message && event.message !== event.name) return event.message;
  return event.domain === "notify" ? "Mobile notification sent" : "Run detected";
}

function formatClock(at: string) {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDelta(deltaMs: number) {
  if (deltaMs < 1000) return "<1s apart";
  if (deltaMs < 60_000) return `${Math.round(deltaMs / 1000)}s apart`;
  return `${Math.round(deltaMs / 60_000)}m apart`;
}

export function buildActivityParitySummary(events: ActivityEvent[]): ActivityParitySummary {
  const prod = events.filter((event) => isProd(event) && inWindow(event));
  const staging = events.filter((event) => isStaging(event) && inWindow(event));
  const usedStaging = new Set<string>();
  const pairs: ActivityParityPair[] = [];

  for (const prodEvent of prod) {
    let best: ActivityEvent | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;

    for (const stagingEvent of staging) {
      if (usedStaging.has(stagingEvent.id)) continue;
      if (!sameLogicalEntity(prodEvent, stagingEvent)) continue;
      const deltaMs = Math.abs(new Date(prodEvent.at).getTime() - new Date(stagingEvent.at).getTime());
      if (deltaMs <= PARITY_WINDOW_MS && deltaMs < bestDelta) {
        best = stagingEvent;
        bestDelta = deltaMs;
      }
    }

    if (!best) continue;

    usedStaging.add(best.id);
    const latestAt = new Date(prodEvent.at) > new Date(best.at) ? prodEvent.at : best.at;
    pairs.push({
      key: `${prodEvent.entityId}:${best.entityId}:${latestAt}`,
      name: prodEvent.name,
      entityId: prodEvent.entityId,
      domain: prodEvent.domain,
      reason: reasonText(prodEvent),
      prod: prodEvent,
      staging: best,
      deltaMs: bestDelta,
      latestAt,
    });
  }

  pairs.sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());

  const matchedProdIds = new Set(pairs.map((pair) => pair.prod.id));
  const matchedStagingIds = new Set(pairs.map((pair) => pair.staging.id));

  return {
    pairs: pairs.slice(0, MAX_PAIRS),
    matchedCount: pairs.length,
    prodOnlyCount: prod.filter((event) => !matchedProdIds.has(event.id)).length,
    stagingOnlyCount: staging.filter((event) => !matchedStagingIds.has(event.id)).length,
    prodRecentCount: prod.length,
    stagingRecentCount: staging.length,
  };
}

export function useActivityParitySummary(events: ActivityEvent[]) {
  return useMemo(() => buildActivityParitySummary(events), [events]);
}

export function formatPairClock(at: string) {
  return formatClock(at);
}
