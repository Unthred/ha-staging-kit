import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  ConfigDriftStatus,
  ConfigInventoryStats,
  DashboardStatus,
  EntityDomainParity,
  EntityParitySnapshot,
  GitSnapshot,
  HaMonitoringStats,
  LovelaceDriftStatus,
  MqttBridgeStats,
  PresenceSummary,
  StagingRepresentationStatus,
} from "../../api";
import { useStableMinHeight } from "../../hooks/useStableMinHeight";
import { dashboardApi, operationsApi } from "../../api";
import { ActionButton } from "../ActionButton";
import { GitUncommittedFilesDialog } from "./GitUncommittedFilesDialog";
import { EntityParityListDialog } from "./EntityParityListDialog";
import { DashboardParityBanner } from "./DashboardParityBanner";
import { isMirrorControlMode } from "../../lib/mirrorMode";
import {
  dashboardGitColumnLabel,
  dashboardShipPhase,
  type DashboardShipPhase,
  githubCompareAligned,
  githubCompareGitColumn,
  githubCompareStagingColumn,
  lovelaceInGitDirty,
  prodHaStatusLabel,
  prodHaYamlPending,
  prodHelperBundlePending,
  prodLovelaceBundlePending,
  prodStorageBundlePending,
  stagingDocsOnlyOnGitHub,
  stagingProdPathPending,
} from "../../lib/gitWorkflow";

export type MonitoringRowKey =
  | "config"
  | "staging-main"
  | "main-prod"
  | "dashboard"
  | "automation"
  | "script"
  | "person"
  | "mqtt"
  | "sensor";

type MetricRow = {
  key: MonitoringRowKey;
  label: string;
  git?: string | number;
  prod?: string | number;
  staging?: string | number;
  aligned?: boolean;
  selectable: boolean;
};

function parityClass(aligned?: boolean) {
  if (aligned == null) return "";
  return aligned ? "match" : "diff";
}

function EntityList({
  title,
  ids,
  total,
  onShowAll,
}: {
  title: string;
  ids: string[];
  total: number;
  onShowAll?: () => void;
}) {
  if (total === 0) return null;
  const extra = total - ids.length;
  return (
    <div>
      <p className="dash-detail-files-col-title">{title} ({total})</p>
      <ul className="dash-detail-file-list">
        {ids.map((id) => (
          <li key={id}>
            <code title={id}>{id}</code>
          </li>
        ))}
      </ul>
      {extra > 0 && (
        onShowAll ? (
          <button type="button" className="dash-parity-more-btn muted" onClick={onShowAll}>
            + {extra} more — show all
          </button>
        ) : (
          <p className="muted dash-parity-more">+ {extra} more</p>
        )
      )}
    </div>
  );
}

function DetailPaneIntro({
  hint,
  summary,
  tone,
}: {
  hint: string;
  summary: string;
  tone?: "ok" | "warn" | "muted";
}) {
  const summaryClass =
    tone === "warn" ? "dash-detail-warn" : tone === "ok" ? "dash-detail-ok" : "dash-detail-lead";
  return (
    <>
      <p className="muted dash-detail-lead">{hint}</p>
      <p className={summaryClass}>{summary}</p>
    </>
  );
}

