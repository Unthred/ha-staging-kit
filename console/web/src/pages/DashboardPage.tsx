import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { dashboardApi, toApiError, type ApiError, type DashboardStatus } from "../api";
import { DashboardActivityFeed } from "../components/dashboard/DashboardActivityFeed";
import { DashboardDriftCard } from "../components/dashboard/DashboardDriftCard";
import { DashboardGitCard } from "../components/dashboard/DashboardGitCard";
import { DashboardHealthRing } from "../components/dashboard/DashboardHealthRing";
import { DashboardInsightsPanel } from "../components/dashboard/DashboardInsightsPanel";
import { DashboardLogTail } from "../components/dashboard/DashboardLogTail";
import { DashboardMetricCard } from "../components/dashboard/DashboardMetricCard";
import { DashboardMirrorControl } from "../components/dashboard/DashboardMirrorControl";
import { DashboardOpenLinks } from "../components/dashboard/DashboardOpenLinks";
import { DashboardPersonKpi } from "../components/dashboard/DashboardPersonKpi";
import { DashboardPipelinePanel } from "../components/dashboard/DashboardPipelinePanel";
import { DashboardPollSparkline } from "../components/dashboard/DashboardPollSparkline";
import { DashboardPresenceCard } from "../components/dashboard/DashboardPresenceCard";
import { DashboardQuickActions } from "../components/dashboard/DashboardQuickActions";
import { DashboardReadinessChips } from "../components/dashboard/DashboardReadinessChips";
import { DashboardStagingTargetPanel } from "../components/dashboard/DashboardStagingTargetPanel";
import { DashboardSuggestedAction } from "../components/dashboard/DashboardSuggestedAction";
import { LoadErrorPanel } from "../components/LoadErrorPanel";
import {
  computeHealthScore,
  countHealthy,
  healthToneFromScore,
  shortDetail,
  statusTone,
  toneLabel,
} from "../lib/dashboardHealth";
import { formatRefreshLabel } from "../lib/formatTime";
import { isMirrorControlMode, mirrorModeLabel } from "../lib/mirrorMode";

function mirrorMeta(data: DashboardStatus): string | undefined {
  if (!data.mirror?.configured) return undefined;
  const parts = [`${data.mirror.prodMqttHost}:${data.mirror.prodMqttPort}`];
  parts.push(data.mirror.running ? "Broker running" : "Broker stopped");
  parts.push(mirrorModeLabel(data.mirror.mode));
  return parts.join(" · ");
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setData(await dashboardApi.status());
      setError(null);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 30000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const score = useMemo(() => (data ? computeHealthScore(data.subsystems) : 0), [data]);
  const healthTone = useMemo(() => healthToneFromScore(score), [score]);
  const healthyCount = useMemo(() => (data ? countHealthy(data.subsystems) : { healthy: 0, total: 0 }), [data]);

  if (error && !data) {
    return (
      <LoadErrorPanel
        title="Dashboard"
        error={error}
        onRetry={() => {
          setError(null);
          refresh();
        }}
      />
    );
  }

  const today = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());

  return (
    <div className="dash">
      <header className="dash-header">
        <div>
          <p className="dash-kicker">Staging overview</p>
          <h2 className="dash-title">Health dashboard</h2>
          <p className="dash-subtitle">
            {today} · {formatRefreshLabel(data?.refreshedAt)}
          </p>
          <DashboardOpenLinks stagingUrl={data?.stagingHaUrl} prodUrl={data?.prodHaUrl} />
        </div>
        <button type="button" className="dash-refresh btn secondary" disabled={busy} onClick={refresh}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {!data?.onboardingComplete && (
        <div className="dash-banner dash-banner-warn">
          Setup incomplete — <Link to="/onboarding">resume the wizard</Link>
        </div>
      )}

      {data?.mirror?.configured && isMirrorControlMode(data.mirror.mode) && (
        <div className="dash-banner dash-banner-danger">
          Control mode is active — staging can actuate production devices.{" "}
          <Link to="/operations">Toggle in Operations</Link>
        </div>
      )}

      {data?.suggestedAction && <DashboardSuggestedAction action={data.suggestedAction} />}

      {data && data.readiness.length > 0 && <DashboardReadinessChips items={data.readiness} />}

      <section className="dash-hero dash-hero-wide">
        <div className="dash-hero-score dash-panel">
          <DashboardHealthRing score={score} tone={healthTone} />
          <div className="dash-hero-copy">
            <p className="dash-panel-eyebrow">Staging health</p>
            <h3>{toneLabel(healthTone)}</h3>
            <p className="dash-hero-meta">
              {healthyCount.total === 0
                ? "Waiting for subsystem status…"
                : `${healthyCount.healthy} of ${healthyCount.total} systems reporting healthy`}
            </p>
            <div className="dash-quick-links">
              <Link to="/operations" className="dash-chip-link">
                Operations
              </Link>
              <Link to="/settings" className="dash-chip-link">
                Settings
              </Link>
            </div>
          </div>
        </div>

        <DashboardPersonKpi personSync={data?.personSync} />

        <DashboardInsightsPanel issues={data?.issues ?? []} />
      </section>

      {data && (
        <DashboardQuickActions gitConfigured={data.git?.configured ?? false} onDone={refresh} />
      )}

      <section className="dash-metrics dash-metrics-4" aria-label="Subsystem metrics">
        {data?.subsystems.map((s) => (
          <DashboardMetricCard
            key={s.name}
            name={s.name}
            tone={statusTone(s.status)}
            detail={shortDetail(s.detail)}
            meta={s.name === "MQTT mirror" ? mirrorMeta(data) : undefined}
          />
        ))}
      </section>

      <section className="dash-triple">
        <DashboardGitCard git={data?.git} />
        <DashboardPresenceCard presence={data?.presence} />
        <DashboardDriftCard drift={data?.configDrift} />
      </section>

      <section className="dash-bento dash-bento-wide">
        <DashboardStagingTargetPanel target={data?.stagingTarget} />
      </section>

      <section className="dash-bento">
        <DashboardPollSparkline history={data?.pollHistory ?? []} />
        {data && <DashboardActivityFeed data={data} />}
      </section>

      <section className="dash-bento">
        <DashboardLogTail lines={data?.syncLogTail ?? []} />
        <DashboardPipelinePanel mirrorConfigured={data?.mirror?.configured ?? false} />
      </section>

      {data?.mirror?.configured && (
        <DashboardMirrorControl mirror={data.mirror} onChanged={refresh} />
      )}
    </div>
  );
}
