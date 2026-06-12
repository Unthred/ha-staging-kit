import { useState } from "react";
import { operationsApi } from "../api";
import { ActionButton } from "../components/ActionButton";

export default function OperationsPage() {
  const [confirmControl, setConfirmControl] = useState(false);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Operations</h2>
          <p className="muted">Run sidecar tasks and manage MQTT mirror mode.</p>
        </div>
      </div>

      <div className="card-grid ops-grid">
        <section className="card section-card">
          <h3>Config & sync</h3>
          <p className="muted">Low risk — applies git staging branch and syncs person states.</p>
          <ActionButton label="Apply staging config" onRun={operationsApi.applyConfig} />
          <ActionButton label="Person poll now" onRun={operationsApi.personPoll} variant="secondary" />
        </section>

        <section className="card section-card">
          <h3>Storage sync</h3>
          <p className="muted warn">
            Medium risk — overwrites staging registry subset and copies prod <code>.storage</code> via SSH.
          </p>
          <ActionButton label="Run storage sync" onRun={operationsApi.storageSync} variant="secondary" />
        </section>

        <section className="card section-card">
          <h3>MQTT mirror</h3>
          <p className="muted">Deploy or switch mirror mode. Control mode can actuate real prod devices.</p>
          <ActionButton label="Deploy / refresh mirror" onRun={operationsApi.deployMirror} variant="secondary" />
          <ActionButton label="Set read-only (safe)" onRun={operationsApi.mirrorReadOnly} variant="secondary" />
          {!confirmControl ? (
            <button type="button" className="btn danger" onClick={() => setConfirmControl(true)}>
              Enable control mode…
            </button>
          ) : (
            <div className="confirm-box">
              <p className="msg err">
                Control mode allows staging automations to publish commands to prod Zigbee2MQTT devices.
              </p>
              <ActionButton
                label="Yes, enable control mode"
                onRun={operationsApi.mirrorControl}
                variant="danger"
                onDone={() => setConfirmControl(false)}
              />
              <button type="button" className="btn ghost" onClick={() => setConfirmControl(false)}>
                Cancel
              </button>
            </div>
          )}
        </section>

        <section className="card section-card">
          <h3>Staging HA</h3>
          <p className="muted">Requires <code>STAGING_HA_CONTAINER</code> in Settings → Advanced.</p>
          <ActionButton label="Restart staging HA" onRun={operationsApi.restartStaging} variant="secondary" />
        </section>
      </div>
    </div>
  );
}
