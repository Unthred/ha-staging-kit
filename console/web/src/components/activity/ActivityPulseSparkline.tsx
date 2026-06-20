import type { ActivityPulseBucket } from "../../hooks/useActivityPulseMetrics";

export function ActivityPulseSparkline({
  buckets,
  barClass,
  ariaLabel,
}: {
  buckets: ActivityPulseBucket[];
  barClass: string;
  ariaLabel: string;
}) {
  const totalRuns = buckets.reduce((sum, bucket) => sum + bucket.runs, 0);
  if (totalRuns === 0) {
    return <p className="muted activity-pulse-sparkline-empty">Quiet</p>;
  }

  const width = 160;
  const height = 36;
  const barW = Math.max(6, Math.floor(width / buckets.length) - 4);
  const max = Math.max(1, ...buckets.map((bucket) => bucket.runs));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="activity-pulse-sparkline" role="img" aria-label={ariaLabel}>
      {buckets.map((bucket, index) => {
        const barH = Math.max(3, (bucket.runs / max) * (height - 8));
        const x = index * (barW + 4) + 2;
        return (
          <rect
            key={bucket.at}
            x={x}
            y={height - barH - 4}
            width={barW}
            height={barH}
            rx={2}
            className={barClass}
          />
        );
      })}
    </svg>
  );
}
