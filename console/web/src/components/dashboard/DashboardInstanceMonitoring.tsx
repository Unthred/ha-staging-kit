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
  MqttBridgeStats,
  PresenceSummary,
  StagingRepresentationStatus,
} from "../../api";
import { dashboardApi, operationsApi } from "../../api";
import { ActionButton } from "../ActionButton";
import { GitUncommittedFilesDialog } from "./GitUncommittedFilesDialog";
import { DashboardParityBanner } from "./DashboardParityBanner";
import { isMirrorControlMode } from "../../lib/mirrorMode";
import { prodHaStatusLabel, prodHaYamlPending, prodHelperBundlePending, prodLovelaceBundlePending, prodStorageBundlePending } from "../../lib/gitWorkflow";

export type MonitoringRowKey = "config" | "staging-main" | "main-prod" | "automation" | "script" | "person" | "mqtt" | "sensor";

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

function EntityList({ title, ids, total }: { title: string; ids: string[]; total: number }) {
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
      {extra > 0 && <p className="muted dash-parity-more">+ {extra} more</p>}
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
}: {
  columns: { title: string; files: string[]; variant?: "ha" | "docs" }[];
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
                <code title={f}>{f}</code>
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
}: {
  domain: string;
  domainData?: EntityDomainParity;
  gitHint?: number;
  introHint?: string;
  introSummary?: string;
  introTone?: "ok" | "warn" | "muted";
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
          Sensor counts often differ because of mirror timing and unavailable devices — this does not block staging
          parity.
        </p>
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
          <EntityList title="On production only" ids={domainData.prodOnlySample} total={domainData.prodOnlyCount} />
        )}
        {stagingOnly.expected.length > 0 && (
          <EntityList title="Expected kit entities on staging" ids={stagingOnly.expected} total={stagingOnly.expected.length} />
        )}
      </div>
    </>
  );
}

