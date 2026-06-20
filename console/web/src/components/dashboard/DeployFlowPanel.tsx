import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import type { ConfigDriftStatus, GitSnapshot } from "../../api";
import { operationsApi, releaseAgentApi } from "../../api";
import { ActionButton } from "../ActionButton";
import { SectionAttentionBadge } from "../PageAttentionPanel";
import { useDeployFlow, type DeployFlowModel } from "../../hooks/useDeployFlow";
import { impactLevelClass, impactLevelLabel } from "../../lib/releaseImpact";
import { ReleaseConfirmDialog } from "./ReleaseConfirmDialog";
import { useToast } from "../Toast";
import { actionToast } from "../../lib/toastMessages";

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
    detail = "Checking Entity Janitor for this release…";
  } else if (flow.gateStatus.ok === false && flow.gateStatus.missingEntityCount > 0) {
    detail = `${flow.gateStatus.missingEntityCount} new blocker${flow.gateStatus.missingEntityCount === 1 ? "" : "s"} introduced by this release — fix before shipping.`;
  } else if (flow.gateStatus.ok === false) {
    detail = "Entity Janitor failed — review new blockers before release.";
  } else if ((flow.deployGate?.preExistingMissingCount ?? 0) > 0) {
    detail = `${flow.deployGate!.preExistingMissingCount} pre-existing entity mismatch(es) in git Lovelace — not blocking this release. Clean up in Operations when ready.`;
  } else {
    detail = "Entity Janitor check for this release.";
  }

  return (
    <div id="deploy-lovelace-gate" className="deploy-flow-gate-hint dash-panel">
      <div className="deploy-flow-gate-hint-body">
        <p className="deploy-flow-gate-hint-title">
          Entity Janitor
          <SectionAttentionBadge order={attentionOrder} />
        </p>
        <p className="deploy-flow-gate-hint-text">{detail}</p>
      </div>
      <Link to="/operations?section=entity-deploy" className="btn secondary btn-compact">
        Open Entity Janitor
      </Link>
    </div>
  );
}

export function DeployFlowImpactPreview({
  flow,
  attentionOrder,
}: {
  flow: DeployFlowModel;
  attentionOrder?: number;
}) {
  if (!flow.impactPreviewVisible) return null;

  const impact = flow.impactPreview;
  const busy = flow.impactBusy && !impact;

  return (
    <div id="release-impact-preview" className={`deploy-flow-impact dash-panel ${impact ? impactLevelClass(impact.impactLevel) : ""}`}>
      <div className="deploy-flow-impact-head">
        <p className="deploy-flow-impact-title">
          Release impact
          <SectionAttentionBadge order={attentionOrder} />
        </p>
        {impact && (
          <span className={`dash-badge deploy-flow-impact-badge deploy-flow-impact-badge--${impact.impactLevel}`}>
            {impactLevelLabel(impact.impactLevel)}
          </span>
        )}
      </div>
      {busy ? (
        <p className="deploy-flow-impact-text muted">Checking what this release would change on prod…</p>
      ) : impact ? (
        <>
          <p className="deploy-flow-impact-summary">{impact.summary}</p>
          {impact.blockers.length > 0 && (
            <div className="deploy-flow-impact-section">
              <p className="deploy-flow-impact-section-title">Known breakages — release blocked</p>
              <ul className="deploy-flow-impact-list">
                {impact.blockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {impact.warnings.length > 0 && (
            <div className="deploy-flow-impact-section">
              <p className="deploy-flow-impact-section-title">
                {impact.blocksRelease ? "Additional notes" : "Review before confirming"}
              </p>
              <ul className="deploy-flow-impact-list">
                {impact.warnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {impact.requiresConfirm && !impact.blocksRelease && (
            <p className="deploy-flow-impact-foot muted">
              Click Request release to open a confirmation dialog with the full checklist.
            </p>
          )}
        </>
      ) : (
        <p className="deploy-flow-impact-text muted">Could not load release impact preview.</p>
      )}
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
          Return to <Link to="/operations?section=entity-deploy">Operations → Entity Janitor</Link> to rescan if
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
  const { push } = useToast();
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);

  useEffect(() => {
    setReleaseDialogOpen(false);
  }, [flow.gateRefreshKey]);

  const runRelease = async () => {
    setReleaseBusy(true);
    try {
      const result = await releaseAgentApi.apply({ gitRef: "origin/main" });
      const fallback = result.message || (result.ok ? "Done" : "Action failed");
      const toast = actionToast("request-release", result.ok, fallback);
      push({ message: result.message?.trim() ? result.message : toast.message, tone: toast.tone, icon: toast.icon });
      if (result.ok) {
        setReleaseDialogOpen(false);
        flow.bumpGate();
      } else {
        setReleaseDialogOpen(false);
        navigate("/diagnostics");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Action failed";
      const toast = actionToast("request-release", false, msg);
      push({ message: toast.message, tone: "err", icon: toast.icon });
      setReleaseDialogOpen(false);
      navigate("/diagnostics");
    } finally {
      setReleaseBusy(false);
    }
  };

  const handleRequestReleaseClick = () => {
    if (flow.impactPreview?.requiresConfirm || (flow.impactPreview?.warnings.length ?? 0) > 0) {
      setReleaseDialogOpen(true);
      return;
    }
    void runRelease();
  };

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
            <button
              type="button"
              className="btn primary btn-compact"
              disabled={!flow.canRequestRelease || releaseBusy}
              title={flow.requestReleaseTitle}
              onClick={handleRequestReleaseClick}
            >
              {releaseBusy ? "Running…" : "Request release"}
            </button>
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
      <ReleaseConfirmDialog
        open={releaseDialogOpen}
        busy={releaseBusy}
        impact={flow.impactPreview}
        onClose={() => {
          if (!releaseBusy) setReleaseDialogOpen(false);
        }}
        onConfirm={() => void runRelease()}
      />
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
    impact?: number;
    prod?: number;
  };
}) {
  const flow = useDeployFlow({ git, configDrift, onDone });
  if (!gitConfigured) return null;

  return (
    <>
      <DeployFlowGateHint flow={flow} attentionOrder={attentionOrders?.gate} />
      <DeployFlowImpactPreview flow={flow} attentionOrder={attentionOrders?.impact} />
      <DeployFlowZ2mChecklist flow={flow} />
      <DeployFlowShipSection flow={flow} onOpenCommit={onOpenCommit} attentionOrders={attentionOrders} />
    </>
  );
}
