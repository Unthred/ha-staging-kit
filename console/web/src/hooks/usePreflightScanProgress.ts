import { useEffect, useState } from "react";
import { operationsApi, type PreflightProgressSnapshot } from "../api";

/** Poll backend scan phases while the entity deploy preflight is running. */
export function usePreflightScanProgress(busy: boolean) {
  const [progress, setProgress] = useState<PreflightProgressSnapshot | null>(null);

  useEffect(() => {
    if (!busy) {
      setProgress(null);
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const snapshot = await operationsApi.prodStoragePreflightProgress();
        if (!cancelled && snapshot.active) setProgress(snapshot);
      } catch {
        /* progress endpoint is best-effort */
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), 250);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [busy]);

  return progress;
}
