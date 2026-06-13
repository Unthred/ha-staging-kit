import { useState } from "react";
import type { DashboardStatus } from "../../api";
import { operationsApi, toApiError } from "../../api";
import { isMirrorControlMode } from "../../lib/mirrorMode";

export function DashboardMirrorControl({
  mirror,
  onChanged,
}: {
  mirror: NonNullable<DashboardStatus["mirror"]>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controlOn = isMirrorControlMode(mirror.mode);

  const apply = async (enable: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await operationsApi.setMirrorMode(enable);
      if (!r.ok) setError(r.message);
      else {
        setConfirm(false);
        onChanged();
      }
    } catch (e) {
      setError(toApiError(e).detail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`dash-panel dash-mirror-control ${controlOn ? "active" : ""}`}>
      <header className="dash-panel-head">
        <div>
          <p className="dash-panel-eyebrow">MQTT mirror</p>
          <h3>{controlOn ? "Control mode" : "Read-only"}</h3>
        </div>
      </header>
      <label className={`toggle ${busy ? "toggle-disabled" : ""}`} htmlFor="dash-mirror-control">
        <span className="toggle-label">Control mode</span>
        <input
          id="dash-mirror-control"
          type="checkbox"
          role="switch"
          checked={controlOn}
          disabled={busy}
          onChange={(e) => {
            if (e.target.checked) setConfirm(true);
            else void apply(false);
          }}
        />
        <span className="toggle-track" aria-hidden="true">
          <span className="toggle-thumb" />
        </span>
        <span className="toggle-state">{controlOn ? "On" : "Off"}</span>
      </label>
      {confirm && (
        <div className="confirm-box">
          <p className="msg err">Enable control mode only while actively testing — staging can actuate prod devices.</p>
          <div className="step-actions-right ops-actions">
            <button type="button" className="btn danger" disabled={busy} onClick={() => void apply(true)}>
              {busy ? "Applying…" : "Turn on"}
            </button>
            <button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="msg err">{error}</p>}
    </section>
  );
}
