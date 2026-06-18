import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Chip } from "../components/Chip";
import { LoadErrorPanel } from "../components/LoadErrorPanel";
import { HaDiagnosticsPanel } from "../components/diagnostics/HaDiagnosticsPanel";
import { LogPanel } from "../components/diagnostics/LogPanel";
import { DashboardHeader } from "../components/dashboard/DashboardHeader";
import { DashboardInsightsPanel } from "../components/dashboard/DashboardInsightsPanel";
import { DashboardActivityTimeline } from "../components/dashboard/DashboardActivityTimeline";
import { DashboardMetricCard } from "../components/dashboard/DashboardMetricCard";
import { diagnosticsApi, toApiError, type ApiError, type DiagnosticsStatus, type OperationLogEntry } from "../api";
import { SectionAttentionBadge } from "../components/PageAttentionPanel";
import { useNavAttentionContext } from "../context/NavAttentionContext";
import { useAttentionNavigation } from "../hooks/useAttentionNavigation";
import { useHaUrls } from "../hooks/useHaUrls";
import { setHaUrls } from "../lib/haUrlsStore";
import { usePollingRefresh } from "../hooks/usePollingRefresh";
import { attentionCountForAnchor, attentionCountForDiagTab } from "../lib/navAttention";
import { shortDetail, statusTone } from "../lib/dashboardHealth";

type TabId = "signals" | "ops" | "sync" | "mqtt" | "ha";

const TABS: { id: TabId; label: string }[] = [
  { id: "signals", label: "Signals" },
  { id: "ha", label: "HA logs" },
  { id: "ops", label: "Operations" },
  { id: "sync", label: "Sync log" },
  { id: "mqtt", label: "MQTT log" },
];

const OPS_LOG_HINT =
  "Kit button actions this session — apply config, storage sync, reset workbench, person poll, ship/deploy, push to GitHub, mirror deploy/mode, staging restart, snapshot. Last 50 entries; cleared on container restart.";

function tabFromParam(value: string | null): TabId {
  if (value && TABS.some((t) => t.id === value)) return value as TabId;
  return "signals";
}

