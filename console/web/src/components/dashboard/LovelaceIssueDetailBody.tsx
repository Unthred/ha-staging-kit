import { useState } from "react";
import {
  operationsApi,
  type LovelaceFixOption,
  type LovelaceMissingEntityIssue,
} from "../../api";
import {
  canExportMigrationFromDeployGate,
  exportMigrationDeployGateBody,
} from "../../lib/migrationExport";
import { ActionButton } from "../ActionButton";
import { ExportMigrationPanel } from "./ExportMigrationPanel";

function kindLabel(kind: string, issueClass?: string): string {
  switch (issueClass ?? kind) {
    case "git_wrong_name":
      return "Dashboard mismatch";
    case "prod_typo":
      return "Fix on prod";
    case "missing_on_prod":
      return "Missing on prod";
    case "staging_only":
      return "Staging only";
    case "rename":
      return "Dashboard wrong name";
    case "remove":
      return "Remove stale card";
    case "add_on_prod":
      return "Add on prod or remove";
    case "deferred":
      return "Deferred";
    default:
      return "Review";
  }
}

function referenceLabel(ref: { dashboard?: string | null; view: string; cardTitle?: string | null; cardType?: string | null }): string {
  const parts: string[] = [];
  if (ref.dashboard) parts.push(ref.dashboard);
  parts.push(ref.view);
  if (ref.cardTitle) parts.push(`“${ref.cardTitle}”`);
  else if (ref.cardType) parts.push(ref.cardType);
  return parts.join(" → ");
}

