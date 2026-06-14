import type {
  AutomationActivitySnapshot,
  BridgeUptimeSnapshot,
  HaReachabilitySnapshot,
  LiveMetricsSnapshot,
} from "../../api";
import { mirrorModeLabel } from "../../lib/mirrorMode";
import { formatGitLiveChangeSummary, gitSyncLabel } from "../../lib/gitStatus";

function toneClass(ok: boolean, warn = false) {
  if (ok) return "dash-live-chip-ok";
  if (warn) return "dash-live-chip-warn";
  return "dash-live-chip-bad";
}

function GitChip({ git }: { git: NonNullable<LiveMetricsSnapshot["status"]["git"]> }) {
  const chipTone = git.isHaDirty ? "dash-live-chip-warn" : git.isRepoDirty ? "dash-live-chip-info" : "dash-live-chip-ok";

  return (
    <div className={`dash-live-chip ${chipTone}`}>
      <span className="dash-live-chip-label">Git</span>
      <span className="dash-live-chip-value">
        {git.branch ?? "—"}
        {git.commitHash ? ` @ ${git.commitHash}` : ""}
      </span>
      <span className="dash-live-chip-meta">
        {formatGitLiveChangeSummary(git)} · {gitSyncLabel(git)}
      </span>
    </div>
  );
}

function MirrorChip({ mirror }: { mirror: NonNullable<LiveMetricsSnapshot["status"]["mirror"]> }) {
  const mode = mirrorModeLabel(mirror.mode);
  const runLabel = mirror.running ? "Running" : "Stopped";
  const bridgeLabel = mirror.bridgeConnected ? "Bridge up" : "Bridge down";

  return (
    <div
      className={`dash-live-chip ${toneClass(mirror.running && mirror.bridgeConnected, !mirror.running || !mirror.bridgeConnected)}`}
    >
      <span className="dash-live-chip-label">MQTT mirror</span>
      <span className="dash-live-chip-value">{mode}</span>
      <span className="dash-live-chip-meta">
        {runLabel} · {bridgeLabel}
        {mirror.prodMqttHost ? ` · ${mirror.prodMqttHost}:${mirror.prodMqttPort}` : ""}
      </span>
    </div>
  );
}

function StagingChip({ staging }: { staging: NonNullable<LiveMetricsSnapshot["status"]["staging"]> }) {
  const apiLabel = staging.apiReachable ? "API ok" : "API unreachable";
  const containerLabel = staging.containerName
    ? staging.containerRunning
      ? `${staging.containerName} running`
      : `${staging.containerName} stopped`
    : staging.installLabel;

  return (
    <div className={`dash-live-chip ${toneClass(staging.apiReachable, !staging.apiReachable)}`}>
      <span className="dash-live-chip-label">Staging HA</span>
      <span className="dash-live-chip-value">{staging.version ?? staging.installLabel}</span>
      <span className="dash-live-chip-meta">
        {apiLabel} · {containerLabel}
      </span>
    </div>
  );
}

function DualSparkline({
  history,
  prodKey,
  maxValue,
  prodClass,
  stagingClass,
  ariaLabel,
}: {
  history: HaReachabilitySnapshot["history"];
  prodKey: "prodLatencyMs";
  maxValue?: number;
  prodClass: string;
  stagingClass: string;
  ariaLabel: string;
}) {
  if (history.length === 0) {
    return <p className="muted dash-live-chart-empty">Collecting samples…</p>;
  }

  const width = 280;
  const height = 72;
  const barW = Math.max(4, Math.floor(width / history.length) - 2);
  const isLatency = prodKey === "prodLatencyMs";
  const max = isLatency
    ? Math.max(maxValue ?? 0, ...history.flatMap((p) => [p.prodLatencyMs ?? 0, p.stagingLatencyMs ?? 0]), 1)
    : 1;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="dash-sparkline-svg" role="img" aria-label={ariaLabel}>
      {history.map((point, i) => {
        const x = i * (barW + 2) + 2;
        if (isLatency) {
          const prodH = point.prodReachable
            ? Math.max(4, ((point.prodLatencyMs ?? 0) / max) * (height - 10))
            : 4;
          const stagingH = point.stagingReachable
            ? Math.max(4, ((point.stagingLatencyMs ?? 0) / max) * (height - 10))
            : 4;
          return (
            <g key={`${point.at}-${i}`}>
              <rect
                x={x}
                y={height - prodH - 4}
                width={Math.max(2, barW / 2 - 1)}
                height={prodH}
                rx={2}
                className={point.prodReachable ? prodClass : "dash-spark-bar-warn"}
              />
              <rect
                x={x + barW / 2}
                y={height - stagingH - 4}
                width={Math.max(2, barW / 2 - 1)}
                height={stagingH}
                rx={2}
                className={point.stagingReachable ? stagingClass : "dash-spark-bar-warn"}
              />
            </g>
          );
        }

        const prodH = point.prodReachable ? height - 8 : 4;
        const stagingH = point.stagingReachable ? height - 8 : 4;
        return (
          <g key={`${point.at}-${i}`}>
            <rect x={x} y={height - prodH - 4} width={Math.max(2, barW / 2 - 1)} height={prodH} rx={2} className={prodClass} />
            <rect
              x={x + barW / 2}
              y={height - stagingH - 4}
              width={Math.max(2, barW / 2 - 1)}
              height={stagingH}
              rx={2}
              className={stagingClass}
            />
          </g>
        );
      })}
    </svg>
  );
}