function DetailActions({
  rowKey,
  representation,
  configDrift,
  git,
  mirror,
  gitConfigured,
  mirrorConfigured,
  onDone,
}: {
  rowKey: MonitoringRowKey;
  representation?: StagingRepresentationStatus | null;
  configDrift?: ConfigDriftStatus | null;
  git?: GitSnapshot | null;
  mirror?: DashboardStatus["mirror"];
  gitConfigured: boolean;
  mirrorConfigured: boolean;
  onDone?: () => void;
}) {
  const actions: { key: string; label: string; preset: "apply-config" | "person-poll" | "refresh-mirror" | "mirror-readonly"; variant?: "secondary" | "danger"; disabled?: boolean; disabledReason?: string; run: () => ReturnType<typeof operationsApi.applyConfig> }[] = [];

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

  if (actions.length === 0) {
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
      </div>
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
}: {
  rowKey: MonitoringRowKey;
  inventory?: ConfigInventoryStats | null;
  entityParity?: EntityParitySnapshot | null;
  representation?: StagingRepresentationStatus | null;
  configDrift?: ConfigDriftStatus | null;
  git?: GitSnapshot | null;
  presence?: PresenceSummary | null;
  mqtt?: MqttBridgeStats | null;
  onShowUncommittedFiles?: () => void;
  onShowStagingDiff?: () => void;
  onShowMainProdDiff?: () => void;
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

  if (rowKey === "staging-main") {
    const unpushed = git?.commitsAhead ?? 0;
    const ahead = git?.stagingAheadOfMain ?? 0;
    const haFiles = git?.stagingHaFileList ?? [];
    const repoFiles = git?.stagingRepoFileList ?? [];
    const haCount = git?.stagingHaChanges ?? 0;

    let summary: string;
    if (unpushed > 0) {
      summary = `${unpushed} local commit${unpushed === 1 ? "" : "s"} not on GitHub yet — finish Push to GitHub before deploy.`;
    } else if ((git?.isHaDirty ?? false) && (git?.haChangedFileCount ?? 0) > 0) {
      summary = `${git!.haChangedFileCount} HA file${git!.haChangedFileCount === 1 ? "" : "s"} changed on staging but not committed — commit before push or deploy.`;
    } else if (ahead === 0) {
      summary = "GitHub staging branch matches main.";
    } else if (haCount === 0) {
      summary = `${ahead} commit${ahead === 1 ? "" : "s"} on GitHub staging not on main — docs/scripts only.`;
    } else {
      summary = `${ahead} commit${ahead === 1 ? "" : "s"} on GitHub staging (${haCount} HA file${haCount === 1 ? "" : "s"}) not merged to main.`;
    }

    return (
      <>
        <DetailPaneIntro
          hint="GitHub staging branch vs main — review before Push to GitHub or Deploy to prod."
          summary={summary}
          tone={unpushed > 0 || (git?.isHaDirty ?? false) || (ahead > 0 && haCount > 0) ? "warn" : ahead === 0 ? "ok" : "muted"}
        />
        <DetailFileColumns
          columns={[
            { title: "HA config on staging", files: haFiles, variant: "ha" },
            { title: "Docs / scripts", files: repoFiles, variant: "docs" },
          ]}
        />
        <DetailReviewButton
          label={`Review ${haFiles.length + repoFiles.length} change${haFiles.length + repoFiles.length === 1 ? "" : "s"} vs main…`}
          onClick={haFiles.length + repoFiles.length > 0 ? onShowStagingDiff : undefined}
        />
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
      <DomainDetail domain={rowKey} domainData={resolvedDomain} gitHint={gitHint} />
    </div>
  );
}

function pickDefaultRow(
  rows: MetricRow[],
  representation?: StagingRepresentationStatus | null,
  entityParity?: EntityParitySnapshot | null,
  git?: GitSnapshot | null,
): MonitoringRowKey {
  if (git?.isDirty) return "config";
  if ((git?.commitsAhead ?? 0) > 0) return "staging-main";
  const prodPending =
    prodHaYamlPending(git) ||
    ((git?.stagingAheadOfMain ?? 0) > 0 && (git?.stagingHaChanges ?? 0) > 0);
  if (prodPending) return "main-prod";
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
        git:
          (git?.commitsAhead ?? 0) > 0
            ? `${git?.commitsAhead} unpushed`
            : git?.stagingAheadOfMain == null
              ? "—"
              : git.stagingAheadOfMain === 0
                ? "On main"
                : `${git.stagingAheadOfMain} on staging`,
        prod: "—",
        staging:
          (git?.commitsAhead ?? 0) > 0
            ? "Push needed"
            : (git?.isHaDirty ?? false) && (git?.haChangedFileCount ?? 0) > 0
              ? `${git?.haChangedFileCount ?? 0} HA not committed`
              : git?.stagingAheadOfMain == null
                ? "—"
                : git.stagingAheadOfMain === 0
                  ? "On main"
                  : (git?.stagingHaChanges ?? 0) === 0
                    ? "Docs on staging"
                    : `${git.stagingHaChanges} HA on staging`,
        aligned:
          git?.stagingAheadOfMain == null
            ? undefined
            : (git?.commitsAhead ?? 0) === 0 &&
              !(git?.isHaDirty ?? false) &&
              git.stagingAheadOfMain === 0,
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
  }, [inventory, prod, staging, git, configDrift, representation, entityParity]);

  const [selectedKey, setSelectedKey] = useState<MonitoringRowKey>("config");
  const userPicked = useRef(false);

  useEffect(() => {
    if (userPicked.current) return;
    setSelectedKey(pickDefaultRow(rows, representation, entityParity, git));
  }, [
    entityParity,
    representation,
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

  return (
    <div id="staging-parity" className="dash-live-primary">
      <section className="dash-panel dash-parity-board">
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
                onShowUncommittedFiles={openCommit}
                onShowStagingDiff={() => setStagingDiffOpen(true)}
                onShowMainProdDiff={() => setMainProdDiffOpen(true)}
              />
            </div>
            <DetailActions
              rowKey={selectedKey}
              representation={representation}
              configDrift={configDrift}
              git={git}
              mirror={mirror}
              gitConfigured={gitConfigured ?? false}
              mirrorConfigured={mirrorConfigured ?? false}
              onDone={onRemediate}
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
        subtitle="Diff between origin/main and origin/staging · use ←→ to step through"
        overrideHaFiles={git?.stagingHaFileList ?? []}
        overrideRepoFiles={git?.stagingRepoFileList ?? []}
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
    </div>
  );
}
