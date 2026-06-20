import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { PageLoadBanner } from "../components/PageLoadBanner";
import { DashboardActivityTimeline } from "../components/dashboard/DashboardActivityTimeline";
import { DashboardInstanceMonitoring } from "../components/dashboard/DashboardInstanceMonitoring";
import { DashboardMetricCard } from "../components/dashboard/DashboardMetricCard";
import { DashboardLiveMetrics } from "../components/dashboard/DashboardLiveMetrics";
import {
  DeployFlowGateHint,
  DeployFlowImpactPreview,
  DeployFlowShipSection,
  DeployFlowZ2mChecklist,
} from "../components/dashboard/DeployFlowPanel";
import { DashboardPageShell } from "../components/dashboard/DashboardPageShell";
import { statusTone } from "../lib/dashboardHealth";
import { isMirrorControlMode, mirrorModeLabel } from "../lib/mirrorMode";
import { useNavAttentionContext } from "../context/NavAttentionContext";
import { useAttentionNavigation } from "../hooks/useAttentionNavigation";
import { useDeployFlow } from "../hooks/useDeployFlow";
import { attentionCountForAnchor, overviewAttentionOrders } from "../lib/navAttention";
import { useDashboardStatus } from "../hooks/useDashboardStatus";
import { PLACEHOLDER_SUBSYSTEMS } from "../lib/pageShellDefaults";
import type { DashboardStatus } from "../api";

function mirrorMeta(data?: DashboardStatus | null): string | undefined {
  if (!data?.mirror?.configured) return undefined;
  const mirror = data.mirror;
  const parts = [`${mirror.prodMqttHost}:${mirror.prodMqttPort}`];
  parts.push(mirror.running ? "Running" : "Stopped");
  parts.push(mirrorModeLabel(mirror.mode));
  return parts.join(" · ");
}

function SubsystemsLogSignalsLink({ count }: { count: number | null }) {
  const countLabel = count == null ? "—" : String(count);
  const suffix = count === 1 ? "log signal" : "log signals";
  return (
    <Link
      to="/diagnostics"
      className="dash-chip-link dash-subsystems-log-signals-link"
      aria-busy={count == null}
    >
      <span className="dash-subsystems-log-signals-count">{countLabel}</span>
      <span>{suffix}</span>
    </Link>
  );
}

export default function DashboardLivePage() {
  const { data, error, busy, refresh } = useDashboardStatus();
  const { itemsForPath, refresh: refreshNavAttention } = useNavAttentionContext();
  const [commitOpen, setCommitOpen] = useState(false);
  const attentionItems = itemsForPath("/");
  useAttentionNavigation([attentionItems.length]);

  const refreshOverview = useCallback(() => {
    void refresh();
    void refreshNavAttention();
  }, [refresh, refreshNavAttention]);

  const deployFlow = useDeployFlow({
    git: data?.git,
    configDrift: data?.configDrift,
    onDone: refreshOverview,
  });

  const overviewOrders = overviewAttentionOrders(attentionItems);

  if (error && !data) {
    return (
      <DashboardPageShell
        compact
        kicker="Live"
        title="Overview"
        subtitle="Staging vs production"
        busy={busy}
        onRefresh={refreshOverview}
      >
        <PageLoadBanner error={error} onRetry={refreshOverview} />
        <DashboardLiveMetrics haIssues={[]} />
        <div className="dash-live-grid">
          <div className="dash-live-primary-stack">
            <DeployFlowGateHint flow={deployFlow} attentionOrder={overviewOrders["deploy-gate"]} />
            <DeployFlowImpactPreview flow={deployFlow} attentionOrder={overviewOrders["deploy-impact"]} />
            <DeployFlowZ2mChecklist flow={deployFlow} />
            <DashboardInstanceMonitoring gitConfigured={false} mirrorConfigured={false} />
            <DeployFlowShipSection
              flow={deployFlow}
              onOpenCommit={() => setCommitOpen(true)}
              attentionOrders={{
                commit: overviewOrders["deploy-commit"],
                push: overviewOrders["deploy-push"],
                prod: overviewOrders["deploy-prod"],
              }}
            />
          </div>
          <section className="dash-live-secondary">
            <DashboardActivityTimeline compact />
            <div className="dash-panel dash-subsystems-panel">
              <header className="dash-panel-head dash-panel-head-tight dash-subsystems-panel-head">
                <h3>Subsystems</h3>
                <span className="dash-subsystems-panel-head-extra">
                  <SubsystemsLogSignalsLink count={null} />
                </span>
              </header>
              <div className="dash-subsystems-grid">
                {PLACEHOLDER_SUBSYSTEMS.map((s) => (
                  <DashboardMetricCard key={s.name} name={s.name} tone="idle" detail="—" compact />
                ))}
              </div>
            </div>
          </section>
        </div>
      </DashboardPageShell>
    );
  }

  const issueCount = data?.issues.length ?? null;
  const haErrorsAttention = attentionCountForAnchor(attentionItems, "overview-ha-errors");
  const gitConfigured = data?.git?.configured ?? false;
  const showDeployFlow = data == null || gitConfigured;

  return (
    <DashboardPageShell
      compact
      kicker="Live"
      title="Overview"
      subtitle="Staging vs production"
      data={data}
      busy={busy}
      onRefresh={refreshOverview}
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
          {showDeployFlow && (
            <>
              <DeployFlowGateHint flow={deployFlow} attentionOrder={overviewOrders["deploy-gate"]} />
              <DeployFlowImpactPreview flow={deployFlow} attentionOrder={overviewOrders["deploy-impact"]} />
              <DeployFlowZ2mChecklist flow={deployFlow} />
            </>
          )}

          <DashboardInstanceMonitoring
            inventory={data?.configInventory}
            prod={data?.prodMonitoring}
            staging={data?.stagingMonitoring}
            entityParity={data?.entityParity}
            representation={data?.stagingRepresentation}
            lovelaceDrift={data?.lovelaceDrift}
            configDrift={data?.configDrift}
            git={data?.git}
            presence={data?.presence}
            mqtt={data?.mqttBridge}
            mirror={data?.mirror}
            gitConfigured={gitConfigured}
            mirrorConfigured={data?.mirror?.configured ?? false}
            onRemediate={refreshOverview}
            commitOpen={commitOpen}
            onCommitOpen={() => setCommitOpen(true)}
            onCommitClose={() => setCommitOpen(false)}
            attentionOrder={overviewOrders.parity}
          />

          {showDeployFlow && (
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
            <header className="dash-panel-head dash-panel-head-tight dash-subsystems-panel-head">
              <h3>Subsystems</h3>
              <span className="dash-subsystems-panel-head-extra">
                <SubsystemsLogSignalsLink count={issueCount} />
              </span>
            </header>
            <div className="dash-subsystems-grid">
              {(data?.subsystems ?? PLACEHOLDER_SUBSYSTEMS).map((s) => (
                <DashboardMetricCard
                  key={s.name}
                  name={s.name}
                  tone={statusTone(s.status)}
                  detail={s.detail}
                  meta={s.name === "MQTT mirror" ? (mirrorMeta(data) ?? "—") : undefined}
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
