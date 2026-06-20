import { useCallback, useEffect, useId, useState } from "react";
import { dashboardApi, operationsApi, toApiError, type DashboardStatus } from "../api";
import { Chip } from "./Chip";
import { isMirrorControlMode, mirrorModeChipStatus, mirrorModeLabel } from "../lib/mirrorMode";

export function MirrorControlModeToggle({
  compact = false,
  inline = false,
  layout = "panel",
  mirror: mirrorProp,
  statusLoading = false,
  onChanged,
}: {
  compact?: boolean;
  inline?: boolean;
  /** panel = full card; row = compact single-line row (Operations); inline = Environment stat */
  layout?: "panel" | "row" | "inline";
  mirror?: DashboardStatus["mirror"] | null;
  /** Parent is still loading mirror status — keeps row height stable */
  statusLoading?: boolean;
  onChanged?: () => void;
}) {
  const toggleId = useId();
  const usesExternalMirror = mirrorProp !== undefined;
  const [mirror, setMirror] = useState<DashboardStatus["mirror"] | null>(mirrorProp ?? null);
  const [loading, setLoading] = useState(!usesExternalMirror);
  const [busy, setBusy] = useState(false);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolvedLayout = inline ? "inline" : layout;

  useEffect(() => {
    if (usesExternalMirror) {
      setMirror(mirrorProp ?? null);
      setLoading(false);
    }
  }, [mirrorProp, usesExternalMirror]);

  const refresh = useCallback(async () => {
    if (usesExternalMirror) return;
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
  }, [usesExternalMirror]);

  useEffect(() => {
    if (usesExternalMirror) return;
    void refresh();
  }, [refresh, usesExternalMirror]);

  const showLoading = statusLoading || (loading && !mirror);
  const controlOn = isMirrorControlMode(mirror?.mode);
  const configured = mirror?.configured ?? false;
  const disabled = !configured || busy || showLoading;

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
      if (usesExternalMirror) {
        setMirror((prev) => (prev ? { ...prev, mode: enableControl ? "control" : "read-only" } : prev));
      } else {
        await refresh();
      }
      if (result.ok) onChanged?.();
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

  const confirmBox = confirmEnable ? (
    <div className="confirm-box mirror-mode-confirm">
      <p className="msg err">
        Turning on control mode allows staging automations to publish commands to production Zigbee2MQTT devices.
        Only enable while actively testing.
      </p>
      <div className="step-actions-right ops-actions">
        <button type="button" className="btn danger btn-compact" disabled={busy} onClick={() => void applyMode(true)}>
          {busy ? "Applying…" : "Yes, turn on control mode"}
        </button>
        <button type="button" className="btn secondary btn-compact" disabled={busy} onClick={() => setConfirmEnable(false)}>
          Cancel
        </button>
      </div>
    </div>
  ) : null;

  const toggle = (
    <label className={`toggle ${disabled ? "toggle-disabled" : ""}`} htmlFor={toggleId}>
      <span className="toggle-label">Control mode</span>
      <input
        id={toggleId}
        type="checkbox"
        role="switch"
        checked={controlOn}
        disabled={disabled}
        onChange={(e) => onToggleChange(e.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-state">{showLoading ? "…" : controlOn ? "On" : "Off"}</span>
    </label>
  );

  if (resolvedLayout === "inline") {
    return (
      <div
        className={`dash-env-stat dash-env-mirror-control ${controlOn ? "dash-env-mirror-control-on" : ""}${showLoading ? " dash-env-mirror-control-loading" : ""}`}
      >
        <span className="dash-stat-label">Control mode</span>
        {showLoading ? (
          <span className="dash-stat-value muted">…</span>
        ) : !configured ? (
          <span className="dash-stat-value muted">Not configured</span>
        ) : (
          <div className="dash-env-mirror-control-body">
            {toggle}
            <Chip status={mirrorModeChipStatus(mirror?.mode)} label={mirrorModeLabel(mirror?.mode)} />
          </div>
        )}
        {!mirror?.running && configured && !showLoading && (
          <p className="muted mirror-mode-warn dash-env-mirror-control-warn">Bridge not running</p>
        )}
        {confirmBox}
        {error && <p className="msg err mirror-mode-inline-err">{error}</p>}
      </div>
    );
  }

  if (resolvedLayout === "row") {
    return (
      <div
        className={`mirror-mode-row-ops${controlOn ? " mirror-mode-row-ops--control" : ""}${showLoading ? " mirror-mode-row-ops--loading" : ""}`}
        aria-busy={showLoading}
      >
        <div className="mirror-mode-row-ops-main">
          {showLoading ? (
            <span className="mirror-mode-row-ops-placeholder toggle toggle-disabled" aria-hidden="true">
              <span className="toggle-label">Control mode</span>
              <span className="toggle-track">
                <span className="toggle-thumb" />
              </span>
              <span className="toggle-state">…</span>
            </span>
          ) : !configured ? (
            <p className="muted mirror-mode-row-ops-unconfigured">
              Mirror not configured — deploy the mirror first, then control mode can be toggled here.
            </p>
          ) : (
            <>
              {toggle}
              <Chip status={mirrorModeChipStatus(mirror?.mode)} label={mirrorModeLabel(mirror?.mode)} />
              {!mirror?.running && (
                <span className="muted warn mirror-mode-row-ops-warn">Bridge not running</span>
              )}
            </>
          )}
        </div>
        {confirmBox}
        {message && !error && !confirmEnable && <p className="muted mirror-mode-row-ops-msg">{message}</p>}
        {error && <p className="msg err mirror-mode-row-ops-err">{error}</p>}
      </div>
    );
  }

  if (showLoading && !mirror) {
    return (
      <div className={`mirror-mode-panel mirror-mode-skeleton${compact ? " mirror-mode-panel-compact" : ""}`}>
        <p className="muted">Loading mirror status…</p>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="mirror-mode-panel mirror-mode-unconfigured">
        <p className="muted">Mirror is not configured yet. Deploy the mirror first, then control mode can be toggled here.</p>
      </div>
    );
  }

  return (
    <div
      className={`mirror-mode-panel ${controlOn ? "mirror-mode-control" : "mirror-mode-readonly"}${compact ? " mirror-mode-panel-compact" : ""}`}
    >
      <div className="mirror-mode-head">
        <div>
          {!compact && <h3 className="mirror-mode-title">Control mode</h3>}
          <p className="muted mirror-mode-summary">
            {controlOn
              ? "Staging can publish zigbee2mqtt/+/set to production — real devices may actuate."
              : "Read-only bridge — production MQTT flows to staging only (safe default)."}
          </p>
        </div>
        <Chip status={mirrorModeChipStatus(mirror?.mode)} label={mirrorModeLabel(mirror?.mode)} />
      </div>

      <div className="mirror-mode-row">
        {toggle}
        {!mirror?.running && (
          <p className="muted warn mirror-mode-warn">Mosquitto is not running — mode is saved but the bridge may not be active until the mirror starts.</p>
        )}
      </div>

      {confirmBox}
      {message && !error && <pre className="log">{message}</pre>}
      {error && <p className="msg err">{error}</p>}
    </div>
  );
}
