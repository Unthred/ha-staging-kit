import { Link } from "react-router-dom";
import type { SuggestedAction } from "../../api";

export function DashboardSuggestedAction({ action }: { action: SuggestedAction }) {
  return (
    <section className="dash-suggested dash-panel">
      <div>
        <p className="dash-panel-eyebrow">Suggested next step</p>
        <h3>{action.title}</h3>
        <p className="muted">{action.detail}</p>
      </div>
      <Link to={action.link} className="dash-chip-link">
        {action.linkLabel}
      </Link>
    </section>
  );
}
