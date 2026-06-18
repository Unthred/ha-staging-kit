import { useNavigate } from "react-router-dom";
import type { ConfigDriftStatus, GitSnapshot } from "../../api";
import { operationsApi } from "../../api";
import { ActionButton } from "../ActionButton";
import { SectionAttentionBadge } from "../PageAttentionPanel";
import { DeployLovelaceGatePanel } from "./DeployLovelaceGatePanel";
import { useDeployFlow, type DeployFlowModel } from "../../hooks/useDeployFlow";

export function DeployFlowGateSection({
  flow,
  attentionOrder,
}: {
  flow: DeployFlowModel;
  attentionOrder?: number;
}) {
  return (
    <>
      <div id="deploy-lovelace-gate">
        <DeployLovelaceGatePanel
          active={flow.gateRelevant}
          refreshKey={flow.gateRefreshKey}
          onStatusChange={flow.setGateStatus}
          onFixed={flow.bumpGate}
          attentionOrder={attentionOrder}
        />
      </div>

      {flow.z2mPending && flow.deployState.pending && !flow.deployBlockMsg && (
        <div className="deploy-lovelace-gate deploy-lovelace-gate--warn deploy-z2m-post-deploy">
          <p className="deploy-lovelace-gate-title">After deploy — Zigbee2MQTT checklist</p>
          <ol className="deploy-lovelace-gate-fix-list">
            <li>Deploy to prod applies <code>zigbee2mqtt/configuration.yaml</code> via git reset.</li>
            <li>Restart the <strong>Zigbee2MQTT add-on</strong> on prod HA so the new friendly name loads.</li>
            <li>Return to Overview — entity scan refreshes automatically.</li>
            <li>
              Optional: rename any remaining HA entities (e.g. battery_low) in the HA UI — the kit does not rename
              prod entities automatically.
            </li>
          </ol>
        </div>
      )}
    </>
  );
}

export function DeployFlowShipSection({
  flow,
  onOpenCommit,
  attentionOrders,
}: {
  flow: DeployFlowModel;
  onOpenCommit?: () => void;
  attentionOrders?: {
    commit?: number;
    push?: number;
    prod?: number;
  };
}) {
  const navigate = useNavigate();

  return (
    <section id="deploy-flow-panel" className="dash-panel deploy-flow-panel deploy-flow-panel--compact">
      <header className="deploy-flow-compact-head">
        <h3>Ship staging work to production</h3>
        <div className="deploy-flow-compact-head-actions">
          {flow.git?.prodPreviousDeploySha && (
            <ActionButton
              label={`Rollback prod (${flow.git.prodPreviousDeploySha.slice(0, 7)})`}
              compact
              variant="secondary"
              title="Restore prod HA to the previous successful deploy (includes dashboard .storage)"
              toastPreset="rollback-prod"
              onRun={operationsApi.rollbackProd}
              onDone={flow.bumpGate}
            />
          )}
          {flow.allDone && <span className="dash-badge dash-badge-ok">All done</span>}
        </div>
      </header>
      <div className="deploy-flow-compact">
        <div className={`deploy-flow-compact-step deploy-step-compact--${flow.step1State}`}>
          <div className="deploy-flow-compact-body">
            <span className="deploy-flow-compact-title">
              Staging
              <SectionAttentionBadge order={attentionOrders?.commit} />
            </span>
            <span className="deploy-flow-compact-text">{flow.step1Text}</span>
          </div>
          <button
            type="button"
            className="btn primary btn-compact"
            disabled={!flow.git?.isDirty}
            onClick={onOpenCommit}
          >
            Commit staging files
          </button>
        </div>
        <span className="deploy-flow-compact-arrow" aria-hidden="true">
          ›
        </span>
        <div className={`deploy-flow-compact-step deploy-step-compact--${flow.step2State}`}>
          <div className="deploy-flow-compact-body">
            <span className="deploy-flow-compact-title">
              GitHub
              <SectionAttentionBadge order={attentionOrders?.push} />
            </span>
            <span className="deploy-flow-compact-text">{flow.step2Text}</span>
          </div>
          <ActionButton
            label="Push to GitHub"
            compact
            disabled={(flow.git?.commitsAhead ?? 0) === 0}
            toastPreset="push-github"
            onRun={operationsApi.pushToGitHub}
            onDone={flow.bumpGate}
          />
        </div>
        <span className="deploy-flow-compact-arrow" aria-hidden="true">
          ›
        </span>
        <div className={`deploy-flow-compact-step deploy-step-compact--${flow.step3State}`}>
          <div className="deploy-flow-compact-body">
            <span className="deploy-flow-compact-title">
              Prod
              <SectionAttentionBadge order={attentionOrders?.prod} />
            </span>
            <span className="deploy-flow-compact-text">{flow.step3Text}</span>
          </div>
          <ActionButton
            label="Deploy to prod"
            compact
            disabled={!flow.canDeploy}
            title={flow.deployTitle}
            toastPreset="deploy-prod"
            onRun={operationsApi.deployToProd}
            onDone={flow.bumpGate}
            onFailure={() => navigate("/diagnostics")}
          />
        </div>
      </div>
    </section>
  );
}

/** @deprecated Use DeployFlowGateSection + DeployFlowShipSection with useDeployFlow on the page. */
export function DeployFlowPanel({
  git,
  gitConfigured,
  configDrift,
  onDone,
  onOpenCommit,
  attentionOrders,
}: {
  git?: GitSnapshot | null;
  gitConfigured?: boolean;
  configDrift?: ConfigDriftStatus | null;
  onDone?: () => void;
  onOpenCommit?: () => void;
  attentionOrders?: {
    commit?: number;
    push?: number;
    gate?: number;
    prod?: number;
  };
}) {
  const flow = useDeployFlow({ git, configDrift, onDone });
  if (!gitConfigured) return null;

  return (
    <>
      <DeployFlowGateSection flow={flow} attentionOrder={attentionOrders?.gate} />
      <DeployFlowShipSection flow={flow} onOpenCommit={onOpenCommit} attentionOrders={attentionOrders} />
    </>
  );
}
