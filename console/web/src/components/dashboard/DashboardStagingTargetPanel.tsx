import type { StagingTargetSnapshot } from "../../api";
import { StagingTargetSummary } from "../StagingTargetSummary";

export function DashboardStagingTargetPanel({ target }: { target?: StagingTargetSnapshot | null }) {
  if (!target) {
    return (
      <section className="dash-panel dash-staging-target">
        <header className="dash-panel-head">
          <div>
            <p className="dash-panel-eyebrow">Staging target</p>
            <h3>What staging points at</h3>
          </div>
        </header>
        <p className="muted">Configure staging URL and paths in Settings to detect the staging instance.</p>
      </section>
    );
  }

  return (
    <section className="dash-panel dash-staging-target">
      <header className="dash-panel-head">
        <div>
          <p className="dash-panel-eyebrow">Staging target</p>
          <h3>What staging points at</h3>
        </div>
      </header>
      <StagingTargetSummary target={target} />
    </section>
  );
}
