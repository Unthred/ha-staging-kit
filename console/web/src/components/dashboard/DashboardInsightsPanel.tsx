import { Link } from "react-router-dom";
import type { ComponentIssue } from "../../api";

export function DashboardInsightsPanel({ issues }: { issues: ComponentIssue[] }) {
  const sorted = [...issues].reverse();

  return (
    <section className="dash-panel dash-insights">
      <header className="dash-panel-head">
        <div>
          <p className="dash-panel-eyebrow">Insights</p>
          <h3>{sorted.length === 0 ? "All clear" : `${sorted.length} active signal${sorted.length === 1 ? "" : "s"}`}</h3>
        </div>
        {sorted.length > 0 && (
          <Link to="/diagnostics" className="dash-text-link">
            View logs →
          </Link>
        )}
      </header>

      {sorted.length === 0 ? (
        <div className="dash-insight-ok">
          <span className="dash-insight-ok-icon" aria-hidden="true">
            ✓
          </span>
          <p>No errors or warnings from health checks or recent logs.</p>
        </div>
      ) : (
        <ul className="dash-insight-list">
          {sorted.map((issue, i) => (
            <li key={`${issue.source}-${i}`} className={`dash-insight dash-insight-${issue.level}`}>
              <span className="dash-insight-badge">{issue.level}</span>
              <div>
                <span className="dash-insight-source">{issue.source}</span>
                <p className="dash-insight-message">{issue.message}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
