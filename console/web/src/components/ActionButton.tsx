import { useState } from "react";
import type { DeployResult, OperationResult } from "../api";
import { actionToast, operationErrorDetail } from "../lib/toastMessages";
import { useToast } from "./Toast";

type Result = DeployResult | OperationResult;

export function ActionButton({
  label,
  onRun,
  onDone,
  onFailure,
  variant = "primary",
  disabled = false,
  compact = false,
  toastPreset,
  title,
  attentionOrder,
}: {
  label: string;
  onRun: () => Promise<Result>;
  onDone?: (result: Result) => void;
  /** Called when the operation returns ok: false or throws */
  onFailure?: (result: Result) => void;
  variant?: "primary" | "danger" | "secondary";
  disabled?: boolean;
  compact?: boolean;
  toastPreset?: string;
  title?: string;
  attentionOrder?: number;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className={`btn ${variant}${compact ? " btn-compact" : ""}`}
      disabled={busy || disabled}
      title={title ?? (disabled ? "Not available — check configuration in Settings" : undefined)}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await onRun();
          const fallback = r.message || (r.ok ? "Done" : "Action failed");
          if (toastPreset) {
            const t = actionToast(toastPreset, r.ok, fallback);
            let message = t.message;
            if (r.ok && r.message?.trim()) {
              message = r.message;
            } else if (!r.ok) {
              const detail = operationErrorDetail(r);
              if (detail) {
                const head = t.message.split(" — ")[0]?.trim() || t.message;
                message = `${head} — ${detail}`;
              }
            }
            push({ message, tone: t.tone, icon: t.icon });
          } else {
            push({ message: fallback, tone: r.ok ? "ok" : "err" });
          }
          if (r.ok) {
            onDone?.(r);
          } else {
            onFailure?.(r);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Action failed";
          const failed: OperationResult = { ok: false, message: msg, logTail: null };
          if (toastPreset) {
            const t = actionToast(toastPreset, false, msg);
            push({ message: t.message, tone: "err", icon: t.icon });
          } else {
            push({ message: msg, tone: "err" });
          }
          onFailure?.(failed);
        } finally {
          setBusy(false);
        }
      }}
    >
      {attentionOrder != null && attentionOrder > 0 ? (
        <span className="btn-attention-order">
          <span className="section-attention-badge section-attention-badge--order">{attentionOrder}</span>
          <span>{busy ? "Running…" : label}</span>
        </span>
      ) : (
        (busy ? "Running…" : label)
      )}
    </button>
  );
}
