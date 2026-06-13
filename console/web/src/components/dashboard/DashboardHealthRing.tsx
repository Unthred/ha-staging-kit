import type { HealthTone } from "../../lib/dashboardHealth";

const RING = 54;
const C = 2 * Math.PI * RING;

export function DashboardHealthRing({ score, tone }: { score: number; tone: HealthTone }) {
  const clamped = Math.max(0, Math.min(100, score));
  const offset = C - (clamped / 100) * C;

  return (
    <div className={`dash-ring dash-ring-${tone}`} aria-label={`Staging health ${clamped} percent`}>
      <svg viewBox="0 0 128 128" className="dash-ring-svg" role="img">
        <circle className="dash-ring-track" cx="64" cy="64" r={RING} />
        <circle
          className="dash-ring-progress"
          cx="64"
          cy="64"
          r={RING}
          strokeDasharray={C}
          strokeDashoffset={offset}
          transform="rotate(-90 64 64)"
        />
      </svg>
      <div className="dash-ring-center">
        <span className="dash-ring-value">{clamped}</span>
        <span className="dash-ring-unit">score</span>
      </div>
    </div>
  );
}
