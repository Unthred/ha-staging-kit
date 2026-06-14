import { useCallback, useEffect, useState } from "react";
import { Chip } from "../components/Chip";
import { LoadErrorPanel } from "../components/LoadErrorPanel";
import { LogPanel } from "../components/diagnostics/LogPanel";
import { DashboardInsightsPanel } from "../components/dashboard/DashboardInsightsPanel";
import { DashboardActivityTimeline } from "../components/dashboard/DashboardActivityTimeline";
import { DashboardMetricCard } from "../components/dashboard/DashboardMetricCard";
import { diagnosticsApi, toApiError, type ApiError, type DiagnosticsStatus } from "../api";
import { formatRefreshLabel } from "../lib/formatTime";
import { shortDetail, statusTone } from "../lib/dashboardHealth";

type TabId = "signals" | "sync" | "mqtt";

const TABS: { id: TabId; label: string }[] = [
  { id: "signals", label: "Signals" },
  { id: "sync", label: "Sync log" },
  { id: "mqtt", label: "MQTT log" },
];

export default function DiagnosticsPage() {
  const [tab, setTab] = useState<TabId>("signals");
  const [data, setData] = useState<DiagnosticsStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setData(await diagnosticsApi.status());
      setError(null);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 15000);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (error && !data) {
    return <LoadErrorPanel title="Diagnostics" error={error} onRetry={refresh} />;
  }

  const tabs = data?.mirrorConfigured ? TABS : TABS.filter((t) => t.id !== "mqtt");

  return (
    <div className="page diag-page">
      <div className="page-header diag-page-header">
        <div>
          <h2>Diagnostics</h2>
          <p className="muted">
            Logs and parsed warnings from the kit sync loop and MQTT mirror · {formatRefreshLabel(data?.refreshedAt)}
          </p>
        </div>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => void refresh()}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <nav className="diag-tabs" aria-label="Diagnostics views">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`diag-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "signals" && data && (
        <div className="diag-signals">
          <section className="card diag-subsystems">
            <header className="diag-section-head">
              <h3>Subsystems</h3>
            </header>
            <div className="diag-metrics">
              {data.subsystems.map((s) => (
                <DashboardMetricCard key={s.name} name={s.name} tone={statusTone(s.status)} detail={shortDetail(s.detail)} />
              ))}
            </div>
          </section>

          <DashboardInsightsPanel issues={data.issues} />

          <section className="card">
            <header className="diag-section-head">
              <h3>Recent activity</h3>
            </header>
            <DashboardActivityTimeline activity={data.syncActivity} />
          </section>

          {data.pollHistory.length > 0 && (
            <section className="card">
              <header className="diag-section-head">
                <h3>Person poll history</h3>
              </header>
              <ul className="diag-poll-list">
                {data.pollHistory.map((p) => (
                  <li key={p.at}>
                    <Chip status={p.ok ? "pass" : "fail"} label={p.ok ? "OK" : "Fail"} />
                    <span>
                      {p.count} state(s) · {new Date(p.at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {tab === "sync" && data && (
        <LogPanel title="Config sync log" path={data.syncLogPath} lines={data.syncLogLines} expanded />
      )}

      {tab === "mqtt" && data && (
        <LogPanel
          title="MQTT mirror log"
          path={data.mqttLogPath}
          lines={data.mqttLogLines}
          emptyMessage={data.mirrorConfigured ? "Mirror log empty or not created yet." : "MQTT mirror is not configured."}
          expanded
        />
      )}
    </div>
  );
}
