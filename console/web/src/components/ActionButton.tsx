import { useState } from "react";
import type { DeployResult, OperationResult } from "../api";

type Result = DeployResult | OperationResult;

export function ActionButton({
  label,
  onRun,
  onDone,
  variant = "primary",
}: {
  label: string;
  onRun: () => Promise<Result>;
  onDone?: () => void;
  variant?: "primary" | "danger" | "secondary";
}) {
  const [log, setLog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="action-block">
      <button
        type="button"
        className={`btn ${variant}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setLog(null);
          try {
            const r = await onRun();
            setLog(r.logTail ?? r.message);
            if (r.ok) onDone?.();
          } catch (e) {
            setLog(e instanceof Error ? e.message : "Action failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Running…" : label}
      </button>
      {log && <pre className="log">{log}</pre>}
    </div>
  );
}