function DetailFileColumns({
  columns,
  onFileClick,
}: {
  columns: { title: string; files: string[]; variant?: "ha" | "docs" }[];
  onFileClick?: (path: string) => void;
}) {
  const visible = columns.filter((c) => c.files.length > 0);
  if (visible.length === 0) return null;
  return (
    <div className={`dash-detail-files-grid ${visible.length === 1 ? "dash-detail-files-grid-single" : ""}`}>
      {visible.map((col) => (
        <div key={col.title}>
          <p
            className={`dash-detail-files-col-title${col.variant === "ha" ? " dash-detail-files-col-title-ha" : ""}`}
          >
            {col.title} ({col.files.length})
          </p>
          <ul className="dash-detail-file-list">
            {col.files.map((f) => (
              <li key={f}>
                {onFileClick ? (
                  <button type="button" className="dash-detail-file-btn" onClick={() => onFileClick(f)} title={f}>
                    <code>{f}</code>
                  </button>
                ) : (
                  <code title={f}>{f}</code>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function DetailReviewButton({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button type="button" className="dash-detail-link-btn" onClick={onClick}>
      {label}
    </button>
  );
}

function classifyIds(ids: string[], expectedOnly: boolean) {
  if (expectedOnly) return { unexpected: [] as string[], expected: ids };
  const expected: string[] = [];
  const unexpected: string[] = [];
  for (const id of ids) {
    if (isExpectedKitEntity(id)) expected.push(id);
    else unexpected.push(id);
  }
  return { unexpected, expected };
}

function isExpectedKitEntity(entityId: string) {
  const dot = entityId.indexOf(".");
  if (dot < 0) return false;
  const name = entityId.slice(dot + 1);
  return name.startsWith("staging_") || name.includes("staging_person_sync") || name.includes("staging_disable");
}

function DomainDetail({
  domain,
  domainData,
  gitHint,
  introHint,
  introSummary,
  introTone,
  automationGitGap,
  onShowProdOnly,
}: {
  domain: string;
  domainData?: EntityDomainParity;
  gitHint?: number;
  introHint?: string;
  introSummary?: string;
  introTone?: "ok" | "warn" | "muted";
  automationGitGap?: import("../../api").AutomationGitGapSnapshot | null;
  onShowProdOnly?: () => void;
}) {
  if (!domainData) {
    return (
      <DetailPaneIntro
        hint={introHint ?? `Live ${domain} entities on prod vs staging HA.`}
        summary={introSummary ?? `Counts match${gitHint != null ? ` (git YAML defines ${gitHint})` : ""}.`}
        tone={introTone ?? "ok"}
      />
    );
  }

  const prodOnly = classifyIds(domainData.prodOnlySample, false);
  const stagingOnly = classifyIds(domainData.stagingOnlySample, false);
  const informational = domain === "sensor";
  const unexpectedProd = domainData.unexpectedProdOnlyCount;
  const unexpectedStaging = domainData.unexpectedStagingOnlyCount;
  const aligned = unexpectedProd === 0 && unexpectedStaging === 0;

  let summary: string;
  if (aligned && domainData.prodOnlyCount === 0 && domainData.stagingOnlyCount === 0) {
    summary = "No entity ID differences in this domain.";
  } else if (informational) {
    summary = `${domainData.prodOnlyCount} on prod only · ${domainData.stagingOnlyCount} on staging — often normal for sensors.`;
  } else {
    summary = `${unexpectedProd} missing on staging · ${unexpectedStaging} extra on staging.`;
  }

  return (
    <>
      <DetailPaneIntro
        hint={introHint ?? `Live ${domain} entities — prod HA Green vs staging HA.`}
        summary={introSummary ?? summary}
        tone={introTone ?? (aligned || informational ? "muted" : "warn")}
      />
      {informational && domainData.prodOnlyCount > 0 && (
        <p className="dash-detail-lead muted">
          Sensor counts compare live states (not the full entity registry). Staging keeps most entity IDs via
          storage sync — missing live values are often expected until the MQTT mirror or Phase 2 state mirror
          fills them in.
        </p>
      )}
      {domain === "automation" && automationGitGap?.available && automationGitGap.missingFromGitCount > 0 && (
        <div className="dash-automation-git-gap">
          <p className="dash-detail-warn">
            {automationGitGap.missingFromGitCount} automation(s) run on prod/staging but are not in git YAML (
            {automationGitGap.gitAutomationCount} in git vs {automationGitGap.haAutomationCount} loaded in HA).
          </p>
          <ul className="dash-detail-file-list">
            {automationGitGap.missingFromGit.map((row) => (
              <li key={row.id}>
                <code title={row.entityId}>{row.alias}</code>
                <span className="muted"> — id {row.id}</span>
              </li>
            ))}
          </ul>
          <p className="muted dash-detail-lead">
            These were created or edited in the HA UI and never exported into automations.yaml/packages. Baseline
            from prod rsyncs YAML only — it does not capture UI-only automation storage. Export them on prod (or
            copy into git) before the next baseline.
          </p>
        </div>
      )}
      <div
        className={`dash-detail-files-grid ${
          !informational && prodOnly.unexpected.length > 0 && stagingOnly.unexpected.length > 0
            ? ""
            : "dash-detail-files-grid-single"
        }`}
      >
        {!informational && unexpectedProd > 0 && (
          <EntityList title="Missing on staging" ids={prodOnly.unexpected} total={unexpectedProd} />
        )}
        {!informational && unexpectedStaging > 0 && (
          <EntityList title="Extra on staging" ids={stagingOnly.unexpected} total={unexpectedStaging} />
        )}
        {informational && domainData.prodOnlyCount > 0 && (
          <EntityList
            title="On production only (live state)"
            ids={domainData.prodOnlySample}
            total={domainData.prodOnlyCount}
            onShowAll={onShowProdOnly}
          />
        )}
        {stagingOnly.expected.length > 0 && (
          <EntityList title="Expected kit entities on staging" ids={stagingOnly.expected} total={stagingOnly.expected.length} />
        )}
      </div>
    </>
  );
}

function DashboardShipSteps({
  git,
  lovelaceDrift,
}: {
  git?: GitSnapshot | null;
  lovelaceDrift?: LovelaceDriftStatus | null;
}) {
  const phase = dashboardShipPhase(git, lovelaceDrift);
  const steps: { id: DashboardShipPhase; label: string }[] = [
    { id: "import", label: "Import from staging HA → git workbench" },
    { id: "commit", label: "Commit staging files" },
    { id: "push", label: "Push to GitHub" },
    { id: "merge", label: "Merge staging → main on GitHub" },
    { id: "release", label: "Request release to prod HA" },
  ];
  const order: DashboardShipPhase[] = ["import", "commit", "push", "merge", "release", "done"];
  const phaseIndex = order.indexOf(phase);

  return (
    <ol className="dash-detail-ship-steps">
      {steps.map((step) => {
        const stepIndex = order.indexOf(step.id);
        const done = phaseIndex > stepIndex;
        const current = phase === step.id;
        return (
          <li
            key={step.id}
            className={`dash-detail-ship-step${done ? " dash-detail-ship-step-done" : ""}${current ? " dash-detail-ship-step-current" : ""}`}
          >
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}

function DetailActions({
  rowKey,
  representation,
  configDrift,
  git,
  lovelaceDrift,
  mirror,
  gitConfigured,
  mirrorConfigured,
  onDone,
  onCommitOpen,
}: {
  rowKey: MonitoringRowKey;
  representation?: StagingRepresentationStatus | null;
  configDrift?: ConfigDriftStatus | null;
  git?: GitSnapshot | null;
  lovelaceDrift?: LovelaceDriftStatus | null;
  mirror?: DashboardStatus["mirror"];
  gitConfigured: boolean;
  mirrorConfigured: boolean;
  onDone?: () => void;
  onCommitOpen?: () => void;
}) {
  const actions: {
    key: string;
    label: string;
    preset: "apply-config" | "person-poll" | "refresh-mirror" | "mirror-readonly" | "snapshot-staging";
    variant?: "secondary" | "danger";
    disabled?: boolean;
    disabledReason?: string;
    run: () => ReturnType<typeof operationsApi.applyConfig>;
  }[] = [];

  if (rowKey === "config" && configDrift?.hasDrift) {
    if (configDrift.applyGapHasHaChanges) {
      actions.push({
        key: "reload",
        label: "Reload from repo",
        preset: "apply-config",
        run: operationsApi.applyConfig,
      });
    } else if (configDrift.lastAppliedCommit) {
      actions.push({
        key: "reload-marker",
        label: "Refresh apply marker",
        preset: "apply-config",
        variant: "secondary",
        run: operationsApi.applyConfig,
      });
    }
  }

  if (rowKey === "person" && !representation?.presenceMatches) {
    actions.push({
      key: "poll",
      label: "Person poll",
      preset: "person-poll",
      variant: "secondary",
      run: operationsApi.personPoll,
    });
  }

  if (rowKey === "mqtt") {
    if (mirrorConfigured && mirror && !mirror.running) {
      actions.push({
        key: "mirror",
        label: "Deploy mirror",
        preset: "refresh-mirror",
        run: operationsApi.deployMirror,
      });
    }
    if (mirrorConfigured && mirror && isMirrorControlMode(mirror.mode)) {
      actions.push({
        key: "readonly",
        label: "Switch to read-only",
        preset: "mirror-readonly",
        variant: "danger",
        run: () => operationsApi.setMirrorMode(false),
      });
    }
  }

  const dashboardPhase = rowKey === "dashboard" ? dashboardShipPhase(git, lovelaceDrift) : "done";
  const showImportDashboard =
    rowKey === "dashboard" &&
    ((lovelaceDrift?.stagingDiffersFromRepo ?? false) || dashboardPhase === "import") &&
    !lovelaceInGitDirty(git);
  const showCommitDashboard =
    rowKey === "dashboard" && lovelaceInGitDirty(git) && Boolean(onCommitOpen);

  if (showImportDashboard) {
    actions.push({
      key: "import-dashboard",
      label: "Import from staging HA",
      preset: "snapshot-staging",
      run: operationsApi.snapshotFromStaging,
    });
  }

  if (actions.length === 0 && !showCommitDashboard) {
    const docsOnlyConfigDrift =
      configDrift?.hasDrift && !configDrift.applyGapHasHaChanges && Boolean(configDrift.lastAppliedCommit);
    const prodHaCurrent = rowKey === "main-prod" && !prodHaYamlPending(git);
    if (representation?.verdict === "aligned" || docsOnlyConfigDrift || prodHaCurrent) {
      if (rowKey !== "sensor") {
        return (
          <div className="dash-detail-actions">
            <p className="dash-detail-ok dash-detail-actions-empty">No action needed for this row.</p>
          </div>
        );
      }
    }
    return (
      <div className="dash-detail-actions">
        <p className="dash-detail-more muted">
          <Link to="/operations">All operations</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="dash-detail-actions">
      <div className="ops-actions dash-detail-actions-secondary">
        {actions.map((action) => (
          <ActionButton
            key={action.key}
            label={action.label}
            toastPreset={action.preset}
            variant={action.variant}
            onRun={action.run}
            onDone={onDone}
            disabled={action.disabled || (!gitConfigured && action.key === "reload")}
            title={action.disabledReason}
          />
        ))}
        {showCommitDashboard && (
          <button type="button" className="btn primary" onClick={onCommitOpen}>
            Commit dashboard change
          </button>
        )}
      </div>
      {rowKey === "dashboard" && dashboardPhase === "push" && (
        <p className="dash-detail-more muted">Next: use Push to GitHub in the ship workflow below.</p>
      )}
      {rowKey === "dashboard" && (dashboardPhase === "merge" || dashboardPhase === "release") && (
        <p className="dash-detail-more muted">
          Next: {dashboardPhase === "merge" ? "merge staging → main, then" : ""} request release in the ship workflow
          below.
        </p>
      )}
      <p className="dash-detail-more muted">
        <Link to="/operations">More operations</Link>
      </p>
    </div>
  );
}

function monitoringRowDomain(rowKey: MonitoringRowKey, entityParity?: EntityParitySnapshot | null) {
  if (rowKey === "config") return undefined;
  const domain = rowKey === "person" ? "person" : rowKey;
  return entityParity?.domains.find((d) => d.domain === domain);
}

function MonitoringDetailPane({
  rowKey,
  inventory,
  entityParity,
  representation,
  configDrift,
  git,
  presence,
  mqtt,
  onShowUncommittedFiles,
  onShowStagingDiff,
  onShowMainProdDiff,
  onShowStagingProdLovelaceDiff,
  onShowUnpushedPushPreview,
  lovelaceDrift,
  onShowEntityParity,
}: {
  rowKey: MonitoringRowKey;
  inventory?: ConfigInventoryStats | null;
  entityParity?: EntityParitySnapshot | null;
  representation?: StagingRepresentationStatus | null;
  configDrift?: ConfigDriftStatus | null;
  git?: GitSnapshot | null;
  presence?: PresenceSummary | null;
  mqtt?: MqttBridgeStats | null;
  lovelaceDrift?: LovelaceDriftStatus | null;
  onShowUncommittedFiles?: () => void;
  onShowStagingDiff?: () => void;
  onShowMainProdDiff?: () => void;
  onShowStagingProdLovelaceDiff?: () => void;
  onShowUnpushedPushPreview?: (path?: string) => void;
  onShowEntityParity?: (domain: string, side: "prodOnly" | "stagingOnly") => void;
}) {
  const domainMap = new Map((entityParity?.domains ?? []).map((d) => [d.domain, d]));
  const resolvedDomain = monitoringRowDomain(rowKey, entityParity);
  const buckets = mqtt?.activityBuckets ?? [];
  const max = Math.max(...buckets.map((b) => b.events), 1);
  const width = 280;
  const height = 72;
  const barW = buckets.length > 0 ? Math.max(6, Math.floor(width / buckets.length) - 4) : 8;

  if (rowKey === "config") {
    const haCount = git?.haChangedFileCount ?? 0;
    const repoCount = git?.repoChangedFileCount ?? 0;
    const lovelaceFiles = (git?.haChangedFiles ?? []).filter((f) => f.includes("lovelace"));
    const otherHaFiles = (git?.haChangedFiles ?? []).filter((f) => !f.includes("lovelace"));
    return (
      <>
        <DetailPaneIntro
          hint="Local kit repo — review here before Commit staging files in the wizard above."
          summary={
            git?.isDirty
              ? `${git.changedFileCount} uncommitted file${git.changedFileCount === 1 ? "" : "s"} (${haCount} HA, ${repoCount} docs/repo).`
              : "Nothing uncommitted locally."
          }
          tone={git?.isDirty ? undefined : configDrift?.hasDrift ? (configDrift.applyGapHasHaChanges ? "warn" : "muted") : "ok"}
        />
        {!git?.isDirty && configDrift?.hasDrift && (
          <p className={configDrift.applyGapHasHaChanges ? "dash-detail-warn" : "muted"}>
            {configDrift.detail}
            {!configDrift.applyGapHasHaChanges && configDrift.lastAppliedCommit && (
              <> Optional: use Refresh apply marker below to clear the kit bookkeeping row.</>
            )}
          </p>
        )}
        <DetailFileColumns
          columns={[
            {
              title: lovelaceFiles.length > 0 ? "Lovelace / .storage (parity fixes)" : "HA YAML / .storage",
              files: lovelaceFiles.length > 0 ? lovelaceFiles : otherHaFiles.length > 0 ? otherHaFiles : git?.haChangedSample ?? [],
              variant: "ha",
            },
            {
              title: lovelaceFiles.length > 0 && otherHaFiles.length > 0 ? "Other HA files" : "Docs / repo",
              files:
                lovelaceFiles.length > 0 && otherHaFiles.length > 0
                  ? otherHaFiles
                  : git?.repoChangedFiles ?? git?.repoChangedSample ?? [],
              variant: lovelaceFiles.length > 0 && otherHaFiles.length > 0 ? "ha" : "docs",
            },
          ]}
        />
        <DetailReviewButton
          label={`Review diffs (${git?.changedFileCount ?? 0} file${(git?.changedFileCount ?? 0) === 1 ? "" : "s"})…`}
          onClick={git?.isDirty ? onShowUncommittedFiles : undefined}
        />
      </>
    );
  }

  if (rowKey === "dashboard") {
    const changed = lovelaceDrift?.changedPaths ?? [];
    const differsProd = lovelaceDrift?.stagingDiffersFromProd ?? false;
    const differsRepo = lovelaceDrift?.stagingDiffersFromRepo ?? false;
    const shipPhase = dashboardShipPhase(git, lovelaceDrift);
    const docsOnlyOnGithub = stagingDocsOnlyOnGitHub(git);
    const lovelaceDirty = lovelaceInGitDirty(git);

    let summary = lovelaceDrift?.detail ?? "Dashboard parity unavailable — check staging mount and prod SSH.";
    if (lovelaceDirty && shipPhase === "commit") {
      summary =
        "Dashboard change is in the git workbench (uncommitted). Commit it, push to GitHub, merge to main, then request release.";
    } else if (differsRepo && shipPhase === "import") {
      summary =
        `Staging HA title is “${lovelaceDrift?.stagingTitle ?? "?"}” but git still has “${lovelaceDrift?.repoTitle ?? "?"}”. ` +
        "Click Import below, or refresh — the kit will pull staging into git, then you can commit.";
    } else if (shipPhase === "push") {
      summary = "Dashboard change is committed locally — push to GitHub next.";
    } else if (shipPhase === "merge") {
      summary = "Dashboard is on GitHub staging — merge to main before prod release.";
    } else if (shipPhase === "release") {
      summary = "Dashboard is ready for prod — request release when Entity Janitor passes.";
    }

    return (
      <>
        <DetailPaneIntro
          hint="Live Lovelace on staging HA vs git workbench vs prod — not the same track as docs-only GitHub pushes."
          summary={summary}
          tone={shipPhase === "done" ? "ok" : differsProd || differsRepo || lovelaceDirty ? "warn" : lovelaceDrift?.available ? "ok" : undefined}
        />
        {(lovelaceDrift?.stagingTitle || lovelaceDrift?.prodTitle || lovelaceDrift?.repoTitle) && (
          <p className="dash-detail-meta muted">
            Staging HA: “{lovelaceDrift.stagingTitle ?? "—"}” · Prod: “{lovelaceDrift.prodTitle ?? "—"}” · Git
            workbench: “{lovelaceDrift.repoTitle ?? "—"}”
            {docsOnlyOnGithub ? " · Docs push did not ship this file" : ""}
          </p>
        )}
        {shipPhase !== "done" && <DashboardShipSteps git={git} lovelaceDrift={lovelaceDrift} />}
        <DetailFileColumns
          columns={[
            {
              title: "Lovelace diff (staging HA vs prod)",
              files: changed.length > 0 ? changed : [".storage/lovelace.lovelace"],
              variant: "ha",
            },
          ]}
          onFileClick={lovelaceDrift?.available ? () => onShowStagingProdLovelaceDiff?.() : undefined}
        />
        <DetailReviewButton
          label={`Review dashboard diff${changed.length > 0 ? ` (${changed.length} file${changed.length === 1 ? "" : "s"})` : ""}…`}
          onClick={lovelaceDrift?.available ? onShowStagingProdLovelaceDiff : undefined}
        />
        {lovelaceDirty && (
          <DetailReviewButton label="Review & commit dashboard in git…" onClick={onShowUncommittedFiles} />
        )}
      </>
    );
  }

  if (rowKey === "staging-main") {
    const unpushed = git?.commitsAhead ?? 0;
    const ahead = git?.stagingAheadOfMain ?? 0;
    const haFiles = git?.stagingHaFileList ?? [];
    const repoFiles = git?.stagingRepoFileList ?? [];
    const haCount = git?.stagingHaChanges ?? 0;
    const unpushedHaFiles = git?.unpushedHaFiles ?? [];
    const unpushedRepoFiles = git?.unpushedRepoFiles ?? [];
    const unpushedCommits = git?.unpushedCommits ?? [];
    const pushTarget = git?.unpushedRemoteRef ?? `origin/${git?.branch ?? "staging"}`;

    let summary: string;
    if (unpushed > 0) {
      const commitLine =
        unpushedCommits.length === 1
          ? `“${unpushedCommits[0].subject}” (${unpushedCommits[0].shortSha})`
          : unpushedCommits.length > 1
            ? `${unpushedCommits.length} commits — newest: “${unpushedCommits[0].subject}”`
            : git?.commitSubject
              ? `“${git.commitSubject}” (${git.commitHash ?? "HEAD"})`
              : `${unpushed} local commit(s)`;
      const prodNote =
        unpushedHaFiles.length > 0
          ? " Includes HA config — merge to main and request release before prod changes."
          : unpushedRepoFiles.length > 0
            ? " Docs/repo only — nothing in this push reaches prod HA."
            : "";
      summary = `${unpushed} commit${unpushed === 1 ? "" : "s"} will push to ${pushTarget}: ${commitLine}.${prodNote}`;
    } else if ((git?.isHaDirty ?? false) && (git?.haChangedFileCount ?? 0) > 0) {
      summary = `${git!.haChangedFileCount} HA file${git!.haChangedFileCount === 1 ? "" : "s"} changed on staging but not committed — commit before push or deploy.`;
    } else if (stagingDocsOnlyOnGitHub(git)) {
      summary =
        "Docs on GitHub staging only — they never reach prod HA. Nothing to review here once pushed.";
    } else if (ahead === 0) {
      summary = "GitHub staging branch matches main.";
    } else if (stagingProdPathPending(git)) {
      summary = `${ahead} commit${ahead === 1 ? "" : "s"} on GitHub staging (${haCount} HA file${haCount === 1 ? "" : "s"}) not merged to main — stays until prod picks it up.`;
    } else {
      summary = "GitHub staging branch matches main for prod-relevant work.";
    }

    const docsOnlyDone = stagingDocsOnlyOnGitHub(git);
    const showStagingMainDiff = stagingProdPathPending(git);

    return (
      <>
        <DetailPaneIntro
          hint={
            unpushed > 0
              ? `Local commits not on GitHub yet — review exactly what Push to GitHub will upload to ${pushTarget}.`
              : docsOnlyDone
                ? "Compare Instances tracks the prod path only — docs on GitHub staging are ignored here."
                : "GitHub staging branch vs main — review HA work before merge or prod release."
          }
          summary={summary}
          tone={
            unpushed > 0 || (git?.isHaDirty ?? false) || showStagingMainDiff
              ? "warn"
              : docsOnlyDone || ahead === 0
                ? "ok"
                : "muted"
          }
        />
        {unpushed > 0 && unpushedCommits.length > 0 && (
          <ul className="dash-detail-commit-list">
            {unpushedCommits.map((commit) => (
              <li key={commit.shortSha}>
                <code>{commit.shortSha}</code> {commit.subject}
              </li>
            ))}
          </ul>
        )}
        {unpushed > 0 ? (
          <>
            <DetailFileColumns
              columns={[
                {
                  title: unpushedHaFiles.length > 0 ? "HA files in push" : "HA files in push",
                  files: unpushedHaFiles,
                  variant: "ha",
                },
                {
                  title: "Docs / repo in push",
                  files: unpushedRepoFiles,
                  variant: "docs",
                },
              ]}
              onFileClick={(path) => onShowUnpushedPushPreview?.(path)}
            />
            <DetailReviewButton
              label={`Review push preview (${unpushedHaFiles.length + unpushedRepoFiles.length} file${unpushedHaFiles.length + unpushedRepoFiles.length === 1 ? "" : "s"})…`}
              onClick={
                unpushedHaFiles.length + unpushedRepoFiles.length > 0
                  ? () => onShowUnpushedPushPreview?.()
                  : undefined
              }
            />
          </>
        ) : docsOnlyDone ? null : showStagingMainDiff ? (
          <>
            <DetailFileColumns
              columns={[{ title: "HA config on staging (prod path)", files: haFiles, variant: "ha" }]}
              onFileClick={haFiles.length > 0 ? () => onShowStagingDiff?.() : undefined}
            />
            {repoFiles.length > 0 && (
              <p className="dash-detail-meta muted">
                {repoFiles.length} doc/repo file{repoFiles.length === 1 ? "" : "s"} in the same staging
                commits — already on GitHub; not part of prod deploy.
              </p>
            )}
            <DetailReviewButton
              label={`Review ${haFiles.length} HA change${haFiles.length === 1 ? "" : "s"} vs main…`}
              onClick={haFiles.length > 0 ? onShowStagingDiff : undefined}
            />
          </>
        ) : null}
      </>
    );
  }

  if (rowKey === "main-prod") {
    const haFiles = git?.mainHaFileList ?? [];
    const storageFiles = git?.mainStorageFileList ?? [];
    const haCount = git?.mainHaChangesForProdHa ?? 0;
    const storageCount = git?.mainStorageChangesForProdHa ?? 0;
    const neverDeployed = git?.prodDeployTracked === false;
    const pending = prodHaYamlPending(git) || prodStorageBundlePending(git);
    const lovelaceBundle = prodLovelaceBundlePending(git);
    const helperBundle = prodHelperBundlePending(git);
    const lovelaceLocalFiles = (git?.haChangedFiles ?? []).filter((f) => f.includes("lovelace"));
    const hasLocalLovelaceFixes = lovelaceLocalFiles.length > 0;

    let summary: string;
    if (neverDeployed) {
      summary = `No prod deploy recorded yet — ${haCount + storageCount} change${haCount + storageCount === 1 ? "" : "s"} on GitHub main would apply on first deploy.`;
    } else if (!pending && storageCount === 0) {
      summary = "Prod HA matches the last deploy from GitHub main.";
    } else if (lovelaceBundle && haCount === 0 && !helperBundle) {
      summary =
        "Lovelace bundle on main will deploy to prod after the entity parity gate passes (lovelace.lovelace + map + dashboards + resources).";
    } else if (pending) {
      const storageNote =
        storageCount > 0
          ? lovelaceBundle && helperBundle
            ? " plus Lovelace + helper .storage bundle"
            : lovelaceBundle
              ? " plus Lovelace bundle"
              : " plus helper .storage"
          : "";
      summary = `${haCount} HA file${haCount === 1 ? "" : "s"} on GitHub main will deploy to prod${storageNote}.`;
    } else if (storageCount > 0) {
      summary = `${storageCount} .storage file${storageCount === 1 ? "" : "s"} changed on main — pending prod deploy.`;
    } else {
      summary = "Prod HA matches the last deploy from GitHub main.";
    }

    const storageColumnTitle = lovelaceBundle
      ? helperBundle
        ? "Will deploy (.storage bundle)"
        : "Will deploy (Lovelace bundle)"
      : helperBundle
        ? "Will deploy (helpers .storage)"
        : "Will deploy (.storage)";

    return (
      <>
        <DetailPaneIntro
          hint="Review exactly what Deploy to prod will touch before you run it. Lovelace deploy runs an entity + custom-card gate first."
          summary={summary}
          tone={neverDeployed || pending || storageCount > 0 ? "warn" : "ok"}
        />
        {hasLocalLovelaceFixes && (
          <>
            <DetailPaneIntro
              hint="These Lovelace edits are only in the local repo — commit and push before they affect GitHub main or deploy."
              summary={`${lovelaceLocalFiles.length} uncommitted Lovelace file${lovelaceLocalFiles.length === 1 ? "" : "s"} from parity fixes.`}
              tone="warn"
            />
            <DetailFileColumns
              columns={[
                {
                  title: "Local parity fixes (not on main yet)",
                  files: lovelaceLocalFiles,
                  variant: "ha",
                },
              ]}
            />
            <DetailReviewButton
              label={`Review local Lovelace diff${lovelaceLocalFiles.length === 1 ? "" : "s"}…`}
              onClick={onShowUncommittedFiles}
            />
          </>
        )}
        <DetailFileColumns
          columns={[
            { title: "Will deploy to prod (YAML)", files: haFiles, variant: "ha" },
            {
              title: storageCount > 0 ? storageColumnTitle : "No .storage changes",
              files: storageFiles,
              variant: storageCount > 0 ? "ha" : "docs",
            },
          ]}
        />
        {lovelaceBundle && (
          <p className="muted dash-parity-review-hint">
            Lovelace cards must reference entities that exist on prod. Custom cards must already be installed on prod
            (HACS). Entity registry is never copied from staging — add new devices on prod first, then storage-sync
            staging.
          </p>
        )}
        <DetailReviewButton
          label={`Review ${haFiles.length + storageFiles.length} pending change${haFiles.length + storageFiles.length === 1 ? "" : "s"}…`}
          onClick={haFiles.length + storageFiles.length > 0 ? onShowMainProdDiff : undefined}
        />
      </>
    );
  }

  if (rowKey === "person") {
    const personDomain = domainMap.get("person");
    return (
      <DomainDetail
        domain="person"
        domainData={personDomain}
        introSummary={presence?.detail ?? "Person entity parity."}
        introTone={representation?.presenceMatches ? "ok" : "warn"}
      />
    );
  }

  if (rowKey === "mqtt") {
    const mqttDomain = domainMap.get("mqtt");
    return (
      <>
        <DomainDetail
          domain="mqtt"
          domainData={mqttDomain}
          introHint="Live MQTT entities and mirror broker status."
          introSummary={
            mqtt?.available
              ? `Bridge ${mqtt.bridgeConnected ? "up" : "down"} · ${mqtt.connectedClients} client(s)`
              : "MQTT bridge not configured."
          }
          introTone={mqtt?.bridgeConnected ? "ok" : "warn"}
        />
        {mqtt?.available && (
          <div className="dash-mqtt-block dash-mqtt-block-compact">
            <div className="dash-mqtt-head">
              <h4>Mirror broker</h4>
              <span className={`dash-badge ${mqtt.bridgeConnected ? "dash-badge-ok" : "dash-badge-warn"}`}>
                {mqtt.bridgeConnected ? "Bridge up" : "Bridge down"} · {mqtt.connectedClients} client(s)
              </span>
            </div>
            {buckets.length > 0 ? (
              <svg viewBox={`0 0 ${width} ${height}`} className="dash-sparkline-svg" role="img" aria-label="MQTT activity chart">
                {buckets.map((point, i) => {
                  const h = Math.max(4, (point.events / max) * (height - 10));
                  const x = i * (barW + 4) + 2;
                  const y = height - h - 4;
                  return (
                    <rect key={`${point.at}-${i}`} x={x} y={y} width={barW} height={h} rx={3} className="dash-spark-bar-ok" />
                  );
                })}
              </svg>
            ) : (
              <p className="muted dash-empty">Broker quiet in the last hour.</p>
            )}
          </div>
        )}
      </>
    );
  }

  const gitHint =
    rowKey === "automation" ? inventory?.automationCount : rowKey === "script" ? inventory?.scriptCount : undefined;

  return (
    <div className="dash-detail-files-grid dash-detail-files-grid-single">
      <DomainDetail
        domain={rowKey}
        domainData={resolvedDomain}
        gitHint={gitHint}
        automationGitGap={rowKey === "automation" ? inventory?.automationGitGap : undefined}
        onShowProdOnly={
          resolvedDomain && resolvedDomain.prodOnlyCount > 0
            ? () => onShowEntityParity?.(rowKey, "prodOnly")
            : undefined
        }
      />
    </div>
  );
}

function pickDefaultRow(
  rows: MetricRow[],
  representation?: StagingRepresentationStatus | null,
  entityParity?: EntityParitySnapshot | null,
  git?: GitSnapshot | null,
  lovelaceDrift?: LovelaceDriftStatus | null,
): MonitoringRowKey {
  if (git?.isDirty) return "config";
  if ((git?.commitsAhead ?? 0) > 0) return "staging-main";
  if (stagingProdPathPending(git)) return "staging-main";
  const prodPending = prodHaYamlPending(git) || stagingProdPathPending(git);
  if (prodPending) return "main-prod";
  if (representation && representation.lovelaceAligned === false) return "dashboard";
  if (lovelaceDrift?.stagingDiffersFromProd || lovelaceDrift?.stagingDiffersFromRepo) return "dashboard";
  if (representation && !representation.configMatchesGit) return "config";
  if (entityParity && !entityParity.isAligned) {
    const firstDiff = entityParity.domains.find(
      (d) => d.domain !== "sensor" && (d.unexpectedProdOnlyCount > 0 || d.unexpectedStagingOnlyCount > 0),
    );
    if (firstDiff) return firstDiff.domain as MonitoringRowKey;
  }
  if (representation && !representation.presenceMatches) return "person";
  return rows[0]?.key ?? "config";
}

export function DashboardInstanceMonitoring({
  inventory,
  prod,
  staging,
  entityParity,
  representation,
  lovelaceDrift,
  configDrift,
  git,
  presence,
  mqtt,
  mirror,
  gitConfigured,
  mirrorConfigured,
  onRemediate,
  commitOpen,
  onCommitOpen,
  onCommitClose,
  attentionOrder,
}: {
  inventory?: ConfigInventoryStats | null;
  prod?: HaMonitoringStats | null;
  staging?: HaMonitoringStats | null;
  entityParity?: EntityParitySnapshot | null;
  representation?: StagingRepresentationStatus | null;
  lovelaceDrift?: LovelaceDriftStatus | null;
  configDrift?: ConfigDriftStatus | null;
  git?: GitSnapshot | null;
  presence?: PresenceSummary | null;
  mqtt?: MqttBridgeStats | null;
  mirror?: DashboardStatus["mirror"];
  gitConfigured?: boolean;
  mirrorConfigured?: boolean;
  onRemediate?: () => void;
  commitOpen?: boolean;
  onCommitOpen?: () => void;
  onCommitClose?: () => void;
  attentionOrder?: number;
}) {
  const boardStable = useStableMinHeight("overview-parity-board-v2");
  const rows: MetricRow[] = useMemo(() => {
    const domainAligned = new Map(
      (entityParity?.domains ?? []).map((d) => [
        d.domain,
        d.unexpectedProdOnlyCount === 0 && d.unexpectedStagingOnlyCount === 0,
      ]),
    );

    return [
      {
        key: "config",
        label: "Local changes",
        git: git?.isDirty
          ? `${git.changedFileCount} uncommitted`
          : git?.commitHash?.slice(0, 7) ?? "Clean",
        prod: "—",
        staging: git?.isDirty
          ? (git.haChangedFiles ?? []).some((f) => f.includes("lovelace"))
            ? `${git.haChangedFileCount} HA · Lovelace fixes`
            : `${git.haChangedFileCount} HA · ${git.repoChangedFileCount} docs`
          : configDrift?.hasDrift
            ? configDrift.applyGapHasHaChanges
              ? `${configDrift.applyGapHaFileCount} HA pending apply`
              : "Applied"
            : representation?.configMatchesGit
              ? "Applied"
              : "—",
        aligned: git?.isDirty
          ? false
          : configDrift?.hasDrift
            ? configDrift.applyGapHasHaChanges
              ? false
              : true
            : representation?.configMatchesGit,
        selectable: true,
      },
      {
        key: "staging-main",
        label: "GitHub",
        git: githubCompareGitColumn(git),
        prod: "—",
        staging: githubCompareStagingColumn(git),
        aligned: githubCompareAligned(git),
        selectable: true,
      },
      {
        key: "main-prod",
        label: "Prod HA Green",
        git:
          !git?.configured
            ? "—"
            : prodHaYamlPending(git)
              ? `${git.mainHaChangesForProdHa} HA on main`
              : prodHaStatusLabel(git),
        prod:
          !git?.configured
            ? "—"
            : prodHaYamlPending(git)
              ? `${git.mainHaChangesForProdHa} HA pending`
              : prodHaStatusLabel(git),
        staging: "—",
        aligned: !git?.configured || !prodHaYamlPending(git),
        selectable: true,
      },
      {
        key: "dashboard",
        label: "Dashboard",
        git: dashboardGitColumnLabel(git, lovelaceDrift),
        prod: lovelaceDrift?.prodTitle ?? "—",
        staging: lovelaceDrift?.stagingTitle ?? "—",
        aligned:
          lovelaceDrift?.available == null
            ? undefined
            : !lovelaceDrift.stagingDiffersFromProd && !lovelaceDrift.stagingDiffersFromRepo,
        selectable: true,
      },
      {
        key: "automation",
        label: "Automations",
        git: inventory?.automationCount,
        prod: prod?.available ? prod.automationEntities : "—",
        staging: staging?.available ? staging.automationEntities : "—",
        aligned: domainAligned.get("automation"),
        selectable: true,
      },
      {
        key: "script",
        label: "Scripts",
        git: inventory?.scriptCount,
        prod: prod?.available ? prod.scriptEntities : "—",
        staging: staging?.available ? staging.scriptEntities : "—",
        aligned: domainAligned.get("script"),
        selectable: true,
      },
      {
        key: "person",
        label: "Person entities",
        prod: prod?.available ? prod.personEntities : "—",
        staging: staging?.available ? staging.personEntities : "—",
        aligned: domainAligned.get("person") && representation?.presenceMatches,
        selectable: true,
      },
      {
        key: "mqtt",
        label: "MQTT entities",
        prod: prod?.available ? prod.mqttEntities : "—",
        staging: staging?.available ? staging.mqttEntities : "—",
        aligned: domainAligned.get("mqtt"),
        selectable: true,
      },
      {
        key: "sensor",
        label: "Sensors",
        prod: prod?.available ? prod.sensorEntities : "—",
        staging: staging?.available ? staging.sensorEntities : "—",
        aligned: undefined,
        selectable: true,
      },
    ];
  }, [inventory, prod, staging, git, configDrift, representation, entityParity, lovelaceDrift]);

  const [selectedKey, setSelectedKey] = useState<MonitoringRowKey>("config");
  const userPicked = useRef(false);

  useEffect(() => {
    if (userPicked.current) return;
    setSelectedKey(pickDefaultRow(rows, representation, entityParity, git, lovelaceDrift));
  }, [
    entityParity,
    representation,
    lovelaceDrift,
    configDrift?.hasDrift,
    git?.isDirty,
    git?.commitsAhead,
    git?.mainHaChangesForProdHa,
    git?.stagingHaChanges,
    rows,
  ]);

  const selectedRow = rows.find((r) => r.key === selectedKey) ?? rows[0];
  const [gitFilesOpenInternal, setGitFilesOpenInternal] = useState(false);
  const gitFilesOpen = commitOpen ?? gitFilesOpenInternal;
  const closeCommit = onCommitClose ?? (() => setGitFilesOpenInternal(false));
  const openCommit = onCommitOpen ?? (() => setGitFilesOpenInternal(true));
  const [stagingDiffOpen, setStagingDiffOpen] = useState(false);
  const [mainProdDiffOpen, setMainProdDiffOpen] = useState(false);
  const [stagingProdLovelaceDiffOpen, setStagingProdLovelaceDiffOpen] = useState(false);
  const [unpushedPushPreviewOpen, setUnpushedPushPreviewOpen] = useState(false);
  const [unpushedPreviewInitialPath, setUnpushedPreviewInitialPath] = useState<string | null>(null);
  const [entityParityOpen, setEntityParityOpen] = useState(false);
  const [entityParityDomain, setEntityParityDomain] = useState("sensor");
  const [entityParitySide, setEntityParitySide] = useState<"prodOnly" | "stagingOnly">("prodOnly");
  const unpushedPushTarget = git?.unpushedRemoteRef ?? `origin/${git?.branch ?? "staging"}`;
  const lovelaceDiffFiles =
    lovelaceDrift?.changedPaths && lovelaceDrift.changedPaths.length > 0
      ? lovelaceDrift.changedPaths
      : [".storage/lovelace.lovelace"];

  return (
    <div id="staging-parity" className="dash-live-primary">
      <section ref={boardStable.ref} style={boardStable.style} className="dash-panel dash-parity-board">
        <header className="dash-parity-board-header">
          <DashboardParityBanner
            embedded
            compact
            representation={representation}
            git={git}
            attentionOrder={attentionOrder}
          />
        </header>

        <div className="dash-parity-board-body">
          <section className="dash-parity-board-col dash-monitoring-table">
            <header className="dash-panel-head dash-panel-head-tight dash-parity-table-head">
              <h3>Compare instances</h3>
              <span className="muted dash-table-hint">Select a row for detail — ship actions are below</span>
            </header>
            <div className="dash-compare-table-wrap">
              <table className="dash-compare-table dash-compare-table-selectable">
                <thead>
                  <tr>
                    <th scope="col" />
                    <th scope="col">Kit / GitHub</th>
                    <th scope="col">Production</th>
                    <th scope="col">Staging HA</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const rowClass =
                      row.aligned == null ? parityClass(row.prod === row.staging) : parityClass(row.aligned);
                    const active = row.key === selectedKey;
                    return (
                      <tr
                        key={row.key}
                        className={`dash-compare-row ${active ? "dash-compare-row-active" : ""}`}
                        tabIndex={0}
                        aria-selected={active}
                        onClick={() => {
                          userPicked.current = true;
                          setSelectedKey(row.key);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            userPicked.current = true;
                            setSelectedKey(row.key);
                          }
                        }}
                      >
                        <th scope="row">{row.label}</th>
                        <td>{row.git ?? "—"}</td>
                        <td className={rowClass ? `dash-compare-${rowClass}` : undefined}>{row.prod ?? "—"}</td>
                        <td className={rowClass ? `dash-compare-${rowClass}` : undefined}>{row.staging ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="dash-parity-board-col dash-monitoring-detail" aria-live="polite">
            <header className="dash-panel-head dash-panel-head-tight">
              <h3>{selectedRow?.label ?? "Detail"}</h3>
              {selectedRow && selectedRow.aligned === false && (
                <span className="dash-badge dash-badge-warn">Review</span>
              )}
            </header>
            <div className="dash-monitoring-detail-body">
              <MonitoringDetailPane
                rowKey={selectedKey}
                inventory={inventory}
                entityParity={entityParity}
                representation={representation}
                configDrift={configDrift}
                git={git}
                presence={presence}
                mqtt={mqtt}
                lovelaceDrift={lovelaceDrift}
                onShowUncommittedFiles={openCommit}
                onShowStagingDiff={() => setStagingDiffOpen(true)}
                onShowMainProdDiff={() => setMainProdDiffOpen(true)}
                onShowStagingProdLovelaceDiff={() => setStagingProdLovelaceDiffOpen(true)}
                onShowUnpushedPushPreview={(path) => {
                  setUnpushedPreviewInitialPath(path ?? null);
                  setUnpushedPushPreviewOpen(true);
                }}
                onShowEntityParity={(domain, side) => {
                  setEntityParityDomain(domain);
                  setEntityParitySide(side);
                  setEntityParityOpen(true);
                }}
              />
            </div>
            <DetailActions
              rowKey={selectedKey}
              representation={representation}
              configDrift={configDrift}
              git={git}
              lovelaceDrift={lovelaceDrift}
              mirror={mirror}
              gitConfigured={gitConfigured ?? false}
              mirrorConfigured={mirrorConfigured ?? false}
              onDone={onRemediate}
              onCommitOpen={openCommit}
            />
          </section>
        </div>
      </section>

      <GitUncommittedFilesDialog
        git={git}
        open={gitFilesOpen}
        onClose={closeCommit}
        onCommitted={() => {
          closeCommit();
          onRemediate?.();
        }}
        title="Local uncommitted files"
        subtitle="Review diffs here — commit using Commit staging files in the wizard above"
      />
      <GitUncommittedFilesDialog
        open={stagingDiffOpen}
        onClose={() => setStagingDiffOpen(false)}
        readOnly
        title="Staged for prod — changes vs main"
        subtitle="Diff between origin/main and origin/staging · HA prod path only · use ←→ to step through"
        overrideHaFiles={git?.stagingHaFileList ?? []}
        overrideRepoFiles={[]}
        fetchDiff={dashboardApi.stagingDiff}
      />
      <GitUncommittedFilesDialog
        open={mainProdDiffOpen}
        onClose={() => setMainProdDiffOpen(false)}
        readOnly
        title="Pending prod deploy — changes on GitHub main"
        subtitle="Diff since last successful prod deploy · these files are not on prod HA Green yet"
        overrideHaFiles={git?.mainHaFileList ?? []}
        overrideRepoFiles={[]}
        fetchDiff={dashboardApi.mainProdDiff}
      />
      <GitUncommittedFilesDialog
        git={git}
        open={stagingProdLovelaceDiffOpen}
        onClose={() => setStagingProdLovelaceDiffOpen(false)}
        readOnly
        title="Dashboard — staging HA vs production"
        subtitle="Live Lovelace .storage diff · production is the left/minus side, staging HA is the right/plus side"
        overrideHaFiles={lovelaceDiffFiles}
        overrideRepoFiles={[]}
        fetchDiff={dashboardApi.stagingProdLovelaceDiff}
        initialPath={lovelaceDiffFiles[0] ?? ".storage/lovelace.lovelace"}
      />
      <GitUncommittedFilesDialog
        git={git}
        open={unpushedPushPreviewOpen}
        onClose={() => {
          setUnpushedPushPreviewOpen(false);
          setUnpushedPreviewInitialPath(null);
        }}
        readOnly
        title="Push to GitHub — preview"
        subtitle={`Queued commits vs ${unpushedPushTarget} · minus = on GitHub now, plus = will push`}
        overrideHaFiles={git?.unpushedHaFiles ?? []}
        overrideRepoFiles={git?.unpushedRepoFiles ?? []}
        fetchDiff={dashboardApi.unpushedDiff}
        initialPath={unpushedPreviewInitialPath}
      />
      <EntityParityListDialog
        open={entityParityOpen}
        onClose={() => setEntityParityOpen(false)}
        domain={entityParityDomain}
        side={entityParitySide}
        title={
          entityParitySide === "prodOnly"
            ? `${entityParityDomain} — on production only (live state)`
            : `${entityParityDomain} — on staging only (live state)`
        }
      />
    </div>
  );
}
