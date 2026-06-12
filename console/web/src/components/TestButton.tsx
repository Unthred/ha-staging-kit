import { useState } from "react";
import type { TestResult } from "../api";

export function TestButton({ label, onTest }: { label: string; onTest: () => Promise<TestResult> }) {
  const [result, setResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="test-row">
      <button
        type="button"
        className="btn secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setResult(await onTest());
          } catch (e) {
            setResult({ ok: false, message: e instanceof Error ? e.message : "Test failed" });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Testing…" : label}
      </button>
      {result && <p className={result.ok ? "msg ok" : "msg err"}>{result.message}</p>}
    </div>
  );
}
