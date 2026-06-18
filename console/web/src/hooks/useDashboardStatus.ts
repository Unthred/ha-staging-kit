import { useCallback, useEffect, useRef, useState } from "react";
import { dashboardApi, toApiError, type ApiError, type DashboardStatus } from "../api";
import { setHaUrls } from "../lib/haUrlsStore";

const HEALTH_POLL_MS = 2000;
const HEALTH_MAX_WAIT_MS = 60000;
const DASHBOARD_POLL_MS = 30000;
const ERROR_BACKOFF_MS = 60000;

async function waitForKitHealth(maxMs = HEALTH_MAX_WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      await dashboardApi.ping();
      return true;
    } catch {
      await new Promise((r) => window.setTimeout(r, HEALTH_POLL_MS));
    }
  }
  return false;
}

export function useDashboardStatus(pollMs = DASHBOARD_POLL_MS) {
  const [data, setData] = useState<DashboardStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlightRef = useRef(false);
  const nextPollAtRef = useRef(0);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    try {
      const status = await dashboardApi.status();
      setHaUrls(status.stagingHaUrl ?? "", status.prodHaUrl ?? "");
      setData(status);
      setError(null);
      nextPollAtRef.current = Date.now() + pollMs;
    } catch (e) {
      const apiError = toApiError(e);
      setError(apiError);
      // Back off polling after failures (503 during startup, Docker slowness, etc.)
      nextPollAtRef.current = Date.now() + ERROR_BACKOFF_MS;
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }, [pollMs]);

  useEffect(() => {
    let cancelled = false;
    let intervalId = 0;

    const boot = async () => {
      await waitForKitHealth();
      if (cancelled) return;
      await refresh();
      if (cancelled) return;

      intervalId = window.setInterval(() => {
        if (Date.now() < nextPollAtRef.current) return;
        void refresh();
      }, pollMs);
    };

    void boot();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [refresh]);

  return { data, error, busy, refresh };
}
