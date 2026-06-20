import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityEvent } from "../api";

const WINDOW_MS = 15 * 60 * 1000;
const BUCKET_MS = 5 * 60 * 1000;
const PULSE_MS = 3000;
const PARITY_FLASH_MS = 2000;

export type ActivityPulseBucket = {
  at: string;
  runs: number;
};

export type ActivityPulseLaneMetrics = {
  buckets: ActivityPulseBucket[];
  recentCount: number;
  lastEvent: ActivityEvent | null;
  isPulsing: boolean;
};

export type ActivityPulseMetrics = {
  prod: ActivityPulseLaneMetrics;
  staging: ActivityPulseLaneMetrics;
  parityFlash: boolean;
};

function isProd(event: ActivityEvent) {
  return event.instance.includes("Production");
}

function isStaging(event: ActivityEvent) {
  return event.instance.includes("Staging");
}

function buildBuckets(events: ActivityEvent[], match: (event: ActivityEvent) => boolean): ActivityPulseBucket[] {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const end = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const bucketKeys: number[] = [];
  for (let i = 2; i >= 0; i -= 1) {
    bucketKeys.push(end - i * BUCKET_MS);
  }

  const counts = new Map(bucketKeys.map((key) => [key, 0]));
  let recentCount = 0;

  for (const event of events) {
    if (!match(event)) continue;
    const atMs = new Date(event.at).getTime();
    if (atMs < windowStart) continue;
    recentCount += 1;
    const key = Math.floor(atMs / BUCKET_MS) * BUCKET_MS;
    if (counts.has(key)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return bucketKeys.map((key) => ({
    at: new Date(key).toISOString(),
    runs: counts.get(key) ?? 0,
  }));
}

function laneMetrics(events: ActivityEvent[], match: (event: ActivityEvent) => boolean, isPulsing: boolean): ActivityPulseLaneMetrics {
  return {
    buckets: buildBuckets(events, match),
    recentCount: events.filter((event) => {
      if (!match(event)) return false;
      return new Date(event.at).getTime() >= Date.now() - WINDOW_MS;
    }).length,
    lastEvent: events.find(match) ?? null,
    isPulsing,
  };
}

export function useActivityPulseMetrics(events: ActivityEvent[]): ActivityPulseMetrics {
  const [prodPulsing, setProdPulsing] = useState(false);
  const [stagingPulsing, setStagingPulsing] = useState(false);
  const [parityFlash, setParityFlash] = useState(false);
  const initialRef = useRef(true);
  const lastHeadIdRef = useRef<string | null>(null);
  const prodPulseTimer = useRef<number | null>(null);
  const stagingPulseTimer = useRef<number | null>(null);
  const parityTimer = useRef<number | null>(null);

  useEffect(() => {
    if (events.length === 0) return;

    const newest = events[0];
    if (initialRef.current) {
      initialRef.current = false;
      lastHeadIdRef.current = newest.id;
      return;
    }

    if (newest.id === lastHeadIdRef.current) return;
    lastHeadIdRef.current = newest.id;

    if (isProd(newest)) {
      setProdPulsing(true);
      if (prodPulseTimer.current) window.clearTimeout(prodPulseTimer.current);
      prodPulseTimer.current = window.setTimeout(() => setProdPulsing(false), PULSE_MS);
    }

    if (isStaging(newest)) {
      setStagingPulsing(true);
      if (stagingPulseTimer.current) window.clearTimeout(stagingPulseTimer.current);
      stagingPulseTimer.current = window.setTimeout(() => setStagingPulsing(false), PULSE_MS);
    }

    if (newest.parityMatch) {
      setParityFlash(true);
      if (parityTimer.current) window.clearTimeout(parityTimer.current);
      parityTimer.current = window.setTimeout(() => setParityFlash(false), PARITY_FLASH_MS);
    }
  }, [events]);

  useEffect(
    () => () => {
      if (prodPulseTimer.current) window.clearTimeout(prodPulseTimer.current);
      if (stagingPulseTimer.current) window.clearTimeout(stagingPulseTimer.current);
      if (parityTimer.current) window.clearTimeout(parityTimer.current);
    },
    [],
  );

  return useMemo(
    () => ({
      prod: laneMetrics(events, isProd, prodPulsing),
      staging: laneMetrics(events, isStaging, stagingPulsing),
      parityFlash,
    }),
    [events, prodPulsing, stagingPulsing, parityFlash],
  );
}
