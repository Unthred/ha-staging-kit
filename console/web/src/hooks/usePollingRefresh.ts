import { useCallback, useEffect, useRef } from "react";

/**
 * Polls on an interval but skips overlapping requests so slow endpoints
 * cannot stack and starve the server thread pool.
 */
export function usePollingRefresh(fetchFn: () => Promise<void>, pollMs: number) {
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await fetchFn();
    } finally {
      inFlightRef.current = false;
    }
  }, [fetchFn]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, refresh]);

  return refresh;
}