function issueIndexFromParam(value: string | null): number | null {
  if (value === null || value === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function OpsLogRow({ entry }: { entry: OperationLogEntry }) {
  const defaultOpen = !entry.ok || !!entry.logTail;
  const [open, setOpen] = useState(defaultOpen);
  const tone = entry.ok ? "pass" : "fail";
  const d = new Date(entry.when);
  const when = d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (
    <li className={`ops-log-row ops-log-row--${tone}`}>
      <div
        className="ops-log-row-header"
        onClick={() => entry.logTail && setOpen((o) => !o)}
        role={entry.logTail ? "button" : undefined}
        tabIndex={entry.logTail ? 0 : undefined}
        onKeyDown={(e) => {
          if (entry.logTail && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <Chip status={tone} label={entry.ok ? "OK" : "FAIL"} />
        <div className="ops-log-row-body">
          <span className="ops-log-row-op">{entry.operation}</span>
          <span className="ops-log-row-msg">{entry.message}</span>
        </div>
        <span className="ops-log-row-time">{when}</span>
        {entry.logTail && <span className="ops-log-row-toggle">{open ? "▲" : "▼"}</span>}
      </div>
      {open && entry.logTail && <pre className="ops-log-tail">{entry.logTail}</pre>}
    </li>
  );
}

export default function DiagnosticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<TabId>(() => tabFromParam(searchParams.get("tab")));
  const [selectedHaIssue, setSelectedHaIssue] = useState<number | null>(() =>
    issueIndexFromParam(searchParams.get("issue")),
  );
  const [data, setData] = useState<DiagnosticsStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const haUrls = useHaUrls();
  const { itemsForPath } = useNavAttentionContext();
  const attentionItems = itemsForPath("/diagnostics");
  useAttentionNavigation(tab);

  useEffect(() => {
    setTab(tabFromParam(searchParams.get("tab")));
    setSelectedHaIssue(issueIndexFromParam(searchParams.get("issue")));
  }, [searchParams]);

  const selectTab = (id: TabId) => {
    setTab(id);
    if (id === "ha") {
      setSearchParams(selectedHaIssue !== null ? { tab: id, issue: String(selectedHaIssue) } : { tab: id }, {
        replace: true,
      });
      return;
    }
    setSearchParams(id === "signals" ? {} : { tab: id }, { replace: true });
  };

  const selectHaIssue = (index: number | null) => {
    setSelectedHaIssue(index);
    if (index === null) {
      setSearchParams({ tab: "ha" }, { replace: true });
      return;
    }
    setSearchParams({ tab: "ha", issue: String(index) }, { replace: true });
  };

  const fetchDiagnostics = useCallback(async () => {
    setBusy(true);
    try {
      const status = await diagnosticsApi.status();
      if (status.stagingHaUrl || status.prodHaUrl) {
        setHaUrls(status.stagingHaUrl ?? "", status.prodHaUrl ?? "");
      }
      setData(status);
      setError(null);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  usePollingRefresh(fetchDiagnostics, 30000);

  if (error && !data) {
    return <LoadErrorPanel title="Diagnostics" error={error} onRetry={fetchDiagnostics} />;
  }

  const tabs = data?.mirrorConfigured ? TABS : TABS.filter((t) => t.id !== "mqtt");
  const tabBodyClass =
    tab === "signals"
      ? "diag-tab-body diag-tab-body--signals"
      : tab === "ha"
        ? "diag-tab-body diag-tab-body--ha"
        : "diag-tab-body diag-tab-body--log";
  const signalsAttention = attentionCountForDiagTab(attentionItems, "signals");
  const insightsAttention = attentionCountForAnchor(attentionItems, "diag-insights");
  const subsystemsAttention = attentionCountForAnchor(attentionItems, "diag-subsystems");
  const haLogsAttention = attentionCountForDiagTab(attentionItems, "ha");

  const stagingUrl = data?.stagingHaUrl || haUrls.stagingUrl;
  const prodUrl = data?.prodHaUrl || haUrls.prodUrl;

  return (
    <div className="dash diag-page">
      <DashboardHeader
        kicker="Diagnostics"
        title="Logs & signals"
        subtitle="Kit sync/MQTT signals plus Home Assistant integration errors and core logs"
        refreshedAt={data?.refreshedAt}
        stagingUrl={stagingUrl}
        prodUrl={prodUrl}
        busy={busy}
        onRefresh={() => void fetchDiagnostics()}
      />

      <nav className="diag-tabs" aria-label="Diagnostics views">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`diag-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => selectTab(t.id)}
          >
            <span className="diag-tab-label">{t.label}</span>
            {t.id === "signals" ? <SectionAttentionBadge count={signalsAttention} /> : null}
            {t.id === "ha" ? <SectionAttentionBadge count={haLogsAttention} /> : null}
          </button>
        ))}
      </nav>

      <div className={tabBodyClass}>
        {tab === "signals" && data && (
          <div className="diag-signals">
            <section id="diag-subsystems" className="card diag-subsystems">
              <header className="diag-section-head">
                <h3>
                  Subsystems
                  <SectionAttentionBadge count={subsystemsAttention} />
                </h3>
              </header>
              <div className="diag-metrics">
                {data.subsystems.map((s) => (
                  <DashboardMetricCard key={s.name} name={s.name} tone={statusTone(s.status)} detail={shortDetail(s.detail)} />
                ))}
              </div>
            </section>

            <DashboardInsightsPanel issues={data.issues} attentionCount={insightsAttention} />

            <section className="card diag-section-compact">
              <header className="diag-section-head">
                <h3>Recent activity</h3>
              </header>
              <DashboardActivityTimeline activity={data.syncActivity} compact />
            </section>

            <section className="card diag-section-compact diag-poll-panel">
              <header className="diag-section-head">
                <h3>Person poll history</h3>
                <p className="muted diag-section-hint">
                  {data.pollHistory.length > 0
                    ? `${data.pollHistory.length} recent poll(s)`
                    : "No polls logged yet"}
                </p>
              </header>
              {data.pollHistory.length === 0 ? (
                <p className="muted diag-log-empty diag-poll-list">Waiting for the sync loop to record polls.</p>
              ) : (
                <ul className="diag-scroll-list diag-poll-list">
                  {data.pollHistory.map((p) => (
                    <li key={p.at}>
                      <Chip status={p.ok ? "pass" : "fail"} label={p.ok ? "OK" : "Fail"} />
                      <span>
                        {p.count} state(s) · {new Date(p.at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {tab === "ha" && data && (
          <HaDiagnosticsPanel
            issues={data.haIssues}
            prodHaLog={data.prodHaLog}
            stagingHaLog={data.stagingHaLog}
            stagingUrl={stagingUrl}
            selectedIndex={selectedHaIssue}
            onSelectIndex={selectHaIssue}
          />
        )}

        {tab === "ops" && data && (
          <section className="card diag-ops-panel">
            <header className="diag-section-head">
              <h3>Operation log</h3>
              <p className="muted diag-section-hint">{OPS_LOG_HINT}</p>
            </header>
            {data.operationLog.length === 0 ? (
              <p className="muted diag-log-empty">No operations run yet this session.</p>
            ) : (
              <ul className="diag-scroll-list ops-log-list">
                {data.operationLog.map((entry, i) => (
                  <OpsLogRow key={i} entry={entry} />
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "sync" && data && (
          <LogPanel title="Config sync log" path={data.syncLogPath} lines={data.syncLogLines} />
        )}

        {tab === "mqtt" && data && (
          <LogPanel
            title="MQTT mirror log"
            path={data.mqttLogPath}
            lines={data.mqttLogLines}
            emptyMessage={data.mirrorConfigured ? "Mirror log empty or not created yet." : "MQTT mirror is not configured."}
          />
        )}
      </div>
    </div>
  );
}
