import { useEffect, useRef, useState } from "react";
import { operationsApi, type PreflightProgressSnapshot } from "../api";

export type PreflightScanProgressView = PreflightProgressSnapshot & {
  /** Monotonic 0–1 fraction shown in the UI — ramps from 0, never jumps on first poll. */
  displayFraction: number;
};

const INITIAL_FRACTION = 0.04;
const RAMP_PER_TICK = 0.07;

function placeholderProgress(label = "Starting Entity Janitor scan…"): PreflightScanProgressView {
  return {
    active: true,
    step: 0,
    totalSteps: 1,
    label,
    startedAt: new Date().toISOString(),
    displayFraction: INITIAL_FRACTION,
  };
}

/** Poll backend scan phases while the entity deploy preflight is running. */
export function usePreflightScanProgress(busy: boolean) {
  const [progress, setProgress] = useState<PreflightScanProgressView | null>(null);
  const displayFractionRef = useRef(0);
  const sessionStartedAtRef = useRef<string | null>(null);

  useEffect(() => {
    if (!busy) {
      setProgress(null);
      displayFractionRef.current = 0;
      sessionStartedAtRef.current = null;
      return;
    }

    displayFractionRef.current = INITIAL_FRACTION;
    sessionStartedAtRef.current = null;
    setProgress(placeholderProgress());

    let cancelled = false;
    const poll = async () => {
      try {
        const snapshot = await operationsApi.prodStoragePreflightProgress();
        if (cancelled || !snapshot.active) return;

        if (sessionStartedAtRef.current !== snapshot.startedAt) {
          sessionStartedAtRef.current = snapshot.startedAt;
          displayFractionRef.current = INITIAL_FRACTION;
        }

        const total = Math.max(snapshot.totalSteps, 1);
        const targetFraction =
          snapshot.step >= total ? 1 : snapshot.step > 0 ? snapshot.step / total : INITIAL_FRACTION;

        displayFractionRef.current = Math.min(
          targetFraction,
          Math.max(displayFractionRef.current + RAMP_PER_TICK, INITIAL_FRACTION),
        );

        setProgress({
          ...snapshot,
          displayFraction: displayFractionRef.current,
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
