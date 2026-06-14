import type { HealthTone } from "../../lib/dashboardHealth";
import { toneLabel } from "../../lib/dashboardHealth";

const ICONS: Record<string, string> = {
  "Config sync": "⟳",
  "Production HA": "◉",
  "Staging HA": "⌂",
  "MQTT mirror": "◎",
};

export function DashboardMetricCard({
  name,
  tone,
  detail,
  meta,
  compact,
}: {
  name: string;
  tone: HealthTone;
  detail: string;
  meta?: string;
  compact?: boolean;
}) {
  return (
    <article className={`dash-metric dash-metric-${tone} ${compact ? "dash-metric-compact" : ""}`}>
      <div className="dash-metric-icon" aria-hidden="true">
        {ICONS[name] ?? "◆"}
      </div>
      <div className="dash-metric-body">
        <div className="dash-metric-head">
          <h3>{name}</h3>
          <span className="dash-metric-pill">{toneLabel(tone)}</span>
        </div>
        <p className="dash-metric-detail">{detail}</p>
        {meta && <p className="dash-metric-meta">{meta}</p>}
      </div>
    </article>
  );
}
