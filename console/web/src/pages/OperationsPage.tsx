import { useEffect, useState } from "react";
import { onboardingApi, operationsApi, settingsApi, toApiError, type SettingsView } from "../api";
import { ActionButton } from "../components/ActionButton";
import { Chip } from "../components/Chip";
import { MirrorControlModeToggle } from "../components/MirrorControlModeToggle";
import { MqttMirrorInstructions } from "../components/MqttMirrorInstructions";

const SECTIONS = [
  {
    id: "config-sync",
    title: "Config & sync",
    risk: "low" as const,
    summary: "Apply git config and refresh person states.",
  },
  {
    id: "storage-sync",
    title: "Storage sync",
    risk: "medium" as const,
    summary: "Copy prod .storage subset to staging.",
  },
  {
    id: "mqtt-mirror",
    title: "MQTT mirror",
    risk: "medium" as const,
    summary: "Deploy bridge and switch mirror mode.",
  },
  {
    id: "staging-ha",
    title: "Staging HA",
    risk: "medium" as const,
    summary: "Restart the staging Home Assistant container.",
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function riskLabel(risk: "low" | "medium" | "high") {
  if (risk === "low") return "Low risk";
  if (risk === "high") return "High risk";
  return "Medium risk";
}

export default function OperationsPage() {
  const [sectionId, setSectionId] = useState<SectionId>("config-sync");
  const [gitConfigured, setGitConfigured] = useState(true);
  const [settings, setSettings] = useState<SettingsView | null>(null);

  useEffect(() => {
    onboardingApi.status().then((s) => setGitConfigured(s.gitConfigured)).catch(() => setGitConfigured(false));
    settingsApi.get().then(setSettings).catch((e) => console.warn(toApiError(e).detail));
  }, [sectionId]);

  const sectionIndex = SECTIONS.findIndex((s) => s.id === sectionId);
  const current = SECTIONS[Math.max(sectionIndex, 0)] ?? SECTIONS[0];
  const riskStatus = current.risk === "low" ? "pass" : "warn";
  const stagingHaType = settings?.topology.stagingHaType ?? "docker";
  const isDockerStaging = stagingHaType === "docker";
  const mirrorEnabled = settings?.mirror.enabled ?? false;
  const mirrorBroker = settings?.mirror.stagingMqttBrokerHost?.trim();
  const mirrorPort = settings?.mirror.stagingMqttPort ?? 1883;

  return (
    <div className="page ops-page">
      <div className="page-header">
        <div>
          <h2>Operations</h2>
          <p className="muted">{current.summary}</p>
        </div>
      </div>

      <div className="layout">
        <nav className="sidebar" aria-label="Operations">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`nav-item ${s.id === sectionId ? "active" : ""}`}
              onClick={() => setSectionId(s.id)}
            >
              {s.title}
            </button>
          ))}
        </nav>

        <main className="card main-card">
          <div className="ops-panel-head">
            <h2>{current.title}</h2>
            <Chip status={riskStatus} label={riskLabel(current.risk)} />
          </div>

          {current.id === "config-sync" && (
            <>
              <p>
                Keep staging YAML and runtime person states aligned with prod. These run inside the kit container
                against your configured git repo and HA API tokens.
              </p>
              <h3>Apply staging config</h3>
              <p className="muted">
                Checks out your <strong>staging</strong> git branch and rsyncs config into the staging HA config
                directory. Also refreshes <code>secrets.yaml</code> from prod (SSH) and the kit runtime overlay.
                {isDockerStaging
                  ? " Restart the staging Docker container afterward if YAML changed."
                  : " Restart staging HA afterward if YAML changed (Settings → System → Restart on HA OS)."}
              </p>
              <h3>Person poll now</h3>
              <p className="muted">
                One immediate sync of person and device_tracker states from prod → staging via REST. Phones only report
                to prod; this keeps staging presence realistic for automations.
              </p>
              {!gitConfigured && (
                <p className="muted warn">
                  HA config git repo is not configured or not mounted. Set the repo path in Settings → Paths &amp; git
                  before applying config.
                </p>
              )}
              <div className="step-actions-right ops-actions">
                <ActionButton
                  label="Apply staging config"
                  onRun={operationsApi.applyConfig}
                  disabled={!gitConfigured}
                />
                <ActionButton label="Person poll now" onRun={operationsApi.personPoll} variant="secondary" />
              </div>
            </>
          )}

          {current.id === "storage-sync" && (
            <>
              <p>
                Pulls a curated subset of prod <code>.storage</code> into staging over SSH — entity registry, device
                registry, MQTT credentials (for the mirror), person records, and related images.
              </p>
              <p className="muted warn">
                Overwrites matching files in staging <code>.storage</code>. Prod copies MQTT broker hostname{" "}
                <code>core-mosquitto</code> into <code>core.config_entries</code> — that is correct on prod HA OS but
                wrong on staging when using the mirror.
              </p>
              {mirrorEnabled && mirrorBroker ? (
                <p className="muted">
                  After sync, the kit re-applies the mirror broker at <code>{mirrorBroker}</code> so staging MQTT stays
                  on the kit, not prod. Restart staging HA if entities stay unavailable.
                </p>
              ) : mirrorEnabled ? (
                <p className="muted warn">
                  Mirror is enabled but broker address could not be resolved — set prod and staging HA URLs in Settings.
                </p>
              ) : (
                <p className="muted">MQTT broker patch runs only when the mirror is enabled.</p>
              )}
              <ul className="checklist">
                <li>Needed when staging is missing devices/entities that exist on prod</li>
                <li>Updates MQTT integration credentials used by the mirror broker</li>
                <li>Does not modify prod — read-only from prod&apos;s perspective</li>
                {isDockerStaging && (
                  <li>
                    Docker staging: no Apps page — MQTT is configured under Devices &amp; services, not the Add-on store
                  </li>
                )}
              </ul>
              <div className="step-actions-right ops-actions">
                <ActionButton label="Run storage sync" toastPreset="storage-sync" onRun={operationsApi.storageSync} />
              </div>
            </>
          )}

          {current.id === "mqtt-mirror" && (
            <>
              <p>
                The kit runs a local Mosquitto broker that bridges selected topics from prod. Staging HA connects to
                this broker (not prod directly) for live Zigbee/device state during testing.
              </p>
              <h3>Deploy / refresh mirror</h3>
              <p className="muted">
                Regenerates bridge config from staging <code>.storage</code> and restarts mosquitto inside the kit
                container. Run after storage sync or when prod MQTT credentials change.
              </p>
              <h3>Mirror mode</h3>
              <p className="muted">
                <strong>Read-only</strong> (default) — prod → staging only; safe for everyday staging work.{" "}
                <strong>Control mode</strong> — also forwards <code>zigbee2mqtt/+/set</code> to prod; real devices can
                actuate. Turn off when finished testing.
              </p>
              <MirrorControlModeToggle />
              {mirrorEnabled && (
                <>
                  <h3>Point staging HA at the mirror</h3>
                  <MqttMirrorInstructions
                    stagingHaType={stagingHaType}
                    brokerHost={mirrorBroker ?? undefined}
                    brokerPort={mirrorPort}
                  />
                </>
              )}
              <div className="step-actions-right ops-actions">
                <ActionButton label="Deploy / refresh mirror" toastPreset="refresh-mirror" onRun={operationsApi.deployMirror} />
              </div>
            </>
          )}

          {current.id === "staging-ha" && (
            <>
              {isDockerStaging ? (
                <>
                  <p>
                    Restarts the Docker container running staging Home Assistant so it reloads configuration and
                    integrations after an apply, storage sync, or manual file edits.
                  </p>
                  <p className="muted">
                    Set <code>STAGING_HA_CONTAINER</code> in Settings → Advanced (e.g.{" "}
                    <code>Home-Assistant-Container</code>). The kit uses the host Docker socket to restart that
                    container.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Restarts the staging Home Assistant container (when <code>STAGING_HA_CONTAINER</code> is set) so
                    integrations reload after storage sync or config changes.
                  </p>
                  <p className="muted">
                    On HA OS staging you can also restart from <strong>Settings → System → Restart</strong> in the HA
                    UI. The kit button only works when a Docker container name is configured.
                  </p>
                </>
              )}
              <ul className="checklist">
                <li>Use after <strong>Apply staging config</strong> when YAML packages changed</li>
                <li>Use after <strong>Storage sync</strong> if MQTT entities stay unavailable</li>
                <li>Expect staging to be unavailable for 30–90 seconds during restart</li>
                <li>Does not restart prod or the kit container itself</li>
              </ul>
              <div className="step-actions-right ops-actions">
                <ActionButton label="Restart staging HA" onRun={operationsApi.restartStaging} variant="secondary" />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
