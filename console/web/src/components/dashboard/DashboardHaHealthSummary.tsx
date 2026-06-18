import { Link } from "react-router-dom";
import type { ComponentIssue } from "../../api";
import { countHaIssuesByLevel, countHaIssuesForSource } from "../../lib/haIssueLog";
import { SectionAttentionBadge } from "../PageAttentionPanel";

export function DashboardHaHealthSummary({
  issues,
  attentionCount = 0,
  attentionOrder,
  variant = "panel",
}: {
  issues: ComponentIssue[];
  attentionCount?: number;
  attentionOrder?: number;
  variant?: "panel" | "chart";
}) {
  const { errors, warnings, total } = countHaIssuesByLevel(issues);
  const prod = countHaIssuesForSource(issues, "Production HA");
  const staging = countHaIssuesForSource(issues, "Staging HA");
  const tone = errors > 0 ? "bad" : warnings > 0 ? "warn" : "ok";
  const diagLink = total > 0 ? "/diagnostics?tab=ha&issue=0" : "/diagnostics?tab=ha";
  const isChart = variant === "chart";
  const Tag = isChart ? "article" : "section";
  const className = [
    Tag === "article" ? "dash-panel dash-live-chart-panel" : "dash-panel",
    "dash-ha-health",
    `dash-ha-health--${tone}`,
    isChart ? "dash-ha-health--chart" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const meta =
    total === 0
      ? "All integrations loaded on production and staging."
      : `Prod · ${prod.errors} err, ${prod.warnings} warn · Staging · ${staging.errors} err, ${staging.warnings} warn`;

  return (
    <Tag id="overview-ha-errors" className={className}>
      <header className="dash-panel-head dash-panel-head-tight">
        <h3>
          Integration health
          <SectionAttentionBadge count={attentionCount} order={attentionOrder} />
        </h3>
        <Link to={diagLink} className="dash-text-link">
          Diagnostics →
        </Link>
      </header>

      <div className={`dash-ha-health-visual${isChart ? " dash-ha-health-visual--chart" : ""}`}>
        <div className={`dash-ha-health-stat dash-ha-health-stat--error ${errors === 0 ? "is-zero" : ""}`}>
          <span className="dash-ha-health-stat-value">{errors}</span>
          <span className="dash-ha-health-stat-label">Errors</span>
        </div>
        <div className="dash-ha-health-stat-sep" />
        <div className={`dash-ha-health-stat dash-ha-health-stat--warn ${warnings === 0 ? "is-zero" : ""}`}>
          <span className="dash-ha-health-stat-value">{warnings}</span>
          <span className="dash-ha-health-stat-label">Warnings</span>
        </div>
      </div>

      <p className={`${isChart ? "muted dash-live-chart-meta" : total === 0 ? "dash-ha-health-ok" : "dash-ha-health-meta muted"}`}>
        {meta}
      </p>
    </Tag>
  );
}
