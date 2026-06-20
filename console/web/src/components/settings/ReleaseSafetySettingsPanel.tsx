import { useState } from "react";
import { useReleaseSafety } from "../../context/ReleaseSafetyContext";

export function ReleaseSafetySettingsPanel() {
  const { prodWritesEnabled, lockMessage, setProdWritesEnabled } = useReleaseSafety();
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async (enabled: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      await setProdWritesEnabled(enabled);
      setConfirmEnable(false);
      setMessage(enabled ? "Legacy prod SSH deploy/fix enabled." : "Prod writes locked.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save release safety settings");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card settings-section">
      <h3>Release safety</h3>
      <p className="muted">
        While the release agent and migration path are being built, prod Home Assistant should only change after you
        review changes on staging and approve a release. Use <strong>Request release</strong> on Overview when prod
        writes are locked. Legacy kit buttons (deploy to prod, fix entity on prod, rollback) are{" "}
        <strong>blocked by default</strong>.
      </p>

      <div
        className={`release-safety-status ${prodWritesEnabled ? "release-safety-status--open" : "release-safety-status--locked"}`}
      >
        <span className="release-safety-status-label">
          {prodWritesEnabled ? "Prod writes enabled" : "Prod writes locked"}
        </span>
        {!prodWritesEnabled && lockMessage && <p className="release-safety-status-detail">{lockMessage}</p>}
      </div>

      {prodWritesEnabled ? (
        <div className="release-safety-actions">
          <button type="button" className="btn primary" disabled={busy} onClick={() => save(false)}>
            Lock prod writes again
          </button>
        </div>
      ) : (
        <div className="release-safety-actions">
          {!confirmEnable ? (
            <button
              type="button"
              className="btn danger btn-compact"
              disabled={busy}
              onClick={() => setConfirmEnable(true)}
            >
              Enable legacy prod SSH writes…
            </button>
          ) : (
            <div className="release-safety-confirm">
              <p>
                This allows <strong>Deploy to prod</strong>, <strong>Fix entity on prod</strong>, and{" "}
                <strong>Rollback prod</strong> via kit SSH. Prefer waiting for the release agent and migration
                manifests unless you need an emergency one-off.
              </p>
              <div className="btn-row">
                <button type="button" className="btn danger btn-compact" disabled={busy} onClick={() => save(true)}>
                  Yes, enable prod writes
                </button>
                <button
                  type="button"
                  className="btn secondary btn-compact"
                  disabled={busy}
                  onClick={() => setConfirmEnable(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {message && <p className="form-message ok">{message}</p>}
    </div>
  );
}
