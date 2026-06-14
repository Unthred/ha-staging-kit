import { Link } from "react-router-dom";
import { LoadErrorPanel } from "../components/LoadErrorPanel";
import { DashboardActivityTimeline } from "../components/dashboard/DashboardActivityTimeline";
import { DashboardInstanceMonitoring } from "../components/dashboard/DashboardInstanceMonitoring";
import { DashboardMetricCard } from "../components/dashboard/DashboardMetricCard";
import { DashboardLiveMetrics } from "../components/dashboard/DashboardLiveMetrics";
import { DashboardParityBanner } from "../components/dashboard/DashboardParityBanner";
import { DashboardPageShell } from "../components/dashboard/DashboardPageShell";
import { shortDetail, statusTone } from "../lib/dashboardHealth";
import { isMirrorControlMode, mirrorModeLabel } from "../lib/mirrorMode";
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
          <Link to="/operations">Switch to read-only</Link>
        </div>
      )}

      <DashboardParityBanner compact representation={data?.stagingRepresentation} git={data?.git} />

      <DashboardLiveMetrics metrics={data?.liveMetrics} />

      <div className="dash-live-grid">
        <DashboardInstanceMonitoring
          inventory={data?.configInventory}
          prod={data?.prodMonitoring}
          staging={data?.stagingMonitoring}
          entityParity={data?.entityParity}
          representation={data?.stagingRepresentation}
          configDrift={data?.configDrift}
          git={data?.git}
          syncActivity={data?.syncActivity}
          presence={data?.presence}
          mqtt={data?.mqttBridge}
          mirror={data?.mirror}
          gitConfigured={data?.git?.configured ?? false}
          mirrorConfigured={data?.mirror?.configured ?? false}
          onRemediate={refresh}
        />

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
