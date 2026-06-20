import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  onboardingApi,
  operationsApi,
  settingsApi,
  dashboardApi,
  toApiError,
  type DashboardStatus,
  type OperationResult,
  type SettingsView,
} from "../api";
import { ActionButton } from "../components/ActionButton";
import { Chip } from "../components/Chip";
import { DashboardHeader } from "../components/dashboard/DashboardHeader";
import { DeployLovelaceGatePanel } from "../components/dashboard/DeployLovelaceGatePanel";
import { SectionAttentionBadge } from "../components/PageAttentionPanel";
import { MirrorControlModeToggle } from "../components/MirrorControlModeToggle";
import { MqttMirrorInstructions } from "../components/MqttMirrorInstructions";
import { OpsLastResultPanel } from "../components/operations/OpsLastResultPanel";
import { OpsCallout, OpsChecklist, OpsDetailsPanel, OpsNote, OpsTaskPanel } from "../components/operations/OpsTaskPanel";
import { useNavAttentionContext } from "../context/NavAttentionContext";
import { useAttentionNavigation } from "../hooks/useAttentionNavigation";
import { operationsActionOrders, operationsSectionActionCount, type OpsSection } from "../lib/navAttention";
import { useHaUrls } from "../hooks/useHaUrls";

const SECTIONS = [
  {
    id: "entity-deploy",
    title: "Entity Janitor",
    risk: "medium" as const,
    summary: "Scan prod entities, export migrations, and clear release blockers.",
  },
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
  {
    id: "baseline",
    title: "Baseline from prod",
    risk: "high" as const,
    summary: "Rare — export live prod into git, force-align GitHub, optionally rebuild staging.",
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function riskLabel(risk: "low" | "medium" | "high") {
  if (risk === "low") return "Low risk";
  if (risk === "high") return "High risk";
  return "Medium risk";
}

export default function OperationsPage() {
  const [searchParams] = useSearchParams();
  const [sectionId, setSectionId] = useState<SectionId>("entity-deploy");
  const [gitConfigured, setGitConfigured] = useState(true);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [mirrorStatus, setMirrorStatus] = useState<DashboardStatus["mirror"] | null>(null);
  const [mirrorLoading, setMirrorLoading] = useState(true);
  const [lastResult, setLastResult] = useState<OperationResult | null>(null);
  const { itemsForPath, refresh: refreshAttention } = useNavAttentionContext();
  const attentionItems = itemsForPath("/operations");
  const sectionActionCount = (id: SectionId) => operationsSectionActionCount(attentionItems, id as OpsSection);
  const actionOrders = operationsActionOrders(attentionItems, sectionId as OpsSection);
  const haUrls = useHaUrls();

  const refreshMirrorStatus = useCallback(() => {
    dashboardApi
      .status()
      .then((d) => setMirrorStatus(d.mirror ?? null))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    onboardingApi.status().then((s) => setGitConfigured(s.gitConfigured)).catch(() => setGitConfigured(false));
    settingsApi.get().then(setSettings).catch((e) => console.warn(toApiError(e).detail));
    dashboardApi
      .status()
      .then((d) => setMirrorStatus(d.mirror ?? null))
      .catch(() => setMirrorStatus(null))
      .finally(() => setMirrorLoading(false));
  }, []);

  useEffect(() => {
    const section = searchParams.get("section");
    if (section && SECTIONS.some((s) => s.id === section)) {
      setSectionId(section as SectionId);
    }
  }, [searchParams]);

  useAttentionNavigation(sectionId);

  const afterOp = useCallback(
    (result: OperationResult) => {
      setLastResult(result);
      window.setTimeout(() => void refreshAttention(), 400);
    },
    [refreshAttention],
  );

  const onOpFailure = useCallback((result: OperationResult) => {
    setLastResult(result);
  }, []);

  const current = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0];
  const riskStatus = current.risk === "low" ? "pass" : "warn";
  const stagingHaType = settings?.topology.stagingHaType ?? "docker";
  const isDockerStaging = stagingHaType === "docker";
  const mirrorEnabled = settings?.mirror.enabled ?? false;
  const mirrorBroker = settings?.mirror.stagingMqttBrokerHost?.trim();
  const mirrorPort = settings?.mirror.stagingMqttPort ?? 1883;
  const showStorageRestart = Boolean(actionOrders["restart-staging"]);
  const isEntityDeploy = current.id === "entity-deploy";
  const [confirmBaseline, setConfirmBaseline] = useState(false);
  const [confirmResetWorkbench, setConfirmResetWorkbench] = useState(false);
  const [baselineRebuildStaging, setBaselineRebuildStaging] = useState(true);

  const openBaselineConfirm = () => {
    setBaselineRebuildStaging(true);
    setConfirmBaseline(true);
  };

  return (
    <div className={`dash dash-live-compact ops-page${isEntityDeploy ? " ops-page--entity-deploy" : ""}`}>
      <DashboardHeader
        compact
        kicker="Operations"
        title={current.title}
        subtitle={current.summary}
        stagingUrl={haUrls.stagingUrl}
        prodUrl={haUrls.prodUrl}
        headerExtra={<Chip status={riskStatus} label={riskLabel(current.risk)} />}
      />

      <nav className="diag-tabs" aria-label="Operations sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`diag-tab${s.id === sectionId ? " active" : ""}`}
            onClick={() => setSectionId(s.id)}
          >
            <span className="diag-tab-label">{s.title}</span>
            <SectionAttentionBadge count={sectionActionCount(s.id)} />
          </button>
        ))}
      </nav>

      {isEntityDeploy ? (
        <div className="ops-entity-deploy-workspace" id="ops-entity-deploy">
          <OpsCallout>
            <p>
              Compare git dashboard references against prod. <strong>Request release</strong> blocks only on{" "}
              <strong>new</strong> issues since the last prod deploy. The full scan (all mismatches) lives here for
              cleanup and migration export — prod stays read-only until the release agent runs.
            </p>
            <p className="muted">
              The <strong>Naming</strong> tab lists advisory prod cleanup (suffix collisions, cast renames) — it does not
              block deploy. Blocking issues are under Blocking / Awaiting.
            </p>
            <p className="muted">
              Ship to prod (commit → push → deploy) is on{" "}
              <Link to="/#deploy-flow-panel">Overview → Ship staging work to production</Link>.
            </p>
          </OpsCallout>
          {!gitConfigured && (
            <OpsCallout tone="warn">
              HA config git repo is not configured or not mounted. Set the repo path in Settings → Paths &amp; git first.
            </OpsCallout>
          )}
          <DeployLovelaceGatePanel
            active
            layout="workspace"
            refreshKey={0}
            onFixed={() => void refreshAttention()}
          />
        </div>
      ) : (
        <div className="ops-section-stack" id={`ops-${sectionId}`}>
          <OpsLastResultPanel result={lastResult} />

          {current.id === "baseline" && (
            <>
              <OpsCallout tone="warn">
                <strong>Destructive — use rarely.</strong> Exports live prod (YAML + Lovelace/helpers) into git and
                force-pushes <code>staging</code> and <code>main</code>. Clears release history and deploy-gate WIP.{" "}
                <strong>Prod is read-only</strong> — not modified.
                {baselineRebuildStaging ? (
                  <>
                    {" "}
                    With staging rebuild enabled: wipes staging recorder DB and <code>.storage</code> except auth, then
                    apply-config, storage sync, MQTT mirror, and restart staging HA.
                  </>
                ) : (
                  <> Git and GitHub only — use Config &amp; sync / Storage sync afterward to bring staging up.</>
                )}
              </OpsCallout>
              {!gitConfigured && (
                <OpsCallout tone="warn">
                  HA config git repo is not configured. Set the repo path in Settings → Paths &amp; git first.
                </OpsCallout>
              )}
              <OpsTaskPanel
                title="Baseline from prod"
                description={
                  <>
                    Use this when you want a clean workbench: git, GitHub, and staging all match prod today. Unlike{" "}
                    <strong>Reset workbench</strong>, this copies prod <em>into</em> git first — so deploy uses the same
                    dashboard prod actually runs.
                  </>
                }
                actions={
                  !confirmBaseline ? (
                    <button
                      type="button"
                      className="btn danger"
                      disabled={!gitConfigured}
                      onClick={openBaselineConfirm}
                    >
                      Baseline from prod…
                    </button>
                  ) : (
                    <div className="confirm-box">
                      <p className="msg err">
                        Local git WIP and unpushed commits will be replaced. GitHub <code>main</code> and{" "}
                        <code>staging</code> will be force-pushed to match prod. Release history is cleared.
                      </p>
                      <label className="ops-baseline-option">
                        <input
                          type="checkbox"
                          checked={baselineRebuildStaging}
                          onChange={(e) => setBaselineRebuildStaging(e.target.checked)}
                        />
                        <span>
                          <strong>Rebuild staging afterward</strong> — wipe staging DB and{" "}
                          <code>.storage</code> (auth kept), apply git config, prod storage sync, deploy MQTT mirror,
                          and restart staging HA. Uncheck if you only want git/GitHub aligned for now.
                        </span>
                      </label>
                      <div className="deploy-lovelace-gate-action-buttons">
                        <ActionButton
                          label={
                            baselineRebuildStaging
                              ? "Yes, baseline and rebuild staging"
                              : "Yes, baseline git only"
                          }
                          toastPreset="baseline-from-prod"
                          variant="danger"
                          disabled={!gitConfigured}
                          onRun={() =>
                            operationsApi.baselineFromProd({
                              pushToGitHub: true,
                              freshDatabase: baselineRebuildStaging,
                              deployMirror: baselineRebuildStaging,
                              rebuildStaging: baselineRebuildStaging,
                            })
                          }
                          onDone={(r) => {
                            setConfirmBaseline(false);
                            afterOp(r);
                          }}
                          onFailure={(r) => {
                            setConfirmBaseline(false);
                            onOpFailure(r);
                          }}
                        />
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => setConfirmBaseline(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )
                }
              >
                <OpsChecklist
                  items={[
                    "Last tab — only when git, GitHub, and staging have drifted badly",
                    "Requires prod SSH (export + secrets) and staging API token in Settings",
                    "With staging rebuild: .storage wiped except auth; regenerate staging LLAT if diagnostics show token errors",
                    "Without staging rebuild: run Apply config → Storage sync → Restart staging HA yourself",
                    "For a lighter reset (no prod → git export), use Reset workbench below",
                  ]}
                />
              </OpsTaskPanel>
              <OpsTaskPanel
                title="Reset workbench"
                description={
                  <>
                    Discards unsaved dashboard edits and Entity Janitor defer/undo state, re-applies git from GitHub{" "}
                    <strong>staging</strong> (not prod), and re-syncs prod registries/helpers to staging. Lighter than{" "}
                    <strong>Baseline from prod</strong> — does not export prod into git or force-push GitHub.
                  </>
                }
                actions={
                  !confirmResetWorkbench ? (
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={!gitConfigured}
                      onClick={() => setConfirmResetWorkbench(true)}
                    >
                      Reset workbench…
                    </button>
                  ) : (
                    <div className="confirm-box">
                      <p className="msg err">
                        Resets the dashboard draft to the last published staging version (unsaved local edits are lost),
                        clears Entity Janitor defer/undo, re-applies staging from the repo, and copies prod registries to
                        staging. Prod is not touched.
                      </p>
                      <div className="deploy-lovelace-gate-action-buttons">
                        <ActionButton
                          label="Yes, reset workbench"
                          toastPreset="reset-workbench"
                          variant="danger"
                          disabled={!gitConfigured}
                          onRun={operationsApi.resetWorkbench}
                          onDone={(r) => {
                            setConfirmResetWorkbench(false);
                            afterOp(r);
                          }}
                          onFailure={(r) => {
                            setConfirmResetWorkbench(false);
                            onOpFailure(r);
                          }}
                        />
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => setConfirmResetWorkbench(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )
                }
              >
                <OpsChecklist
                  items={[
                    "Use when local dashboard draft or Entity Janitor defer/undo is messy — not when git itself is wrong",
                    "Requires prod SSH for storage sync and staging API token in Settings",
                    "Does not modify prod — read-only from prod's perspective",
                    "For git/GitHub aligned with live prod, use Baseline from prod above instead",
                  ]}
                />
              </OpsTaskPanel>
            </>
          )}

          {current.id === "config-sync" && (
            <>
              <OpsCallout>
                Keep staging YAML and runtime person states aligned with prod. These run inside the kit container
                against your configured git repo and HA API tokens.
              </OpsCallout>
              {!gitConfigured && (
                <OpsCallout tone="warn">
                  HA config git repo is not configured. Set the repo path in Settings → Paths &amp; git before applying
                  config.
                </OpsCallout>
              )}
              <div className="ops-task-grid">
                <OpsTaskPanel
                  title="Apply staging config"
                  description={
                    <>
                      Checks out your <strong>staging</strong> git branch and rsyncs config into the staging HA config
                      directory.
                    </>
                  }
                  actions={
                    <ActionButton
                      label="Apply staging config"
                      toastPreset="apply-config"
                      onRun={operationsApi.applyConfig}
                      disabled={!gitConfigured}
                      attentionOrder={actionOrders["apply-config"]}
                      onDone={afterOp}
                      onFailure={onOpFailure}
                    />
                  }
                >
                  <OpsNote>
                    Also refreshes <code>secrets.yaml</code> from prod (SSH) and the kit runtime overlay.
                    {isDockerStaging
                      ? " Restart the staging Docker container afterward if YAML changed."
                      : " Restart staging HA afterward if YAML changed (Settings → System → Restart on HA OS)."}
                  </OpsNote>
                </OpsTaskPanel>
                <OpsTaskPanel
                  title="Person poll now"
                  description="One immediate sync of person and device_tracker states from prod → staging via REST."
                  actions={
                    <ActionButton
                      label="Person poll now"
                      toastPreset="person-poll"
                      onRun={operationsApi.personPoll}
                      attentionOrder={actionOrders["person-poll"]}
                      onDone={afterOp}
                      onFailure={onOpFailure}
                    />
                  }
                >
                  <OpsNote>
                    Phones only report to prod; polling copies their presence into staging so automations behave
                    realistically during testing.
                  </OpsNote>
                </OpsTaskPanel>
              </div>
              <OpsDetailsPanel summary="Typical config workflow">
                <OpsChecklist
                  items={[
                    "Edit YAML on staging branch in git (or on disk, then commit)",
                    "Apply staging config — pulls secrets from prod and rsyncs packages",
                    "Restart staging HA if YAML or packages changed",
                    "Run person poll if you need fresh presence without waiting for the scheduled poller",
                    "Use Storage sync (separate tab) when registries or Lovelace on disk diverge from prod",
                  ]}
                />
              </OpsDetailsPanel>
            </>
          )}

          {current.id === "storage-sync" && (
            <>
              <OpsCallout>
                Pulls a curated subset of prod <code>.storage</code> into staging over SSH — entity registry, device
                registry, MQTT credentials (for the mirror), person records, and related images.
              </OpsCallout>
              <OpsTaskPanel
                title="Run storage sync"
                description={
                  <>
                    <strong>Auth is not copied</strong> — staging keeps its own users and API tokens so the kit token
                    survives sync. See <code>docs/staging-prod-parity-rules.md</code> in the kit repo for the full sync
                    matrix.
                  </>
                }
                actions={
                  <>
                    <ActionButton
                      label="Run storage sync"
                      toastPreset="storage-sync"
                      onRun={operationsApi.storageSync}
                      attentionOrder={actionOrders["storage-sync"]}
                      onDone={afterOp}
                      onFailure={onOpFailure}
                    />
                    {showStorageRestart && (
                      <ActionButton
                        label="Restart staging HA"
                        toastPreset="restart-staging"
                        onRun={operationsApi.restartStaging}
                        attentionOrder={actionOrders["restart-staging"]}
                        onDone={afterOp}
                        onFailure={onOpFailure}
                      />
                    )}
                  </>
                }
              >
                <OpsCallout tone="warn">
                  Overwrites matching files in staging <code>.storage</code>. Prod copies MQTT broker hostname{" "}
                  <code>core-mosquitto</code> into <code>core.config_entries</code> — correct on prod HA OS but wrong on
                  staging when using the mirror.
                </OpsCallout>
                {mirrorEnabled && mirrorBroker ? (
                  <OpsCallout tone="info">
                    After sync, the kit re-applies the mirror broker at <code>{mirrorBroker}</code> so staging MQTT stays
                    on the kit, not prod. Restart staging HA if entities stay unavailable.
                  </OpsCallout>
                ) : mirrorEnabled ? (
                  <OpsCallout tone="warn">
                    Mirror is enabled but broker address could not be resolved — set prod and staging HA URLs in Settings.
                  </OpsCallout>
                ) : (
                  <OpsNote>MQTT broker patch runs only when the mirror is enabled in Settings.</OpsNote>
                )}
                <OpsChecklist
                  items={[
                    "Needed when staging is missing devices/entities that exist on prod",
                    "Updates MQTT integration credentials used by the mirror broker",
                    "Does not modify prod — read-only from prod's perspective",
                    ...(isDockerStaging
                      ? ["Docker staging: no Apps page — MQTT is under Devices & services, not the Add-on store"]
                      : []),
                  ]}
                />
                <OpsDetailsPanel summary="What gets synced — full file list">
                  <OpsNote>
                    Copied from prod over SSH (rsync). <strong>Not copied:</strong> <code>auth</code>,{" "}
                    <code>auth_provider.*</code>, <code>http.auth</code> (staging keeps kit LLATs),{" "}
                    <code>restore_state</code>, <code>bluetooth</code>, <code>counter</code>, and{" "}
                    <code>mobile_app</code> credentials. Person pictures sync via <code>image/</code>.
                  </OpsNote>
                  <p className="muted ops-details-lead">
                    Includes registries, Lovelace on disk, helpers, MQTT integration entries, and related UI storage:
                  </p>
                  <ul className="ops-file-list">
                    <li>
                      <code>core.config_entries</code>, <code>core.entity_registry</code>,{" "}
                      <code>core.device_registry</code>, area/floor/label/category registries
                    </li>
                    <li>
                      <code>lovelace.*</code>, <code>lovelace_dashboards</code>, <code>lovelace_resources</code>,{" "}
                      <code>frontend.user_data*</code>
                    </li>
                    <li>
                      <code>person</code>, <code>zone</code>, <code>timer</code>, input helpers,{" "}
                      <code>scheduler.storage</code>
                    </li>
                    <li>
                      <code>onboarding</code>, <code>core.config</code>, <code>http</code>,{" "}
                      <code>repairs.issue_registry</code>, and selected integration storage files
                    </li>
                  </ul>
                  <OpsNote>
                    After copy, <code>patch-staging-storage.sh</code> rewrites the MQTT broker when the mirror is
                    enabled; <code>preserve-staging-oauth-entries.sh</code> restores staging OAuth for allowlisted
                    cloud integrations. Full matrix: <code>docs/staging-prod-parity-rules.md</code>.
                  </OpsNote>
                </OpsDetailsPanel>
              </OpsTaskPanel>
            </>
          )}

          {current.id === "mqtt-mirror" && (
            <>
              <OpsCallout>
                The kit runs a local Mosquitto broker that bridges selected topics from prod. Staging HA connects to
                this broker (not prod directly) for live Zigbee and device state during testing.
              </OpsCallout>

              <OpsTaskPanel
                title="Deploy bridge"
                description="Regenerates bridge config from staging .storage and restarts mosquitto inside the kit container."
                actions={
                  <ActionButton
                    label="Deploy / refresh mirror"
                    toastPreset="refresh-mirror"
                    onRun={operationsApi.deployMirror}
                    attentionOrder={actionOrders["deploy-mirror"]}
                    onDone={afterOp}
                    onFailure={onOpFailure}
                  />
                }
              >
                <OpsNote>
                  Run after <strong>Storage sync</strong> or when prod MQTT credentials change. Staging must already
                  have MQTT integration entries in <code>.storage</code> — storage sync copies those from prod.
                </OpsNote>
              </OpsTaskPanel>

              <OpsTaskPanel
                title="Control mode"
                variant={mirrorStatus?.mode === "control" ? "danger" : "default"}
                description={
                  <>
                    <strong>Read-only</strong> (default) — prod → staging only; safe for everyday staging work.{" "}
                    <strong>Control mode</strong> — also forwards <code>zigbee2mqtt/+/set</code> to prod; real devices
                    can actuate. Turn off when finished testing.
                  </>
                }
                aside={
                  <MirrorControlModeToggle
                    layout="row"
                    mirror={mirrorStatus}
                    statusLoading={mirrorLoading}
                    onChanged={refreshMirrorStatus}
                  />
                }
              />

              {mirrorEnabled ? (
                <OpsDetailsPanel summary="Point staging HA at the mirror — step-by-step" defaultOpen>
                  <MqttMirrorInstructions
                    stagingHaType={stagingHaType}
                    brokerHost={mirrorBroker ?? undefined}
                    brokerPort={mirrorPort}
                  />
                </OpsDetailsPanel>
              ) : (
                <OpsNote>
                  Enable the mirror in Settings → MQTT mirror before pointing staging HA at the kit broker.
                </OpsNote>
              )}
            </>
          )}

          {current.id === "staging-ha" && (
            <>
              <OpsCallout>
                Restarts staging Home Assistant so configuration and integrations reload after apply, storage sync, or
                manual file edits. Does not restart prod or the kit container.
              </OpsCallout>
              <OpsTaskPanel
                title="Restart staging Home Assistant"
                description={
                  isDockerStaging
                    ? "Restarts the Docker container running staging Home Assistant."
                    : "Restarts the staging Home Assistant container when STAGING_HA_CONTAINER is set."
                }
                actions={
                  <ActionButton
                    label="Restart staging HA"
                    toastPreset="restart-staging"
                    onRun={operationsApi.restartStaging}
                    attentionOrder={actionOrders["restart-staging"]}
                    onDone={afterOp}
                    onFailure={onOpFailure}
                  />
                }
              >
                <OpsNote>
                  {isDockerStaging ? (
                    <>
                      Set <code>STAGING_HA_CONTAINER</code> in Settings → Advanced (e.g.{" "}
                      <code>Home-Assistant-Container</code>). The kit uses the host Docker socket to restart that
                      container.
                    </>
                  ) : (
                    <>
                      On HA OS staging you can also restart from <strong>Settings → System → Restart</strong> in the HA
                      UI. The kit button only works when a Docker container name is configured.
                    </>
                  )}
                </OpsNote>
                <OpsChecklist
                  items={[
                    "Use after Apply staging config when YAML packages changed",
                    "Use after Storage sync if MQTT entities stay unavailable",
                    "Expect staging to be unavailable for 30–90 seconds during restart",
                    "Does not restart prod or the kit container itself",
                  ]}
                />
              </OpsTaskPanel>
            </>
          )}
        </div>
      )}
    </div>
  );
}
