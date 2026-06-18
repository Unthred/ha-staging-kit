import { Link } from "react-router-dom";
import type { ConfigInventoryStats, DashboardStatus, StagingTargetSnapshot, SyncActivitySnapshot } from "../../api";
import { MirrorControlModeToggle } from "../MirrorControlModeToggle";
import { SectionAttentionBadge } from "../PageAttentionPanel";

function stat(label: string, value: string, tone?: "ok" | "warn" | "muted") {
  return (
    <div className={`dash-stat-card dash-env-stat ${tone ? `dash-env-stat-${tone}` : ""}`}>
      <span className="dash-stat-value">{value}</span>
      <span className="dash-stat-label">{label}</span>
    </div>
  );
}

function pathStat(label: string, value: string, tone?: "ok" | "warn" | "muted") {
  return (
    <div className={`dash-stat-card dash-env-stat dash-env-path-stat ${tone ? `dash-env-stat-${tone}` : ""}`}>
      <span className="dash-stat-value">{value}</span>
      <span className="dash-stat-label">{label}</span>
    </div>
  );
}

/** Kit background jobs + shared YAML inventory — reference only, not live entity counts. */
export function DashboardEnvironmentKitPanel({
  sidecar,
  syncActivity,
  mirror,
  inventory,
  target,
  onMirrorModeChanged,
  attentionCount = 0,
}: {
  sidecar?: DashboardStatus["sidecar"] | null;
  syncActivity?: SyncActivitySnapshot | null;
  mirror?: DashboardStatus["mirror"] | null;
  inventory?: ConfigInventoryStats | null;
  target?: StagingTargetSnapshot | null;
  onMirrorModeChanged?: () => void;
  attentionCount?: number;
}) {
  const showStagingPaths = Boolean(
    target?.configPath || target?.containerName || target?.gitRepoPath,
  );

  return (
    <section className="dash-panel dash-env-kit-panel">
      <header className="dash-panel-head dash-panel-head-tight">
        <div>
          <p className="dash-panel-eyebrow">Kit</p>
          <h3>
            Background sync &amp; repo
            <SectionAttentionBadge count={attentionCount} />
          </h3>
        </div>
        <Link to="/operations" className="dash-chip-link">
          Operations
        </Link>
      </header>

      <div className="dash-env-kit-section">
        <h4 className="dash-env-kit-label">Background jobs</h4>
        <div className="dash-env-stat-grid">
          {stat("Sync loop", sidecar?.running ? "Running" : "Stopped", sidecar?.running ? "ok" : "warn")}
          {stat(
            "Last apply",
            syncActivity?.lastApplyRelative ?? "—",
            syncActivity?.lastApplyRelative ? "ok" : "muted",
          )}
          {stat(
            "Storage sync",
            syncActivity?.lastStorageSyncRelative ?? "—",
            syncActivity?.lastStorageSyncRelative ? "ok" : "muted",
          )}
          {stat(
            "Person poll",
            syncActivity?.lastPersonPollRelative ?? "—",
            syncActivity?.lastPersonPollRelative ? "ok" : "muted",
          )}
        </div>
        {sidecar && (
          <p className="muted dash-env-kit-meta">
            Intervals: apply on demand · storage every {sidecar.storageSyncIntervalSeconds}s · person every{" "}
            {sidecar.personPollIntervalSeconds}s
          </p>
        )}
      </div>

      {showStagingPaths && (
        <div className="dash-env-kit-section">
          <h4 className="dash-env-kit-label">Staging paths</h4>
          <div className="dash-env-stat-grid dash-env-path-grid">
            {pathStat("Config path", target?.configPath ? target.configPath : "—")}
            {pathStat(
              "Writable",
              target?.configPath ? (target.configPathWritable ? "Yes" : "No") : "—",
              target?.configPathWritable ? "ok" : target?.configPath ? "warn" : "muted",
            )}
            {pathStat(
              "Container",
              target?.containerName
                ? `${target.containerName}${target.containerRunning ? " · running" : " · stopped"}`
                : "—",
              target?.containerRunning ? "ok" : target?.containerName ? "warn" : "muted",
            )}
            {pathStat(
              "Kit git mount",
              target?.gitRepoPath
                ? `${target.gitRepoPath}${target.gitBranch ? ` @ ${target.gitBranch}` : ""}`
                : "—",
            )}
          </div>
        </div>
      )}

      {mirror?.configured && (
        <div className="dash-env-kit-section" id="mirror-control">
          <div className="dash-env-kit-section-head">
            <h4 className="dash-env-kit-label">MQTT mirror</h4>
            <Link to="/operations" className="dash-chip-link dash-env-kit-inline-link">
              Deploy on Operations
            </Link>
          </div>
          <div className="dash-env-stat-grid dash-env-mirror-grid">
            {stat(
              "Broker",
              mirror.running ? "Running" : "Stopped",
              mirror.running ? "ok" : "warn",
            )}
            {stat(
              "Prod source",
              mirror.prodMqttHost ? `${mirror.prodMqttHost}:${mirror.prodMqttPort}` : "—",
              mirror.prodMqttHost ? undefined : "muted",
            )}
            {stat(
              "Staging broker",
              target?.stagingMqttBroker ? `${target.stagingMqttBroker}:${target.stagingMqttPort}` : "—",
              target?.stagingMqttBroker ? undefined : "muted",
            )}
            <MirrorControlModeToggle inline mirror={mirror} onChanged={onMirrorModeChanged} />
          </div>
        </div>
      )}

      {inventory?.available && (
        <div className="dash-env-kit-section">
          <h4 className="dash-env-kit-label">Shared YAML in git</h4>
          <div className="dash-env-stat-grid dash-env-stat-grid-4">
            {stat("Automations", String(inventory.automationCount))}
            {stat("Scripts", String(inventory.scriptCount))}
            {stat("Packages", String(inventory.packageCount))}
            {stat("Blueprints", String(inventory.blueprintCount))}
          </div>
          <p className="muted dash-env-kit-meta">Counts from repo files — live entity totals are on Overview.</p>
        </div>
      )}
    </section>
  );
}
