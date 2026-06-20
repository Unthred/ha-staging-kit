import { PageLoadBanner } from "../components/PageLoadBanner";
import { SectionAttentionBadge } from "../components/PageAttentionPanel";
import { DashboardEnvironmentKitPanel } from "../components/dashboard/DashboardEnvironmentKitPanel";
import { DashboardGitPanel } from "../components/dashboard/DashboardGitPanel";
import { DashboardPageShell } from "../components/dashboard/DashboardPageShell";
import { DashboardReadinessChips } from "../components/dashboard/DashboardReadinessChips";
import { DashboardTopologyStrip } from "../components/dashboard/DashboardTopologyStrip";
import { useNavAttentionContext } from "../context/NavAttentionContext";
import { useAttentionNavigation } from "../hooks/useAttentionNavigation";
import { attentionCountForAnchor } from "../lib/navAttention";
import { useStableMinHeight } from "../hooks/useStableMinHeight";
import { useDashboardStatus } from "../hooks/useDashboardStatus";

export default function DashboardEnvironmentPage() {
  const { data, error, busy, refresh } = useDashboardStatus(60000);
  const { itemsForPath } = useNavAttentionContext();
  const attentionItems = itemsForPath("/environment");
  useAttentionNavigation([attentionItems.length]);
  const readinessAttention = attentionCountForAnchor(attentionItems, "env-readiness");
  const kitAttention = attentionCountForAnchor(attentionItems, "env-kit");
  const gitAttention = attentionCountForAnchor(attentionItems, "env-git");
  const envStackStable = useStableMinHeight("env-page-stack");

  if (error && !data) {
    return (
      <DashboardPageShell
        compact
        kicker="Environment"
        title="Topology & apply state"
        subtitle="Where staging and prod point — changes slowly"
        busy={busy}
        onRefresh={refresh}
      >
        <PageLoadBanner error={error} onRetry={refresh} />
        <div ref={envStackStable.ref} style={envStackStable.style} className="dash-env-stack dash-env-stack-compact">
          <DashboardTopologyStrip />
          <div id="env-kit">
            <DashboardEnvironmentKitPanel attentionCount={kitAttention} />
          </div>
          <div id="env-git">
            <DashboardGitPanel attentionCount={gitAttention} />
          </div>
        </div>
      </DashboardPageShell>
    );
  }

  const readinessIssues = (data?.readiness ?? []).filter((item) => !item.ok);

  return (
    <DashboardPageShell
      compact
      kicker="Environment"
      title="Topology & apply state"
      subtitle="Where staging and prod point — changes slowly"
      data={data}
      busy={busy}
      onRefresh={refresh}
    >
      {readinessIssues.length > 0 && (
        <section id="env-readiness" className="dash-env-readiness-wrap">
          <p className="dash-panel-eyebrow">
            Setup incomplete
            <SectionAttentionBadge count={readinessAttention} />
          </p>
          <DashboardReadinessChips items={readinessIssues} />
        </section>
      )}

      <div ref={envStackStable.ref} style={envStackStable.style} className="dash-env-stack dash-env-stack-compact">
        <DashboardTopologyStrip
          prodUrl={data?.prodHaUrl}
          stagingUrl={data?.stagingHaUrl}
          git={data?.git}
          target={data?.stagingTarget}
        />
        <div id="env-kit">
        <DashboardEnvironmentKitPanel
          sidecar={data?.sidecar}
          syncActivity={data?.syncActivity}
          mirror={data?.mirror}
          inventory={data?.configInventory}
          target={data?.stagingTarget}
          onMirrorModeChanged={refresh}
          attentionCount={kitAttention}
        />
        </div>
        <div id="env-git">
        <DashboardGitPanel git={data?.git} drift={data?.configDrift} attentionCount={gitAttention} />
        </div>
      </div>
    </DashboardPageShell>
  );
}
