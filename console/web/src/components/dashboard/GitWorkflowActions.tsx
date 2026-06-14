import { useState } from "react";
import { operationsApi, toApiError, type ConfigDriftStatus, type GitSnapshot } from "../../api";
import { canDeployToProd, canShipToStaging, shipToStagingSummary } from "../../lib/gitWorkflow";
import { actionToast } from "../../lib/toastMessages";
import { useToast } from "../Toast";

export function GitWorkflowActions({
  git,
  drift,
  onDone,
  compact = false,
  showLead = true,
}: {
  git?: GitSnapshot | null;
  drift?: ConfigDriftStatus | null;
  onDone?: () => void;
  compact?: boolean;
  showLead?: boolean;
}) {
  const [confirmShip, setConfirmShip] = useState(false);
  const [confirmProd, setConfirmProd] = useState(false);
  const [busy, setBusy] = useState<"ship" | "prod" | null>(null);
  const { push } = useToast();

  const shipEnabled = canShipToStaging(git, drift);
  const prodEnabled = canDeployToProd(git, drift);

  const runShip = async () => {
    setBusy("ship");
    try {
      const result = await operationsApi.shipToStaging();
      const fallback = result.message || (result.ok ? "Shipped to staging" : "Ship to staging failed");
      const t = actionToast("ship-staging", result.ok, fallback);
      push({ message: t.message, tone: t.tone, icon: t.icon });
      if (result.ok) {
        setConfirmShip(false);
        onDone?.();
      }
    } catch (e) {
      push({ message: toApiError(e).detail, tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  const runDeployProd = async () => {
    setBusy("prod");
    try {
      const result = await operationsApi.deployToProd();
      const fallback = result.message || (result.ok ? "Deployed to prod" : "Deploy to prod failed");
      const t = actionToast("deploy-prod", result.ok, fallback);
      push({ message: t.message, tone: t.tone, icon: t.icon });
      if (result.ok) {
        setConfirmProd(false);
        onDone?.();
      }
    } catch (e) {
      push({ message: toApiError(e).detail, tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  if (!git?.configured) return null;

  const hint = !shipEnabled
    ? git.isDirty
      ? "Commit first."
      : "Staging matches git."
    : null;

  const prodHint = !prodEnabled && git
    ? git.isDirty
      ? "Commit first."
      : (git.commitsAhead ?? 0) > 0
        ? "Ship to staging first."
        : drift?.hasDrift
          ? "Apply staging first."
          : null
    : null;

  return (
    <div className={`dash-git-workflow ${compact ? "dash-git-workflow-compact" : ""}`}>
      {!compact && showLead && (
        <p className="dash-git-workflow-lead muted">Push, apply, and restart — confirm before prod deploy.</p>
      )}

      <div className="dash-git-workflow-actions">
        <button
          type="button"
          className="btn dash-git-workflow-btn"
          disabled={!shipEnabled || busy !== null}
          title={hint ?? undefined}
          onClick={() => {
            setConfirmProd(false);
            setConfirmShip(true);
          }}
        >
          Ship to staging
        </button>
        <button
          type="button"
          className="btn danger dash-git-workflow-btn"
          disabled={!prodEnabled || busy !== null}
          title={prodHint ?? undefined}
          onClick={() => {
            setConfirmShip(false);
            setConfirmProd(true);
          }}
        >
          Deploy to prod
        </button>
      </div>

      {confirmShip && (
        <div className="confirm-box dash-git-workflow-confirm">
          <p className="dash-git-workflow-confirm-title">Ship to staging?</p>
          <p className="muted dash-git-workflow-confirm-detail">{shipToStagingSummary(git, drift)}</p>
          <div className="dash-git-workflow-confirm-actions">
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void runShip()}>
              {busy === "ship" ? "Shipping…" : "Yes, ship"}
            </button>
            <button type="button" className="btn secondary" disabled={busy !== null} onClick={() => setConfirmShip(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {confirmProd && (
        <div className="confirm-box dash-git-workflow-confirm">
          <p className="dash-git-workflow-confirm-title dash-git-workflow-confirm-danger">Deploy to production?</p>
          <p className="muted dash-git-workflow-confirm-detail">
            Merges <code>{git.branch ?? "staging"}</code> → <code>main</code>, pushes to GitHub, triggers Actions to HA
            Green.
          </p>
          <div className="dash-git-workflow-confirm-actions">
            <button type="button" className="btn danger" disabled={busy !== null} onClick={() => void runDeployProd()}>
              {busy === "prod" ? "Deploying…" : "Yes, deploy"}
            </button>
            <button type="button" className="btn secondary" disabled={busy !== null} onClick={() => setConfirmProd(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
