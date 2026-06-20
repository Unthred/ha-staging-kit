import { useEffect, useRef } from "react";
import type { ReleaseImpactPreviewResult } from "../../api";
import { impactLevelClass, impactLevelLabel } from "../../lib/releaseImpact";

function buildReleaseSteps(impact: ReleaseImpactPreviewResult): string[] {
  const steps: string[] = [];
  const mergesStaging = impact.warnings.some((w) => w.includes("merges GitHub staging"));

  if (mergesStaging) steps.push("Merge GitHub staging into main");
  if (impact.willRunManifests.length > 0) {
    steps.push(`Run migrations: ${impact.willRunManifests.join(", ")}`);
  }
  if (impact.yamlDeploy) steps.push("Deploy HA YAML config to prod via git reset");
  if (impact.lovelaceBundleDeploy) steps.push("Deploy Lovelace .storage bundle to prod");
  if (impact.helpersDeploy) steps.push("Update helper .storage files on prod");
  if (impact.z2mConfigDeploy) steps.push("Apply Zigbee2MQTT configuration.yaml on prod");
  if (impact.requiresRegistryStop) {
    steps.push("Stop Home Assistant Core briefly for registry migration work");
  }
  if (impact.requiresProdRestart || impact.lovelaceBundleDeploy || impact.helpersDeploy) {
    steps.push("Restart prod Home Assistant Core to apply changes");
  }
  if (steps.length === 0) steps.push("Apply GitHub main to prod Home Assistant");
  return steps;
}

export function ReleaseConfirmDialog({
  open,
  busy,
  impact,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  impact: ReleaseImpactPreviewResult | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!impact) return null;

  const steps = buildReleaseSteps(impact);
  const advisoryWarnings = impact.warnings.filter(
    (w) => !w.includes("merges GitHub staging into main first"),
  );

  return (
    <dialog
      ref={dialogRef}
      className="release-confirm-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current && !busy) onClose();
      }}
    >
      <div className="release-confirm-dialog-panel" onClick={(e) => e.stopPropagation()}>
        <header className="release-confirm-dialog-head">
          <div>
            <div className="release-confirm-dialog-title-row">
              <h3>Confirm release to prod</h3>
              <span className={`dash-badge deploy-flow-impact-badge deploy-flow-impact-badge--${impact.impactLevel}`}>
                {impactLevelLabel(impact.impactLevel)}
              </span>
            </div>
            <p className="muted">{impact.summary}</p>
          </div>
          <button
            type="button"
            className="btn secondary dash-git-files-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            Close
          </button>
        </header>

        <div className={`release-confirm-dialog-body ${impactLevelClass(impact.impactLevel)}`}>
          {busy ? (
            <p className="release-confirm-dialog-busy">Running release — merging staging, deploying to prod, and recording history…</p>
          ) : (
            <>
              <section className="release-confirm-dialog-section">
                <h4>What will happen</h4>
                <ol className="release-confirm-dialog-steps">
                  {steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </section>

              {impact.blockers.length > 0 && (
                <section className="release-confirm-dialog-section release-confirm-dialog-section--blocked">
                  <h4>Release blocked</h4>
                  <ul className="deploy-flow-impact-list">
                    {impact.blockers.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              )}

              {advisoryWarnings.length > 0 && (
                <section className="release-confirm-dialog-section">
                  <h4>Review before confirming</h4>
                  <ul className="deploy-flow-impact-list release-confirm-dialog-warnings">
                    {advisoryWarnings.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              )}

              {!impact.blocksRelease && (
                <p className="release-confirm-dialog-note muted">
                  Pre-existing entity mismatches in git Lovelace do not block this release.
                </p>
              )}
            </>
          )}
        </div>

        <footer className="release-confirm-dialog-actions">
          <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || impact.blocksRelease}
            onClick={onConfirm}
          >
            {busy ? "Running release…" : "Yes, request release"}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
