import { Link, useNavigate } from "react-router-dom";
import type { ConfigDriftStatus, GitSnapshot } from "../../api";
import { operationsApi, releaseAgentApi } from "../../api";
import { ActionButton } from "../ActionButton";
import { SectionAttentionBadge } from "../PageAttentionPanel";
import { useDeployFlow, type DeployFlowModel } from "../../hooks/useDeployFlow";

export function DeployFlowGateHint({
  flow,
  attentionOrder,
}: {
  flow: DeployFlowModel;
  attentionOrder?: number;
}) {
  if (!flow.gateHintVisible) return null;

  let detail: string;
  if (flow.gateStatus.busy) {
    detail = "Scanning prod entities…";
  } else if (flow.gateStatus.ok === false && flow.gateStatus.missingEntityCount > 0) {
    detail = `${flow.gateStatus.missingEntityCount} deploy blocker${flow.gateStatus.missingEntityCount === 1 ? "" : "s"} on prod — export migrations and clear blockers before release.`;
  } else if (flow.gateStatus.ok === false) {
    detail = "Entity deploy scan failed — review blockers before release.";
  } else {
    detail = "Entity deploy scan required before Lovelace or Zigbee2MQTT changes can ship.";
  }

  return (
    <div id="deploy-lovelace-gate" className="deploy-flow-gate-hint dash-panel">
      <div className="deploy-flow-gate-hint-body">
        <p className="deploy-flow-gate-hint-title">
          Entity deploy gate
          <SectionAttentionBadge order={attentionOrder} />
        </p>
        <p className="deploy-flow-gate-hint-text">{detail}</p>
      </div>
      <Link to="/operations?section=entity-deploy" className="btn secondary btn-compact">
        Open entity deploy gate
      </Link>
    </div>
  );
}

export function DeployFlowZ2mChecklist({ flow }: { flow: DeployFlowModel }) {
  if (!flow.z2mPending || !flow.deployState.pending || flow.deployBlockMsg) return null;

  return (
    <div className="deploy-lovelace-gate deploy-lovelace-gate--warn deploy-z2m-post-deploy dash-panel">
      <p className="deploy-lovelace-gate-title">After release — Zigbee2MQTT checklist</p>
      <ol className="deploy-lovelace-gate-fix-list">
        <li>Request release applies <code>zigbee2mqtt/configuration.yaml</code> via git reset.</li>
        <li>Restart the <strong>Zigbee2MQTT add-on</strong> on prod HA so the new friendly name loads.</li>
        <li>
          Return to <Link to="/operations?section=entity-deploy">Operations → Entity deploy gate</Link> to rescan if
          needed.
        </li>
        <li>
          Optional: rename any remaining HA entities (e.g. battery_low) in the HA UI — the kit does not rename prod
          entities automatically.
        </li>
      </ol>
    </div>
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
          {flow.canReleaseRollback && flow.releaseRollbackTarget && (
            <ActionButton
              label={`Rollback release (${flow.releaseRollbackTarget.shortSha})`}
              compact
              variant="secondary"
              title={`Restore prod to release #${flow.releaseRollbackTarget.index} (${flow.releaseRollbackTarget.shortSha})`}
              toastPreset="rollback-release"
              onRun={() => releaseAgentApi.rollback({ steps: 1 })}
              onDone={flow.bumpGate}
            />
          )}
          {!flow.canReleaseRollback && flow.git?.prodPreviousDeploySha && flow.prodWritesEnabled && (
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
          <div className="deploy-flow-compact-step-actions">
            <ActionButton
              label="Request release"
              compact
              disabled={!flow.canRequestRelease}
              title={flow.requestReleaseTitle}
              toastPreset="request-release"
              onRun={() => releaseAgentApi.apply({ gitRef: "origin/main" })}
              onDone={flow.bumpGate}
              onFailure={() => navigate("/diagnostics")}
            />
            {flow.prodWritesEnabled && (
              <ActionButton
                label="Deploy to prod (legacy)"
                compact
                variant="secondary"
                disabled={!flow.canLegacyDeploy}
                title={flow.legacyDeployTitle}
                toastPreset="deploy-prod"
                onRun={operationsApi.deployToProd}
                onDone={flow.bumpGate}
                onFailure={() => navigate("/diagnostics")}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** @deprecated Use DeployFlowGateHint + DeployFlowShipSection with useDeployFlow on the page. */
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
      <DeployFlowGateHint flow={flow} attentionOrder={attentionOrders?.gate} />
      <DeployFlowZ2mChecklist flow={flow} />
      <DeployFlowShipSection flow={flow} onOpenCommit={onOpenCommit} attentionOrders={attentionOrders} />
    </>
  );
}
