import { useCallback, useEffect, useState } from "react";
import { dashboardApi, operationsApi, toApiError, type DashboardStatus } from "../api";
import { Chip } from "./Chip";
import { isMirrorControlMode, mirrorModeChipStatus, mirrorModeLabel } from "../lib/mirrorMode";

export function MirrorControlModeToggle() {
  const [mirror, setMirror] = useState<DashboardStatus["mirror"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await dashboardApi.status();
      setMirror(data.mirror ?? null);
      setError(null);
    } catch (e) {
      setError(toApiError(e).detail);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const controlOn = isMirrorControlMode(mirror?.mode);
  const configured = mirror?.configured ?? false;
  const disabled = !configured || busy || loading;

  const applyMode = async (enableControl: boolean) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await operationsApi.setMirrorMode(enableControl);
      setMessage(result.message);
      if (result.logTail) setMessage(`${result.message}\n${result.logTail}`);
      if (!result.ok) setError(result.message);
      setConfirmEnable(false);
      await refresh();
    } catch (e) {
      setError(toApiError(e).detail);
    } finally {
      setBusy(false);
    }
  };

  const onToggleChange = (nextChecked: boolean) => {
    if (disabled) return;
    if (nextChecked) {
      setConfirmEnable(true);
      return;
    }
    void applyMode(false);
  };

  if (loading && !mirror) {
    return <p className="muted">Loading mirror status…</p>;
  }

  if (!configured) {
    return (
      <div className="mirror-mode-panel mirror-mode-unconfigured">
        <p className="muted">Mirror is not configured yet. Deploy the mirror first, then control mode can be toggled here.</p>
      </div>
    );
  }

  return (
    <div className={`mirror-mode-panel ${controlOn ? "mirror-mode-control" : "mirror-mode-readonly"}`}>
      <div className="mirror-mode-head">
        <div>
          <h3 className="mirror-mode-title">Control mode</h3>
          <p className="muted mirror-mode-summary">
            {controlOn
              ? "Staging can publish zigbee2mqtt/+/set to production — real devices may actuate."
              : "Read-only bridge — production MQTT flows to staging only (safe default)."}
          </p>
        </div>
        <Chip status={mirrorModeChipStatus(mirror?.mode)} label={mirrorModeLabel(mirror?.mode)} />
      </div>

      <div className="mirror-mode-row">
        <label className={`toggle ${disabled ? "toggle-disabled" : ""}`} htmlFor="mirror-control-mode">
          <span className="toggle-label">Control mode</span>
          <input
            id="mirror-control-mode"
            type="checkbox"
            role="switch"
            checked={controlOn}
            disabled={disabled}
            onChange={(e) => onToggleChange(e.target.checked)}
          />
          <span className="toggle-track" aria-hidden="true">
            <span className="toggle-thumb" />
          </span>
          <span className="toggle-state">{controlOn ? "On" : "Off"}</span>
        </label>
        {!mirror?.running && (
          <p className="muted warn mirror-mode-warn">Mosquitto is not running — mode is saved but the bridge may not be active until the mirror starts.</p>
        )}
      </div>

      {confirmEnable && (
        <div className="confirm-box">
          <p className="msg err">
            Turning on control mode allows staging automations to publish commands to production Zigbee2MQTT devices.
            Only enable while actively testing.
          </p>
          <div className="step-actions-right ops-actions">
            <button type="button" className="btn danger" disabled={busy} onClick={() => void applyMode(true)}>
              {busy ? "Applying…" : "Yes, turn on control mode"}
            </button>
            <button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirmEnable(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && !error && <pre className="log">{message}</pre>}
      {error && <p className="msg err">{error}</p>}
    </div>
  );
}
