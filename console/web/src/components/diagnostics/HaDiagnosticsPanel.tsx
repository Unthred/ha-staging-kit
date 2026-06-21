import { useEffect, useMemo, useState } from "react";
import type { ComponentIssue, HaLogSnapshot } from "../../api";
import { SectionAttentionBadge } from "../PageAttentionPanel";
import { buildHaIssueLogDisplay, haIssueLogEmptyHint, type HaIssueLogViewMode } from "../../lib/logLineStyle";
import { buildHaIssueInsight } from "../../lib/haIssueInsight";
import { ColoredLogView } from "./ColoredLogView";
import { HaIssueLogInsight } from "./HaIssueLogInsight";
import { StagingTokenRefreshHelp } from "./StagingTokenRefreshHelp";
import { ResizableSplitPane } from "../ResizableSplitPane";

type InstanceTab = "staging" | "production";

const INSTANCE_SOURCES: Record<InstanceTab, string> = {
  staging: "Staging HA",
  production: "Production HA",
};

function sortedIssues(issues: ComponentIssue[]) {
  return [...issues].sort((a, b) => {
    if (a.level !== b.level) return a.level === "error" ? -1 : 1;
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.message.localeCompare(b.message);
  });
}

function countIssuesForSource(issues: ComponentIssue[], source: string) {
  return issues.filter((i) => i.source === source).length;
}

function logForSource(data: { prodHaLog: HaLogSnapshot; stagingHaLog: HaLogSnapshot }, source: string) {
  return source === "Production HA" ? data.prodHaLog : data.stagingHaLog;
}

