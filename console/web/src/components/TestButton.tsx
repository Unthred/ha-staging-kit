import { useState } from "react";
import type { TestResult } from "../api";
import { toApiError } from "../api";
import { testToast } from "../lib/toastMessages";
import { useToast } from "./Toast";

export function TestButton({ label, onTest }: { label: string; onTest: () => Promise<TestResult> }) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="btn secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await onTest();
          const t = testToast(result.ok, result.message);
          push({ message: t.message, tone: t.tone, icon: t.icon });
        } catch (e) {
          const err = toApiError(e);
          push({
            message: err.hint ? `${err.detail} ${err.hint}` : err.detail,
            tone: "err",
            icon: "🔌🍌",
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Testing…" : label}
    </button>
  );
}
