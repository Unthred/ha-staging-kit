import type { ReactNode } from "react";
import type { StagingTargetSnapshot } from "../api";

function row(label: string, value: ReactNode) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="staging-target-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function topologyLabel(type: string) {
  if (type === "docker") return "Docker container";
  if (type === "ha_os") return "Home Assistant OS";
  return type || "unknown";
}

export function StagingTargetSummary({ target }: { target: StagingTargetSnapshot }) {
  return (
    <div className="staging-target">
      <dl className="staging-target-list">
        {row("Web UI", target.url ? <a href={target.url} target="_blank" rel="noreferrer">{target.url}</a> : null)}
        {row(
          "Install type",
          <>
            {target.installLabel}
            {!target.addonsAvailable && (
              <span className="staging-target-tag">No Apps / Add-on store</span>
            )}
          </>,
        )}
        {row(
          "Configured topology",
          <>
            Staging: {topologyLabel(target.stagingHaType)}
            {target.prodHaType ? <> · Prod: {topologyLabel(target.prodHaType)}</> : null}
          </>,
        )}
        {row("Version", target.version)}
        {row("Location", target.locationName)}
        {row("Config on disk (kit applies here)", target.configPath ? <code>{target.configPath}</code> : null)}
        {row(
          "Config writable",
          target.configPath
            ? target.configPathWritable
              ? "Yes"
              : "No — kit cannot apply YAML"
            : null,
        )}
        {row(
          "Git source",
          target.gitRepoPath ? (
            <>
              <code>{target.gitRepoPath}</code>
              {target.gitBranch ? <> @ <code>{target.gitBranch}</code></> : null}
            </>
          ) : null,
        )}
        {row(
          "Docker container",
          target.containerName ? (
            <>
              <code>{target.containerName}</code>
              {target.containerRunning ? " · running" : " · not running"}
            </>
          ) : null,
        )}
        {row("HA config_dir (from API)", target.haConfigDir ? <code>{target.haConfigDir}</code> : null)}
        {row(
          "Mirror MQTT broker",
          target.stagingMqttBroker ? (
            <>
              <code>{target.stagingMqttBroker}</code>:<code>{target.stagingMqttPort}</code>
          <span className="staging-target-tag">Re-applied after storage sync</span>
            </>
          ) : null,
        )}
      </dl>
      {target.notes && <p className="staging-target-note muted">{target.notes}</p>}
    </div>
  );
}
