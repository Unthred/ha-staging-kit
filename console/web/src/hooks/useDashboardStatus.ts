import { useCallback, useEffect, useRef, useState } from "react";
import { dashboardApi, toApiError, type ApiError, type DashboardStatus } from "../api";
import { setHaUrls } from "../lib/haUrlsStore";

const DASHBOARD_POLL_MS = 30000;
const ERROR_BACKOFF_MS = 60000;

export function useDashboardStatus(pollMs = DASHBOARD_POLL_MS) {
  const [data, setData] = useState<DashboardStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const requestGenRef = useRef(0);
  const nextPollAtRef = useRef(0);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) {
      pendingRefreshRef.current = true;
      return;
    }

    inFlightRef.current = true;
    setBusy(true);
    const requestGen = ++requestGenRef.current;

    try {
      const status = await dashboardApi.status();
      if (requestGen !== requestGenRef.current) return;

      setHaUrls(status.stagingHaUrl ?? "", status.prodHaUrl ?? "");
      setData(status);
      setError(null);
      nextPollAtRef.current = Date.now() + pollMs;
    } catch (e) {
      if (requestGen !== requestGenRef.current) return;

      const apiError = toApiError(e);
      setError(apiError);
      // Back off polling after failures (503 during startup, Docker slowness, etc.)
      nextPollAtRef.current = Date.now() + ERROR_BACKOFF_MS;
    } finally {
      if (requestGen === requestGenRef.current) {
        inFlightRef.current = false;
        setBusy(false);
      }

      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        void refresh();
      }
    }
  }, [pollMs]);

  useEffect(() => {
    void refresh();

    const intervalId = window.setInterval(() => {
      if (Date.now() < nextPollAtRef.current) return;
      void refresh();
    }, pollMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [pollMs, refresh]);

  return { data, error, busy, refresh };
}
