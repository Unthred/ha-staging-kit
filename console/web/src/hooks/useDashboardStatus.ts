import { useCallback, useEffect, useState } from "react";
import { dashboardApi, toApiError, type ApiError, type DashboardStatus } from "../api";

export function useDashboardStatus(pollMs = 30000) {
  const [data, setData] = useState<DashboardStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setData(await dashboardApi.status());
      setError(null);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, refresh]);

  return { data, error, busy, refresh };
}
