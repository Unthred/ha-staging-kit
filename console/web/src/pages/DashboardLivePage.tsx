import { useState } from "react";
import { Link } from "react-router-dom";
import { LoadErrorPanel } from "../components/LoadErrorPanel";
import { DashboardActivityTimeline } from "../components/dashboard/DashboardActivityTimeline";
import { DashboardInstanceMonitoring } from "../components/dashboard/DashboardInstanceMonitoring";
import { DashboardMetricCard } from "../components/dashboard/DashboardMetricCard";
import { DashboardLiveMetrics } from "../components/dashboard/DashboardLiveMetrics";
import {
  DeployFlowGateHint,
  DeployFlowShipSection,
  DeployFlowZ2mChecklist,
} from "../components/dashboard/DeployFlowPanel";
import { DashboardPageShell } from "../components/dashboard/DashboardPageShell";
import { shortDetail, statusTone } from "../lib/dashboardHealth";
import { isMirrorControlMode, mirrorModeLabel } from "../lib/mirrorMode";
import { useNavAttentionContext } from "../context/NavAttentionContext";
import { useAttentionNavigation } from "../hooks/useAttentionNavigation";
import { useDeployFlow } from "../hooks/useDeployFlow";
import { attentionCountForAnchor, overviewAttentionOrders } from "../lib/navAttention";
import { useDashboardStatus } from "../hooks/useDashboardStatus";
import type { DashboardStatus } from "../api";

function mirrorMeta(data?: DashboardStatus | null): string | undefined {
  if (!data?.mirror?.configured) return undefined;
  const mirror = data.mirror;
  const parts = [`${mirror.prodMqttHost}:${mirror.prodMqttPort}`];
  parts.push(mirror.running ? "Running" : "Stopped");
  parts.push(mirrorModeLabel(mirror.mode));
  return parts.join(" · ");
}

export default function DashboardLivePage() {
  const { data, error, busy, refresh } = useDashboardStatus();
  const [commitOpen, setCommitOpen] = useState(false);
  const { itemsForPath } = useNavAttentionContext();
  const attentionItems = itemsForPath("/");
  useAttentionNavigation([attentionItems.length]);
  const deployFlow = useDeployFlow({
    git: data?.git,
    configDrift: data?.configDrift,
    onDone: refresh,
  });

  if (error && !data) {
    return (
      <LoadErrorPanel
        title="Live overview"
        error={error}
        onRetry={() => {
          refresh();
        }}
      />
    );
  }

  const issueCount = data?.issues.length ?? 0;
  const overviewOrders = overviewAttentionOrders(attentionItems);
  const haErrorsAttention = attentionCountForAnchor(attentionItems, "overview-ha-errors");
  const gitConfigured = data?.git?.configured ?? false;

  return (
    <DashboardPageShell
      compact
      kicker="Live"
      title="Overview"
      subtitle="Staging vs production"
      data={data}
      busy={busy}
      onRefresh={refresh}
    >
      {data?.mirror?.configured && isMirrorControlMode(data.mirror.mode) && (
        <div className="dash-banner dash-banner-danger dash-banner-compact">
          Control mode — staging can actuate prod.{" "}
          <Link to="/environment#mirror-control">Switch to read-only</Link>
        </div>
      )}

      <DashboardLiveMetrics
        metrics={data?.liveMetrics}
        haIssues={data?.haIssues ?? []}
        haAttentionCount={haErrorsAttention}
        haAttentionOrder={overviewOrders["ha-errors"]}
      />

      <div className="dash-live-grid">
        <div className="dash-live-primary-stack">
          {gitConfigured && (
            <>
              <DeployFlowGateHint flow={deployFlow} attentionOrder={overviewOrders["deploy-gate"]} />
              <DeployFlowZ2mChecklist flow={deployFlow} />
            </>
          )}

          <DashboardInstanceMonitoring
            inventory={data?.configInventory}
            prod={data?.prodMonitoring}
            staging={data?.stagingMonitoring}
            entityParity={data?.entityParity}
            representation={data?.stagingRepresentation}
            configDrift={data?.configDrift}
            git={data?.git}
            presence={data?.presence}
            mqtt={data?.mqttBridge}
            mirror={data?.mirror}
            gitConfigured={gitConfigured}
            mirrorConfigured={data?.mirror?.configured ?? false}
            onRemediate={refresh}
            commitOpen={commitOpen}
            onCommitOpen={() => setCommitOpen(true)}
            onCommitClose={() => setCommitOpen(false)}
            attentionOrder={overviewOrders.parity}
          />

          {gitConfigured && (
            <DeployFlowShipSection
              flow={deployFlow}
              onOpenCommit={() => setCommitOpen(true)}
              attentionOrders={{
                commit: overviewOrders["deploy-commit"],
                push: overviewOrders["deploy-push"],
                prod: overviewOrders["deploy-prod"],
              }}
            />
          )}
        </div>

        <section className="dash-live-secondary">
          <DashboardActivityTimeline compact activity={data?.syncActivity} />
          <div className="dash-panel dash-subsystems-panel">
            <header className="dash-panel-head dash-panel-head-tight">
              <h3>Subsystems</h3>
              {issueCount > 0 && (
                <Link to="/diagnostics" className="dash-chip-link">
                  {issueCount} log signal{issueCount === 1 ? "" : "s"}
                </Link>
              )}
            </header>
            <div className="dash-subsystems-grid">
              {data?.subsystems.map((s) => (
                <DashboardMetricCard
                  key={s.name}
                  name={s.name}
                  tone={statusTone(s.status)}
                  detail={shortDetail(s.detail, 64)}
                  meta={s.name === "MQTT mirror" ? mirrorMeta(data) : undefined}
                  compact
                />
              ))}
            </div>
          </div>
        </section>
      </div>
    </DashboardPageShell>
  );
}
