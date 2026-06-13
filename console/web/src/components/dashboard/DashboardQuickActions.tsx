import { Link } from "react-router-dom";
import { ActionButton } from "../ActionButton";
import { operationsApi } from "../../api";

export function DashboardQuickActions({
  gitConfigured,
  onDone,
}: {
  gitConfigured: boolean;
  onDone: () => void;
}) {
  return (
    <section className="dash-panel dash-quick-actions">
      <header className="dash-panel-head">
        <div>
          <p className="dash-panel-eyebrow">Actions</p>
          <h3>Run now</h3>
        </div>
      </header>
      <div className="dash-quick-actions-row">
        <ActionButton
          label="Apply staging config"
          onRun={async () => {
            const r = await operationsApi.applyConfig();
            if (r.ok) onDone();
            return r;
          }}
          disabled={!gitConfigured}
        />
        <ActionButton
          label="Person poll now"
          variant="secondary"
          onRun={async () => {
            const r = await operationsApi.personPoll();
            if (r.ok) onDone();
            return r;
          }}
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
