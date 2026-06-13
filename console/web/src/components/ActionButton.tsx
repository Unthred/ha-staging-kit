import { useState } from "react";
import type { DeployResult, OperationResult } from "../api";
import { actionToast } from "../lib/toastMessages";
import { useToast } from "./Toast";

type Result = DeployResult | OperationResult;

export function ActionButton({
  label,
  onRun,
  onDone,
  variant = "primary",
  disabled = false,
  toastPreset,
}: {
  label: string;
  onRun: () => Promise<Result>;
  onDone?: () => void;
  variant?: "primary" | "danger" | "secondary";
  disabled?: boolean;
  /** Friendly toast copy — e.g. storage-sync, deploy-mirror, refresh-mirror */
  toastPreset?: string;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className={`btn ${variant}`}
      disabled={busy || disabled}
      title={disabled ? "Not available — check configuration in Settings" : undefined}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await onRun();
          const fallback = r.message || (r.ok ? "Done" : "Action failed");
          if (toastPreset) {
            const t = actionToast(toastPreset, r.ok, fallback);
            push({ message: t.message, tone: t.tone, icon: t.icon });
          } else {
            push({ message: fallback, tone: r.ok ? "ok" : "err" });
          }
          if (r.ok) onDone?.();
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Action failed";
          if (toastPreset) {
            const t = actionToast(toastPreset, false, msg);
            push({ message: t.message, tone: "err", icon: t.icon });
          } else {
            push({ message: msg, tone: "err" });
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Running…" : label}
    </button>
  );
}
