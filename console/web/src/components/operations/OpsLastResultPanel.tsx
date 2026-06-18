import { useState } from "react";
import type { OperationResult } from "../../api";
import { Chip } from "../Chip";

export function OpsLastResultPanel({ result }: { result: OperationResult | null }) {
  const [open, setOpen] = useState(Boolean(result?.logTail));

  if (!result) return null;

  const tone = result.ok ? "pass" : "fail";

  return (
    <section className={`card ops-last-result ops-last-result--${tone}`} aria-live="polite">
      <header className="ops-last-result-head">
        <Chip status={tone} label={result.ok ? "Succeeded" : "Failed"} />
        <p className="ops-last-result-msg">{result.message || (result.ok ? "Operation completed" : "Operation failed")}</p>
        {result.logTail ? (
          <button type="button" className="btn ghost btn-compact" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide log" : "Show log"}
          </button>
        ) : null}
      </header>
      {open && result.logTail ? <pre className="ops-last-result-log">{result.logTail}</pre> : null}
    </section>
  );
}