function sourceLabel(source: string): string {
  return source.replace(/^\.storage\//, "");
}

export type LovelaceIssueDetailBodyProps = {
  issue: LovelaceMissingEntityIssue;
  isDeferred: boolean;
  measure?: boolean;
  awaitingPublishAction?: string | null;
  confirmPurgeDeleted?: boolean;
  setConfirmPurgeDeleted?: (value: boolean) => void;
  allowProdRegistryPurge?: boolean;
  allowProdFix?: boolean;
  prodWritesLockMessage?: string;
  selectedChoiceId?: string | null;
  setSelectedChoiceId?: (entityId: string) => void;
  selectedChoice?: { entityId: string } | null;
  fixBusy?: boolean;
  onApplyEntityChoice?: () => void;
  onFixOption?: (option: LovelaceFixOption) => void;
  onPurgeDone?: () => void;
  onPurgeFailure?: () => void;
  onProdSuffixFixDone?: () => void;
  onProdSuffixFixFailure?: () => void;
  onExportDone?: () => void;
};

function awaitingFixLabel(action?: string | null): string {
  if (!action) return "Awaiting publish";
  switch (action.toLowerCase()) {
    case "rename":
      return "Awaiting publish — rename";
    case "remove":
      return "Awaiting publish — remove";
    case "defer":
      return "Awaiting publish — deferred";
    case "fixed":
      return "Awaiting publish — fixed";
    default:
      return `Awaiting publish — ${action}`;
  }
}

export function LovelaceIssueDetailBody({
  issue,
  isDeferred,
  measure = false,
  awaitingPublishAction,
  confirmPurgeDeleted = false,
  setConfirmPurgeDeleted,
  allowProdRegistryPurge = false,
  allowProdFix = false,
  prodWritesLockMessage,
  selectedChoiceId,
  setSelectedChoiceId,
  selectedChoice,
  fixBusy = false,
  onApplyEntityChoice,
  onFixOption,
  onPurgeDone,
  onPurgeFailure,
  onProdSuffixFixDone,
  onProdSuffixFixFailure,
  onExportDone,
}: LovelaceIssueDetailBodyProps) {
  const [confirmProdSuffixFix, setConfirmProdSuffixFix] = useState(false);
  return (
    <>
      <header className="deploy-lovelace-gate-detail-head">
        <code>{issue.entityId}</code>
        <span
          className={`deploy-lovelace-gate-kind deploy-lovelace-gate-kind--${isDeferred ? "deferred" : issue.issueClass}`}
        >
          {awaitingPublishAction
            ? awaitingFixLabel(awaitingPublishAction)
            : isDeferred
              ? kindLabel("deferred")
              : kindLabel(issue.suggestionKind, issue.issueClass)}
        </span>
      </header>

      <p className="deploy-lovelace-gate-suggestion">
        {isDeferred
          ? "Deferred — still on the dashboard but excluded from the deploy gate until you restore it."
          : issue.suggestion}
      </p>

      {!isDeferred && issue.manualFixSummary && (
        <div className="deploy-lovelace-gate-manual-fix">
          <h5>What to do</h5>
          <p>{issue.manualFixSummary}</p>
          {canExportMigrationFromDeployGate(issue) && (
            <ExportMigrationPanel
              request={exportMigrationDeployGateBody(issue)}
              disabled={measure || fixBusy}
              onDone={onExportDone}
            />
          )}
          {(issue.prodContext?.prodFixSteps?.length ?? 0) > 0 && (
            <div className="deploy-lovelace-gate-prod-fix-steps">
              <h5>Fix on prod before deploy</h5>
              <p className="muted">
                The kit can fix some prod registry issues automatically (with your confirmation). Deploy still only
                pushes the dashboard bundle — run prod fixes here or via the steps below, then Recheck.
              </p>
              <ol>
                {issue.prodContext!.prodFixSteps!.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {issue.prodContext?.similarProdEntityId && issue.prodContext?.prodFixAction && (
                <div className="deploy-lovelace-gate-prod-fix-action">
                  {!allowProdFix ? (
                    <p className="muted deploy-lovelace-gate-prod-locked">
                      {prodWritesLockMessage ?? "Prod writes are locked — enable in Settings → Release safety."}
                    </p>
                  ) : !confirmProdSuffixFix ? (
                    <button
                      type="button"
                      className="btn primary btn-compact"
                      disabled={measure || fixBusy}
                      tabIndex={measure ? -1 : undefined}
                      onClick={() => setConfirmProdSuffixFix(true)}
                    >
                      Fix entity id on prod…
                    </button>
                  ) : (
                    <div className="confirm-box">
                      <p className="msg err">
                        {issue.prodContext.prodFixAction === "suffix-collision" ? (
                          <>
                            Stops prod HA briefly. Removes stale <code>{issue.entityId}</code> (
                            {issue.prodContext?.entityIdOccupiedByPlatform ?? "blocker"}) and renames{" "}
                            <code>{issue.prodContext?.similarProdEntityId}</code> → <code>{issue.entityId}</code> in
                            the entity registry. Backup: <code>.bak-kit-suffix-fix</code> on prod.
                          </>
                        ) : (
                          <>
                            Stops prod HA briefly. Renames <code>{issue.prodContext?.similarProdEntityId}</code> →{" "}
                            <code>{issue.entityId}</code> in core.entity_registry (unique_id{" "}
                            <code>{issue.prodContext?.uniqueId}</code> unchanged). Backup:{" "}
                            <code>.bak-kit-entity-rename</code> on prod.
                          </>
                        )}
                      </p>
                      <div className="deploy-lovelace-gate-action-buttons">
                        <ActionButton
                          label="Yes, fix prod entity id"
                          toastPreset={
                            issue.prodContext.prodFixAction === "suffix-collision"
                              ? "fix-prod-entity-suffix"
                              : "fix-prod-entity-id"
                          }
                          onRun={() =>
                            issue.prodContext!.prodFixAction === "suffix-collision"
                              ? operationsApi.fixProdEntitySuffix(
                                  issue.entityId,
                                  issue.prodContext!.similarProdEntityId!,
                                )
                              : operationsApi.fixProdEntityId(
                                  issue.entityId,
                                  issue.prodContext!.similarProdEntityId!,
                                )
                          }
                          onDone={() => {
                            setConfirmProdSuffixFix(false);
                            onProdSuffixFixDone?.();
                          }}
                          onFailure={() => onProdSuffixFixFailure?.()}
                        />
                        <button
                          type="button"
                          className="btn secondary btn-compact"
                          onClick={() => setConfirmProdSuffixFix(false)}
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
          {issue.prodContext && (
            <details className="deploy-lovelace-gate-prod-meta-details">
              <summary>Prod entity details</summary>
              <ul className="deploy-lovelace-gate-prod-meta muted">
                {issue.prodContext.similarProdEntityId && (
                  <li>
                    Prod entity: <code>{issue.prodContext.similarProdEntityId}</code>
                  </li>
                )}
                {issue.prodContext.platform && <li>Platform: {issue.prodContext.platform}</li>}
                {issue.prodContext.deviceName && <li>Device: {issue.prodContext.deviceName}</li>}
                {issue.prodContext.uniqueId && (
                  <li>
                    unique_id: <code>{issue.prodContext.uniqueId}</code>
                  </li>
                )}
                {issue.prodContext.entityIdOccupiedBy && (
                  <li>
                    Name blocked by: <code>{issue.prodContext.entityIdOccupiedBy}</code>
                    {issue.prodContext.entityIdOccupiedByPlatform
                      ? ` (${issue.prodContext.entityIdOccupiedByPlatform}${
                          issue.prodContext.entityIdOccupiedByDisabledBy
                            ? `, ${issue.prodContext.entityIdOccupiedByDisabledBy}`
                            : ""
                        })`
                      : ""}
                  </li>
                )}
                {issue.prodContext.expectedEntityDeletedOnProd && (
                  <li>
                    An old removed sensor still reserves this name in prod&apos;s hidden registry (not shown in HA
                    Devices or Entities).
                  </li>
                )}
                {issue.prodContext.integrationHint && <li>{issue.prodContext.integrationHint}</li>}
              </ul>
            </details>
          )}
          {(issue.prodContext?.deletedRegistryTombstones?.length ?? 0) > 0 &&
            !isDeferred &&
            allowProdRegistryPurge && (
            <div className="deploy-lovelace-gate-purge-deleted">
              <h5>Removed sensor records (invisible on prod)</h5>
              <p className="muted deploy-lovelace-gate-purge-lead">
                These are tombstones from a <strong>previous</strong> device — not your live prod sensor. Purging frees
                the entity name so you can rename the live one.
              </p>
              {issue.prodContext?.liveDeviceUniquePrefix && issue.prodContext?.tombstoneDeviceUniquePrefix && (
                <div className="deploy-lovelace-gate-device-compare">
                  <p>
                    <strong>Live prod sensor</strong>{" "}
                    {issue.prodContext.deviceName ? `(${issue.prodContext.deviceName}) ` : ""}
                    · hardware id <code>{issue.prodContext.liveDeviceUniquePrefix}</code>
                  </p>
                  <p>
                    <strong>Removed sensor tombstones</strong> · hardware id{" "}
                    <code>{issue.prodContext.tombstoneDeviceUniquePrefix}</code>
                  </p>
                </div>
              )}
              <table className="deploy-lovelace-gate-tombstone-table">
                <thead>
                  <tr>
                    <th>What</th>
                    <th>Entity id</th>
                    <th>Removed</th>
                  </tr>
                </thead>
                <tbody>
                  {issue.prodContext!.deletedRegistryTombstones!.map((row) => (
                    <tr key={row.entityId}>
                      <td>{row.label ?? row.entityId}</td>
                      <td>
                        <code>{row.entityId}</code>
                      </td>
                      <td>{row.createdAt ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <details className="deploy-lovelace-gate-purge-when-not">
                <summary>When should I <em>not</em> purge?</summary>
                <ul>
                  <li>You might reconnect the <strong>same old</strong> hardware and want HA to remember it.</li>
                  <li>The hardware id above matches your <strong>live</strong> sensor (kit will block this).</li>
                  <li>You are not sure these tombstones belong to the device you replaced.</li>
                </ul>
              </details>
              {issue.prodContext?.tombstoneMatchesLiveDevice ? (
                <p className="deploy-lovelace-gate-fix-error">
                  Purge blocked — tombstones share the same hardware id as the live prod sensor.
                </p>
              ) : measure ? (
                <button type="button" className="btn secondary btn-compact" tabIndex={-1}>
                  Purge removed sensor records on prod…
                </button>
              ) : !confirmPurgeDeleted ? (
                <button
                  type="button"
                  className="btn secondary btn-compact"
                  onClick={() => setConfirmPurgeDeleted?.(true)}
                >
                  Purge removed sensor records on prod…
                </button>
              ) : (
                <div className="confirm-box">
                  <p className="msg err">
                    Permanently removes the {issue.prodContext!.deletedRegistryTombstones!.length} tombstone row(s)
                    above from prod (backup written on prod), then restarts prod HA. Does not rename{" "}
                    <code>{issue.prodContext?.similarProdEntityId ?? "the live entity"}</code> — do that after purge.
                  </p>
                  <div className="deploy-lovelace-gate-action-buttons">
                    <ActionButton
                      label="Yes, purge removed sensor records"
                      toastPreset="purge-deleted-entities"
                      variant="danger"
                      onRun={() =>
                        operationsApi.purgeProdDeletedEntities(
                          issue.entityId,
                          issue.prodContext?.similarProdEntityId,
                        )
                      }
                      onDone={() => onPurgeDone?.()}
                      onFailure={() => onPurgeFailure?.()}
                    />
                    <button
                      type="button"
                      className="btn secondary btn-compact"
                      onClick={() => setConfirmPurgeDeleted?.(false)}
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

      <div className="deploy-lovelace-gate-ref-section">
        {issue.references.length === 0 ? (
          <>
            <h5>Used in dashboard (0)</h5>
            <p className="muted">Reference location not parsed — search Lovelace JSON for this entity id.</p>
          </>
        ) : (
          <details className="deploy-lovelace-gate-ref-details">
            <summary>Used in dashboard ({issue.references.length})</summary>
            <ul className="deploy-lovelace-gate-ref-list">
              {issue.references.map((ref, index) => (
                <li key={`${ref.source}-${ref.view}-${index}`}>
                  <span className="deploy-lovelace-gate-ref-path">{referenceLabel(ref)}</span>
                  <span className="muted deploy-lovelace-gate-ref-file">{sourceLabel(ref.source)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {(issue.entityChoices?.length ?? 0) > 0 && !isDeferred && (
        <div className="deploy-lovelace-gate-choices">
          <h5>
            {(issue.prodContext?.prodFixSteps?.length ?? 0) > 0
              ? "Shortcut — rename dashboard only"
              : "Which entity id is correct?"}
          </h5>
          {(issue.prodContext?.prodFixSteps?.length ?? 0) > 0 && (
            <p className="muted deploy-lovelace-gate-choice-lead">
              Keeps the <code>_2</code> id on prod. Use only if you are not fixing prod — proper steps are above.
            </p>
          )}
          <ul className="deploy-lovelace-gate-choice-list">
            {issue.entityChoices!.map((choice) => (
              <li key={choice.entityId}>
                <label className="deploy-lovelace-gate-choice">
                  <input
                    type="radio"
                    name={measure ? undefined : `entity-choice-${issue.entityId}`}
                    checked={measure ? choice.source === "prod" : selectedChoiceId === choice.entityId}
                    readOnly={measure}
                    onChange={measure ? undefined : () => setSelectedChoiceId?.(choice.entityId)}
                  />
                  <span className="deploy-lovelace-gate-choice-body">
                    <span className="deploy-lovelace-gate-choice-label">
                      {choice.label}: <code>{choice.entityId}</code>
                    </span>
                    <span className="muted deploy-lovelace-gate-choice-hint">{choice.hint}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="deploy-lovelace-gate-action-buttons">
            <button
              type="button"
              className="btn primary btn-compact"
              disabled={measure || fixBusy || !selectedChoice}
              tabIndex={measure ? -1 : undefined}
              onClick={measure ? undefined : onApplyEntityChoice}
            >
              Rename
            </button>
            {issue.fixOptions
              .filter((o) => o.action === "remove" || o.action === "defer")
              .map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="btn secondary btn-compact"
                  disabled={measure || fixBusy}
                  tabIndex={measure ? -1 : undefined}
                  onClick={measure ? undefined : () => onFixOption?.(option)}
                  title={option.description ?? undefined}
                >
                  {option.label}
                </button>
              ))}
          </div>
        </div>
      )}

      {(issue.fixOptions?.length ?? 0) > 0 && ((issue.entityChoices?.length ?? 0) === 0 || isDeferred) && (
        <div className="deploy-lovelace-gate-actions">
          <h5>{isDeferred ? "Deferred entity" : "Apply fix"}</h5>
          <div className="deploy-lovelace-gate-action-buttons">
            {issue.fixOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`btn ${option.action === "remove" ? "secondary" : option.action === "undefer" ? "primary" : "secondary"} btn-compact`}
                disabled={measure || fixBusy}
                tabIndex={measure ? -1 : undefined}
                onClick={measure ? undefined : () => onFixOption?.(option)}
                title={option.description ?? undefined}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!measure && fixBusy && <p className="muted deploy-lovelace-gate-fix-busy">Applying fix…</p>}
    </>
  );
}
