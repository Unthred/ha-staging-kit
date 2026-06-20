import { useEffect, useRef, useState } from "react";
import { operationsApi, type PreflightProgressSnapshot } from "../api";

export type PreflightScanProgressView = PreflightProgressSnapshot & {
  /** Monotonic 0–1 fraction — never decreases until the scan ends. */
  displayFraction: number;
};

/** Poll backend scan phases while the entity deploy preflight is running. */
export function usePreflightScanProgress(busy: boolean) {
  const [progress, setProgress] = useState<PreflightScanProgressView | null>(null);
  const peakFractionRef = useRef(0);

  useEffect(() => {
    if (!busy) {
      setProgress(null);
      peakFractionRef.current = 0;
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const snapshot = await operationsApi.prodStoragePreflightProgress();
        if (cancelled || !snapshot.active) return;

        const total = Math.max(snapshot.totalSteps, 1);
        const rawFraction = snapshot.step > 0 ? snapshot.step / total : 0;
        peakFractionRef.current = Math.max(peakFractionRef.current, rawFraction);
        const displayFraction =
          snapshot.step >= total ? 1 : Math.max(peakFractionRef.current, rawFraction > 0 ? rawFraction : 0.04);

        setProgress({
          ...snapshot,
          displayFraction,
        });
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
