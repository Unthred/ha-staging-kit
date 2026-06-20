import { Link } from "react-router-dom";
import { ActionButton } from "../ActionButton";
import { operationsApi } from "../../api";

export function DashboardQuickActions({
  gitConfigured,
  mirrorConfigured,
  onDone,
}: {
  gitConfigured: boolean;
  mirrorConfigured: boolean;
  onDone: () => void;
}) {
  return (
    <section className="dash-panel dash-quick-actions">
      <header className="dash-panel-head">
        <div>
          <p className="dash-panel-eyebrow">Operations</p>
          <h3>Run now</h3>
        </div>
        <Link to="/operations" className="dash-chip-link">
          All operations
        </Link>
      </header>
      <div className="dash-quick-actions-row ops-actions">
        <ActionButton
          label="Person poll"
          toastPreset="person-poll"
          onRun={operationsApi.personPoll}
          onDone={onDone}
        />
        <ActionButton
          label="Storage sync"
          toastPreset="storage-sync"
          onRun={operationsApi.storageSync}
          onDone={onDone}
        />
        {mirrorConfigured && (
          <ActionButton
            label="Refresh mirror"
            toastPreset="refresh-mirror"
            onRun={operationsApi.deployMirror}
            onDone={onDone}
          />
        )}
        <ActionButton
          label="Restart staging HA"
          toastPreset="restart-staging"
          onRun={operationsApi.restartStaging}
          onDone={onDone}
        />
      </div>
      {!gitConfigured && (
        <p className="muted dash-quick-actions-note">
          Git repo not mounted — set Paths &amp; git in <Link to="/settings">Settings</Link>.
        </p>
      )}
    </section>
  );
}
