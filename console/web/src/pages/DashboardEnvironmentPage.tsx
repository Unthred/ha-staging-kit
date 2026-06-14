import { LoadErrorPanel } from "../components/LoadErrorPanel";
import { DashboardGitPanel } from "../components/dashboard/DashboardGitPanel";
import { DashboardPageShell } from "../components/dashboard/DashboardPageShell";
import { DashboardReadinessChips } from "../components/dashboard/DashboardReadinessChips";
import { DashboardStagingTargetPanel } from "../components/dashboard/DashboardStagingTargetPanel";
import { useDashboardStatus } from "../hooks/useDashboardStatus";

export default function DashboardEnvironmentPage() {
  const { data, error, busy, refresh } = useDashboardStatus(60000);

  if (error && !data) {
    return (
      <LoadErrorPanel
        title="Environment"
        error={error}
        onRetry={() => {
          refresh();
        }}
      />
    );
  }

  return (
    <DashboardPageShell
      kicker="Environment"
      title="Config & topology"
      subtitle="Git, paths, staging target — changes slowly"
      data={data}
      busy={busy}
      onRefresh={refresh}
    >
      {data && data.readiness.length > 0 && <DashboardReadinessChips items={data.readiness} />}

      <div className="dash-env-stack">
        <DashboardGitPanel git={data?.git} drift={data?.configDrift} inventory={data?.configInventory} onRemediate={refresh} />
        <DashboardStagingTargetPanel target={data?.stagingTarget} />
      </div>
    </DashboardPageShell>
  );
}
