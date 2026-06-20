import { useEffect, useState } from "react";
import type { PreflightScanProgressView } from "../../hooks/usePreflightScanProgress";

function elapsedSeconds(startedAt: string): number {
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((Date.now() - started) / 1000));
}

export function DeployLovelaceGateScanProgress({
  progress,
  fallbackLabel = "Running Entity Janitor scan…",
  overlay = false,
}: {
  progress: PreflightScanProgressView | null;
  fallbackLabel?: string;
  /** When true, renders as an in-workspace overlay instead of a block above the list. */
  overlay?: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  const startedAt = progress?.startedAt;

  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }
    setElapsed(elapsedSeconds(startedAt));
    const id = window.setInterval(() => setElapsed(elapsedSeconds(startedAt)), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const step = progress?.step ?? 0;
  const total = progress?.totalSteps ?? 1;
  const label = progress?.label?.trim() || fallbackLabel;
  const fraction = progress?.displayFraction ?? (progress?.active ? 0.04 : 0);
  const width = Math.max(4, Math.min(100, fraction * 100));
  const showIndeterminate = step === 0 && fraction <= 0.04;

  return (
    <div
      className={`deploy-lovelace-gate-scan-progress${overlay ? " deploy-lovelace-gate-scan-progress--overlay" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="progress-bar deploy-lovelace-gate-scan-bar">
        <div
          className={`progress-fill ${showIndeterminate ? "progress-fill-indeterminate" : "progress-fill-active"}`}
          style={showIndeterminate ? undefined : { width: `${width}%` }}
        />
      </div>
      <span className="progress-label">
        {label}
        {elapsed > 0 ? ` · ${elapsed}s` : ""}
        {step > 0 ? ` · step ${Math.min(step, total)} of ${total}` : ""}
      </span>
    </div>
  );
}
