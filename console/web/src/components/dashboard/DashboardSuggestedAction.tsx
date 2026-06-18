import { Link } from "react-router-dom";
import type { SuggestedAction } from "../../api";
import { ActionButton } from "../ActionButton";
import { SectionAttentionBadge } from "../PageAttentionPanel";
import { operationsApi } from "../../api";

export function DashboardSuggestedAction({
  action,
  onDone,
  attentionOrder,
}: {
  action: SuggestedAction;
  onDone?: () => void;
  attentionOrder?: number;
}) {
  const severity = action.severity ?? "info";

  const runPreset = () => {
    switch (action.actionPreset) {
      case "apply-config":
        return operationsApi.applyConfig();
      case "storage-sync":
        return operationsApi.storageSync();
      case "refresh-mirror":
      case "deploy-mirror":
        return operationsApi.deployMirror();
      case "person-poll":
        return operationsApi.personPoll();
      case "mirror-readonly":
        return operationsApi.setMirrorMode(false);
      default:
        return null;
    }
  };

  const presetRun = runPreset();

  return (
    <section className={`dash-suggested dash-panel dash-suggested-${severity}`}>
      <div className="dash-suggested-copy">
        <p className="dash-panel-eyebrow">
          {severity === "critical" ? "Needs attention now" : severity === "warning" ? "Suggested fix" : "Heads up"}
        </p>
        <h3>
          {action.title}
          <SectionAttentionBadge order={attentionOrder} />
        </h3>
        <p className="muted">{action.detail}</p>
      </div>
      <div className="dash-suggested-actions ops-actions">
        {presetRun && action.actionPreset && (
          <ActionButton
            label={action.linkLabel}
            toastPreset={action.actionPreset}
            variant={severity === "critical" ? "danger" : "primary"}
            onRun={async () => {
              const r = await presetRun;
              if (r.ok) onDone?.();
              return r;
            }}
          />
        )}
        <Link to={action.link} className="dash-chip-link">
          {presetRun ? "More options" : action.linkLabel}
        </Link>
      </div>
    </section>
  );
}