function BridgeChart({ bridge }: { bridge: BridgeUptimeSnapshot }) {
  const points = bridge.buckets.length > 0 ? bridge.buckets : bridge.pollHistory.map((p) => ({ at: p.at, connected: p.connected }));
  if (points.length === 0) {
    return <p className="muted dash-live-chart-empty">No bridge history yet.</p>;
  }

  const width = 280;
  const height = 72;
  const barW = Math.max(6, Math.floor(width / points.length) - 4);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="dash-sparkline-svg" role="img" aria-label="MQTT bridge uptime">
      {points.map((point, i) => {
        const h = point.connected ? height - 10 : 6;
        const y = point.connected ? 4 : height - h - 4;
        const x = i * (barW + 4) + 2;
        return (
          <rect
            key={`${point.at}-${i}`}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx={3}
            className={point.connected ? "dash-spark-bar-ok" : "dash-spark-bar-warn"}
          />
        );
      })}
    </svg>
  );
}

function AutomationChart({ automation }: { automation: AutomationActivitySnapshot }) {
  const buckets = automation.prodBuckets.length >= automation.stagingBuckets.length ? automation.prodBuckets : automation.stagingBuckets;
  if (buckets.length === 0) {
    return <p className="muted dash-live-chart-empty">No automation runs in the last hour.</p>;
  }

  const width = 280;
  const height = 72;
  const barW = Math.max(4, Math.floor(width / buckets.length) - 2);
  const prodMap = new Map(automation.prodBuckets.map((b) => [b.at, b.runs]));
  const stagingMap = new Map(automation.stagingBuckets.map((b) => [b.at, b.runs]));
  const max = Math.max(
    1,
    ...automation.prodBuckets.map((b) => b.runs),
    ...automation.stagingBuckets.map((b) => b.runs),
  );

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="dash-sparkline-svg" role="img" aria-label="Automation runs">
      {buckets.map((bucket, i) => {
        const prodRuns = prodMap.get(bucket.at) ?? 0;
        const stagingRuns = stagingMap.get(bucket.at) ?? 0;
        const prodH = Math.max(4, (prodRuns / max) * (height - 10));
        const stagingH = Math.max(4, (stagingRuns / max) * (height - 10));
        const x = i * (barW + 2) + 2;
        return (
          <g key={`${bucket.at}-${i}`}>
            <rect x={x} y={height - prodH - 4} width={Math.max(2, barW / 2 - 1)} height={prodH} rx={2} className="dash-spark-bar-prod" />
            <rect
              x={x + barW / 2}
              y={height - stagingH - 4}
              width={Math.max(2, barW / 2 - 1)}
              height={stagingH}
              rx={2}
              className="dash-spark-bar-staging"
            />
          </g>
        );
      })}
    </svg>
  );
}

export function DashboardLiveMetrics({ metrics }: { metrics?: LiveMetricsSnapshot | null }) {
  if (!metrics) return null;

  const { status, reachability, bridge, automation } = metrics;
  const hasChips = status.git || status.mirror || status.staging;
  const hasCharts = reachability.available || bridge?.available || automation?.available;
  if (!hasChips && !hasCharts) return null;

  return (
    <div className="dash-live-metrics">
      {hasChips && (
        <section className="dash-live-status-strip" aria-label="Live environment status">
          {status.git && <GitChip git={status.git} />}
          {status.mirror && <MirrorChip mirror={status.mirror} />}
          {status.staging && <StagingChip staging={status.staging} />}
        </section>
      )}

      {hasCharts && (
        <section className="dash-live-charts" aria-label="Live activity charts">
          {reachability.available && (
            <article className="dash-panel dash-live-chart-panel">
              <header className="dash-panel-head dash-panel-head-tight">
                <h3>HA API latency</h3>
                <span className="muted dash-live-chart-legend">
                  <span className="dash-legend-prod">Prod</span>
                  <span className="dash-legend-staging">Staging</span>
                </span>
              </header>
              <DualSparkline
                history={reachability.history}
                prodKey="prodLatencyMs"
                prodClass="dash-spark-bar-prod"
                stagingClass="dash-spark-bar-staging"
                ariaLabel="HA API latency trend"
              />
              <p className="muted dash-live-chart-meta">
                Now: prod {reachability.prodReachable ? `${reachability.prodLatencyMs ?? "—"}ms` : "down"} · staging{" "}
                {reachability.stagingReachable ? `${reachability.stagingLatencyMs ?? "—"}ms` : "down"}
              </p>
            </article>
          )}

          {bridge?.available && (
            <article className="dash-panel dash-live-chart-panel">
              <header className="dash-panel-head dash-panel-head-tight">
                <h3>Bridge uptime</h3>
                <span className={`dash-badge ${bridge.connected ? "dash-badge-ok" : "dash-badge-warn"}`}>
                  {bridge.connected ? "Up" : "Down"}
                </span>
              </header>
              <BridgeChart bridge={bridge} />
              <p className="muted dash-live-chart-meta">Last hour · 5 min buckets from mirror log</p>
            </article>
          )}

          {automation?.available && (
            <article className="dash-panel dash-live-chart-panel">
              <header className="dash-panel-head dash-panel-head-tight">
                <h3>Automation runs</h3>
                <span className="muted dash-live-chart-legend">
                  <span className="dash-legend-prod">Prod</span>
                  <span className="dash-legend-staging">Staging</span>
                </span>
              </header>
              <AutomationChart automation={automation} />
              <p className="muted dash-live-chart-meta">
                Last hour: prod {automation.prodRunsLastHour} · staging {automation.stagingRunsLastHour}
              </p>
            </article>
          )}
        </section>
      )}
    </div>
  );
}