export function HaDiagnosticsPanel({
  issues,
  prodHaLog,
  stagingHaLog,
  stagingUrl,
  selectedIndex,
  onSelectIndex,
}: {
  issues: ComponentIssue[];
  prodHaLog: HaLogSnapshot;
  stagingHaLog: HaLogSnapshot;
  stagingUrl?: string | null;
  selectedIndex: number | null;
  onSelectIndex: (index: number | null) => void;
}) {
  const ordered = useMemo(() => sortedIssues(issues), [issues]);
  const [instanceTab, setInstanceTab] = useState<InstanceTab>("staging");
  const [viewMode, setViewMode] = useState<HaIssueLogViewMode>("filtered");

  const visibleIssues = useMemo(
    () => ordered.filter((issue) => issue.source === INSTANCE_SOURCES[instanceTab]),
    [ordered, instanceTab],
  );

  const stagingCount = useMemo(() => countIssuesForSource(ordered, "Staging HA"), [ordered]);
  const prodCount = useMemo(() => countIssuesForSource(ordered, "Production HA"), [ordered]);

  const selected =
    selectedIndex !== null && selectedIndex >= 0 && selectedIndex < ordered.length
      ? ordered[selectedIndex]
      : null;

  useEffect(() => {
    if (selected && selected.source !== INSTANCE_SOURCES[instanceTab]) {
      setInstanceTab(selected.source === "Production HA" ? "production" : "staging");
    }
  }, [selected, instanceTab]);

  useEffect(() => {
    setViewMode("filtered");
  }, [selectedIndex, instanceTab]);

  const activeLog = selected ? logForSource({ prodHaLog, stagingHaLog }, selected.source) : null;
  const logDisplay =
    selected && activeLog ? buildHaIssueLogDisplay(selected, activeLog.lines, viewMode) : null;
  const hasMatches = (logDisplay?.matchCount ?? 0) > 0;
  const isKitDiagnostic = selected?.domain === "_kit";
  const issueInsight =
    selected && !isKitDiagnostic
      ? buildHaIssueInsight(selected, logDisplay?.entries, selected.source)
      : null;

  const selectInstanceTab = (tab: InstanceTab) => {
    setInstanceTab(tab);
    if (selected && selected.source !== INSTANCE_SOURCES[tab]) {
      onSelectIndex(null);
    }
  };

  return (
    <div id="diag-ha-logs" className="diag-ha-workbench-wrap">
      <ResizableSplitPane
        id="diag-ha-integrations"
        className="diag-ha-workbench ui-split-pane--inset"
        defaultRatio={0.34}
        minStartPx={200}
        minEndPx={240}
        start={
          <div className="diag-ha-list-column">
            <header className="diag-section-head">
              <h3>Integration issues</h3>
            </header>

            <div
              className="deploy-lovelace-gate-list-tabs diag-ha-instance-tabs"
              role="tablist"
              aria-label="HA instance"
            >
              <button
                type="button"
                role="tab"
                aria-selected={instanceTab === "staging"}
                className={`deploy-lovelace-gate-list-tab${instanceTab === "staging" ? " active" : ""}`}
                onClick={() => selectInstanceTab("staging")}
              >
                Staging
                {stagingCount > 0 ? <SectionAttentionBadge count={stagingCount} /> : null}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={instanceTab === "production"}
                className={`deploy-lovelace-gate-list-tab${instanceTab === "production" ? " active" : ""}`}
                onClick={() => selectInstanceTab("production")}
              >
                Production
                {prodCount > 0 ? <SectionAttentionBadge count={prodCount} /> : null}
              </button>
            </div>

            <p className="muted diag-section-hint diag-ha-instance-hint">
              {visibleIssues.length === 0
                ? `No failed or retrying integrations on ${INSTANCE_SOURCES[instanceTab]} right now — a recent restart may have cleared startup errors until they retry.`
                : `${visibleIssues.length} issue${visibleIssues.length === 1 ? "" : "s"} — select one to show log details`}
            </p>

            {visibleIssues.length === 0 ? (
              <p className="muted diag-log-empty">Integrations look healthy in config entries.</p>
            ) : (
              <ul className="diag-ha-issue-list ui-master-detail-scroll">
                {visibleIssues.map((issue) => {
                  const globalIndex = ordered.indexOf(issue);
                  return (
                    <li key={`${issue.source}-${issue.message}`}>
                      <button
                        type="button"
                        className={`diag-ha-issue-btn diag-ha-issue-btn--${issue.level}${selectedIndex === globalIndex ? " is-selected" : ""}`}
                        onClick={() => onSelectIndex(selectedIndex === globalIndex ? null : globalIndex)}
                      >
                        <span className="diag-ha-issue-badge">{issue.level}</span>
                        <span className="diag-ha-issue-text">
                          <span className="diag-ha-issue-message">{issue.message.split(" — ")[0]}</span>
                          {issue.reason?.trim() || issue.message.includes(" — ") ? (
                            <span className="diag-ha-issue-reason muted">
                              {issue.reason?.trim() || issue.message.split(" — ").slice(1).join(" — ")}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        }
        end={
          <div className="diag-ha-detail-column">
            <header className="diag-log-head">
              <div>
                <h3>{selected ? activeLog?.instanceLabel : "Core log"}</h3>
                {selected && activeLog && logDisplay && hasMatches && (
                  <p className="muted diag-section-hint">
                    {logDisplay.blockCount} log block{logDisplay.blockCount === 1 ? "" : "s"} · {logDisplay.matchCount}{" "}
                    direct match{logDisplay.matchCount === 1 ? "" : "es"}
                    {viewMode === "full" ? " · full log with highlights" : viewMode === "tail" ? " · recent tail" : ""}
                  </p>
                )}
                {!selected && (
                  <p className="muted diag-section-hint">Select an integration issue to show matching log lines.</p>
                )}
              </div>
              {selected && activeLog && activeLog.lines.length > 0 && (
                <div className="diag-ha-log-actions">
                  {hasMatches && (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setViewMode((m) => (m === "full" ? "filtered" : "full"))}
                    >
                      {viewMode === "full" ? "Matching only" : "Full log"}
                    </button>
                  )}
                  {!hasMatches && viewMode !== "tail" && (
                    <button type="button" className="btn ghost" onClick={() => setViewMode("tail")}>
                      Recent tail
                    </button>
                  )}
                  {!hasMatches && viewMode === "tail" && (
                    <button type="button" className="btn ghost" onClick={() => setViewMode("filtered")}>
                      Hide tail
                    </button>
                  )}
                </div>
              )}
            </header>
            <div className="ui-master-detail-scroll diag-ha-detail-body">
              {!selected ? (
                <p className="muted diag-log-empty">Pick an issue from the list.</p>
              ) : isKitDiagnostic ? (
                <div className="diag-log-empty diag-ha-log-empty">
                  <p className="diag-token-help-title">{selected.message}</p>
                  {selected.source === "Staging HA" ? (
                    <StagingTokenRefreshHelp stagingUrl={stagingUrl} />
                  ) : (
                    <p className="muted">
                      Regenerate the production read token in{" "}
                      <strong>Settings → Production connection</strong> and use <strong>Test production API</strong>.
                    </p>
                  )}
                </div>
              ) : !activeLog || activeLog.lines.length === 0 ? (
                <p className="muted diag-log-empty">Log empty or unavailable for {activeLog?.instanceLabel}.</p>
              ) : !logDisplay || logDisplay.entries.length === 0 ? (
                <div className="diag-log-empty diag-ha-log-empty">
                  {issueInsight ? <HaIssueLogInsight insight={issueInsight} /> : null}
                  <p>{selected ? haIssueLogEmptyHint(selected) : "No log lines to show."}</p>
                </div>
              ) : (
                <>
                  {issueInsight ? <HaIssueLogInsight insight={issueInsight} /> : null}
                  <ColoredLogView entries={logDisplay.entries} />
                </>
              )}
            </div>
          </div>
        }
      />
    </div>
  );
}
