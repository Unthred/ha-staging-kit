import { useState } from "react";
import { operationsApi, type ProdEntityNamingIssue } from "../../api";
import {
  canExportMigrationFromNaming,
  exportMigrationNamingBody,
} from "../../lib/migrationExport";
import { ActionButton } from "../ActionButton";
import { ExportMigrationPanel } from "./ExportMigrationPanel";

export function prodNamingKindLabel(kind: string): string {
  switch (kind) {
    case "suffix_collision":
      return "Suffix collision (_2)";
    case "cast_numeric_suffix":
      return "Cast should be _cast";
    default:
      return "Naming issue";
  }
}

export function prodNamingIssueKey(issue: { kind: string; primaryEntityId: string }): string {
  return `${issue.kind}:${issue.primaryEntityId}`;
}

export type ProdNamingIssueDetailBodyProps = {
  issue: ProdEntityNamingIssue;
  fixBusy?: boolean;
  allowProdFix?: boolean;
  prodWritesLockMessage?: string | null;
  onProdFixDone?: () => void;
  onProdFixFailure?: () => void;
  onExportDone?: () => void;
};

export function ProdNamingIssueDetailBody({
  issue,
  fixBusy = false,
  allowProdFix = false,
  prodWritesLockMessage,
  onProdFixDone,
  onProdFixFailure,
  onExportDone,
}: ProdNamingIssueDetailBodyProps) {
  const [confirmProdFix, setConfirmProdFix] = useState(false);

  const expectedId = issue.expectedEntityId ?? issue.primaryEntityId;
  const wrongId = issue.wrongEntityId ?? issue.primaryEntityId;

  return (
    <>
      <header className="deploy-lovelace-gate-detail-head">
        <code>{issue.primaryEntityId}</code>
        <span className={`deploy-lovelace-gate-kind deploy-lovelace-gate-kind--prod_typo`}>
          {prodNamingKindLabel(issue.kind)}
        </span>
      </header>

      <p className="deploy-lovelace-gate-suggestion">{issue.summary}</p>

      {issue.deviceName && (
        <p className="muted">
          Device: <strong>{issue.deviceName}</strong>
          {issue.livePlatform ? ` · ${issue.livePlatform}` : ""}
        </p>
      )}

      <div className="deploy-lovelace-gate-manual-fix">
        <h5>What to do</h5>
        <p>{issue.manualFixSummary}</p>
        {issue.prodFixSteps.length > 0 && (
          <div className="deploy-lovelace-gate-prod-fix-steps">
            <h5>Fix on prod</h5>
            <p className="muted">
              Numeric suffixes like `_2` usually mean a stale entity was not deleted. Cast integrations on the same
              Shield should use `_cast` (see <code>zaphod_shield_cast</code>). The kit can apply safe registry fixes
              with confirmation — prod HA stops briefly.
            </p>
            <ol>
              {issue.prodFixSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {issue.prodFixAction && issue.expectedEntityId && issue.wrongEntityId && (
              <div className="deploy-lovelace-gate-prod-fix-action">
                {canExportMigrationFromNaming(issue) && (
                  <ExportMigrationPanel
                    request={exportMigrationNamingBody(issue)}
                    disabled={fixBusy}
                    onDone={onExportDone}
                  />
                )}
                {!allowProdFix ? (
                  <p className="muted deploy-lovelace-gate-prod-locked">
                    {prodWritesLockMessage ?? "Prod writes are locked — enable in Settings → Release safety."}
                  </p>
                ) : !confirmProdFix ? (
                  <button
                    type="button"
                    className="btn primary btn-compact"
                    disabled={fixBusy}
                    onClick={() => setConfirmProdFix(true)}
                  >
                    Fix entity id on prod…
                  </button>
                ) : (
                  <div className="confirm-box">
                    <p className="msg err">
                      {issue.prodFixAction === "suffix-collision" ? (
                        <>
                          Stops prod HA briefly. Removes stale <code>{issue.blockerEntityId}</code>
                          {issue.blockerPlatform ? ` (${issue.blockerPlatform})` : ""} and renames{" "}
                          <code>{issue.wrongEntityId}</code> → <code>{issue.expectedEntityId}</code> in the entity
                          registry. Backup: <code>.bak-kit-suffix-fix</code> on prod.
                        </>
                      ) : (
                        <>
                          Stops prod HA briefly. Renames <code>{issue.wrongEntityId}</code> →{" "}
                          <code>{issue.expectedEntityId}</code> in core.entity_registry. Backup:{" "}
                          <code>.bak-kit-entity-rename</code> on prod.
                        </>
                      )}
                    </p>
                    <div className="deploy-lovelace-gate-action-buttons">
                      <ActionButton
                        label="Yes, fix prod entity id"
                        toastPreset={
                          issue.prodFixAction === "suffix-collision"
                            ? "fix-prod-entity-suffix"
                            : "fix-prod-entity-id"
                        }
                        onRun={() =>
                          issue.prodFixAction === "suffix-collision"
                            ? operationsApi.fixProdEntitySuffix(expectedId, wrongId)
                            : operationsApi.fixProdEntityId(expectedId, wrongId, true)
                        }
                        onDone={() => {
                          setConfirmProdFix(false);
                          onProdFixDone?.();
                        }}
                        onFailure={() => onProdFixFailure?.()}
                      />
                      <button
                        type="button"
                        className="btn secondary btn-compact"
                        onClick={() => setConfirmProdFix(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {issue.gitReferences.length > 0 && (
        <div className="deploy-lovelace-gate-ref-list-wrap">
          <h5>Git references</h5>
          <ul className="deploy-lovelace-gate-ref-list">
            {issue.gitReferences.map((id) => (
              <li key={id}>
                <code>{id}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
