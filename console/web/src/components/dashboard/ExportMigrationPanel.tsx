import { useState } from "react";
import { operationsApi, type ExportMigrationRequest } from "../../api";
import { ActionButton } from "../ActionButton";

type ExportMigrationPanelProps = {
  request: ExportMigrationRequest;
  disabled?: boolean;
  onDone?: () => void;
};

export function ExportMigrationPanel({ request, disabled = false, onDone }: ExportMigrationPanelProps) {
  const [confirmExport, setConfirmExport] = useState(false);

  return (
    <div className="deploy-lovelace-gate-export-migration">
      <h5>Export migration (recommended)</h5>
      <p className="muted">
        Writes <code>migrations/pending/*.yaml</code> in the config repo and applies matching git entity-id patches.
        Commit and push for review — the release agent applies registry steps on prod (no kit SSH).
      </p>
      {!confirmExport ? (
        <button
          type="button"
          className="btn secondary btn-compact"
          disabled={disabled}
          onClick={() => setConfirmExport(true)}
        >
          Export migration…
        </button>
      ) : (
        <div className="confirm-box">
          <p>
            Creates a migration manifest under <code>migrations/pending/</code> and updates git files that reference the
            old entity id. Prod stays untouched until the release agent runs after you approve <code>main</code>.
          </p>
          <div className="deploy-lovelace-gate-action-buttons">
            <ActionButton
              label="Yes, export migration"
              variant="secondary"
              compact
              onRun={async () => {
                const result = await operationsApi.exportMigration(request);
                return { ok: result.ok, message: result.message };
              }}
              onDone={() => {
                setConfirmExport(false);
                onDone?.();
              }}
              onFailure={() => setConfirmExport(false)}
            />
            <button type="button" className="btn secondary btn-compact" onClick={() => setConfirmExport(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
