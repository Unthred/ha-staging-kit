import type { HaIssueInsight } from "../../lib/haIssueInsight";

export function HaIssueLogInsight({ insight }: { insight: HaIssueInsight }) {
  return (
    <div className="diag-token-help diag-ha-issue-insight">
      <h4 className="diag-token-help-heading">Likely cause</h4>
      <p className="diag-token-help-lead">{insight.cause}</p>
      <h4 className="diag-token-help-heading">What to try</h4>
      <ol className="diag-token-help-steps">
        {insight.hints.map((hint) => (
          <li key={hint}>{hint}</li>
        ))}
      </ol>
    </div>
  );
}
