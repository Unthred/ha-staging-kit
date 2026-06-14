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
  SyncActivitySnapshot,
} from "../../api";
import { operationsApi } from "../../api";
import { formatGitChangeSummary } from "../../lib/gitStatus";
import { ActionButton } from "../ActionButton";
import { GitUncommittedFilesDialog } from "./GitUncommittedFilesDialog";
import { GitWorkflowActions } from "./GitWorkflowActions";
import { isMirrorControlMode } from "../../lib/mirrorMode";

export type MonitoringRowKey = "config" | "automation" | "script" | "person" | "mqtt" | "sensor";

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
    <div className="dash-detail-list">
      <p className="dash-detail-list-title">{title}</p>
      <ul className="dash-parity-entity-chips">
        {ids.map((id) => (
          <li key={id}>
            <code>{id}</code>
          </li>
        ))}
      </ul>
      {extra > 0 && <p className="muted dash-parity-more">+ {extra} more</p>}
    </div>
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
}: {
  domain: string;
  domainData?: EntityDomainParity;
  gitHint?: number;
}) {
  if (!domainData) {
    return (
      <p className="muted dash-detail-empty">
        Counts match between production and staging{gitHint != null ? ` (git YAML defines ${gitHint})` : ""}.
      </p>
    );
  }

  const prodOnly = classifyIds(domainData.prodOnlySample, false);
  const stagingOnly = classifyIds(domainData.stagingOnlySample, false);
  const informational = domain === "sensor";

  return (
    <>
      {informational && domainData.prodOnlyCount > 0 && (
        <p className="dash-detail-lead muted">
          Sensor counts often differ because of mirror timing and unavailable devices — this does not block staging
          parity.
        </p>
      )}
      {!informational && domainData.unexpectedProdOnlyCount > 0 && (
        <EntityList
          title={`Missing on staging (${domainData.unexpectedProdOnlyCount})`}
          ids={prodOnly.unexpected}
          total={domainData.unexpectedProdOnlyCount}
        />
      )}
      {!informational && domainData.unexpectedStagingOnlyCount > 0 && (
        <EntityList
          title={`Extra on staging (${domainData.unexpectedStagingOnlyCount})`}
          ids={stagingOnly.unexpected}
          total={domainData.unexpectedStagingOnlyCount}
        />
      )}
      {informational && domainData.prodOnlyCount > 0 && (
        <EntityList title={`On production only (${domainData.prodOnlyCount})`} ids={domainData.prodOnlySample} total={domainData.prodOnlyCount} />
      )}
      {stagingOnly.expected.length > 0 && (
        <EntityList title="Expected kit entities on staging" ids={stagingOnly.expected} total={stagingOnly.expected.length} />
      )}
      {domainData.prodOnlyCount === 0 && domainData.stagingOnlyCount === 0 && (
        <p className="muted dash-detail-empty">No entity ID differences in this domain.</p>
      )}
    </>
  );
}

function DetailActions({
  rowKey,
  representation,
  configDrift,
  syncActivity,
  domainData,
  mirror,
  git,
  gitConfigured,
  mirrorConfigured,
  onDone,
}: {
  rowKey: MonitoringRowKey;
  representation?: StagingRepresentationStatus | null;
  configDrift?: ConfigDriftStatus | null;
  syncActivity?: SyncActivitySnapshot | null;
  domainData?: EntityDomainParity;
  mirror?: DashboardStatus["mirror"];
  git?: GitSnapshot | null;
  gitConfigured: boolean;
  mirrorConfigured: boolean;
  onDone?: () => void;
}) {
  const actions: { key: string; label: string; preset: "apply-config" | "storage-sync" | "person-poll" | "refresh-mirror" | "mirror-readonly"; variant?: "secondary" | "danger"; run: () => ReturnType<typeof operationsApi.applyConfig> }[] = [];

  if (rowKey === "config" && configDrift?.hasDrift) {
    actions.push({
      key: "apply",
      label: "Apply staging config",
      preset: "apply-config",
      run: operationsApi.applyConfig,
    });
  }

  if (
    rowKey === "config" &&
    mirrorConfigured &&
    syncActivity?.lastStorageSyncAt == null &&
    !actions.some((a) => a.key === "storage")
  ) {
    actions.push({
      key: "storage",
      label: "Storage sync",
      preset: "storage-sync",
      variant: "secondary",
      run: operationsApi.storageSync,
    });
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

  const domainNeedsSync =
    domainData != null &&
    rowKey !== "sensor" &&
    rowKey !== "config" &&
    rowKey !== "person" &&
    (domainData.unexpectedProdOnlyCount > 0 || domainData.unexpectedStagingOnlyCount > 0);

  if (domainNeedsSync) {
    actions.push({
      key: "storage",
      label: "Storage sync",
      preset: "storage-sync",
      variant: "secondary",
      run: operationsApi.storageSync,
    });
  }

  if (
    (rowKey === "automation" || rowKey === "script") &&
    !representation?.entityRegistryAligned &&
    !actions.some((a) => a.key === "storage")
  ) {
    actions.push({
      key: "storage",
      label: "Storage sync",
      preset: "storage-sync",
      variant: "secondary",
      run: operationsApi.storageSync,
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
    if (representation?.verdict === "aligned" && rowKey !== "sensor") {
      return (
        <div className="dash-detail-actions">
          <p className="dash-detail-ok dash-detail-actions-empty">No action needed for this row.</p>
        </div>
      );
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
      {rowKey === "config" && (
        <GitWorkflowActions git={git} drift={configDrift} onDone={onDone} compact showLead={false} />
      )}
      {actions.length > 0 && (
        <div className="ops-actions dash-detail-actions-secondary">
          {actions.map((action) => (
            <ActionButton
              key={action.key}
              label={action.label}
              toastPreset={action.preset}
              variant={action.variant}
              onRun={action.run}
              onDone={onDone}
              disabled={action.key === "apply" && !gitConfigured}
            />
          ))}
        </div>
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
  syncActivity,
  presence,
  mqtt,
  onShowUncommittedFiles,
}: {
  rowKey: MonitoringRowKey;
  inventory?: ConfigInventoryStats | null;
  entityParity?: EntityParitySnapshot | null;
  representation?: StagingRepresentationStatus | null;
  configDrift?: ConfigDriftStatus | null;
  git?: GitSnapshot | null;
  syncActivity?: SyncActivitySnapshot | null;
  presence?: PresenceSummary | null;
  mqtt?: MqttBridgeStats | null;
  onShowUncommittedFiles?: () => void;
}) {
  const domainMap = new Map((entityParity?.domains ?? []).map((d) => [d.domain, d]));
  const resolvedDomain = monitoringRowDomain(rowKey, entityParity);
  const buckets = mqtt?.activityBuckets ?? [];
  const max = Math.max(...buckets.map((b) => b.events), 1);
  const width = 280;
  const height = 72;
  const barW = buckets.length > 0 ? Math.max(6, Math.floor(width / buckets.length) - 4) : 8;

  if (rowKey === "config") {
    return (
      <>
        <dl className="dash-detail-facts">
          <div>
            <dt>Git branch</dt>
            <dd>{git?.branch ?? "—"}</dd>
          </div>
          <div>
            <dt>Git commit</dt>
            <dd>{git?.commitHash ?? "—"}</dd>
          </div>
          <div>
            <dt>Last apply</dt>
            <dd>
              {syncActivity?.lastApplyCommit
                ? `${syncActivity.lastApplyCommit}${syncActivity.lastApplyRelative ? ` (${syncActivity.lastApplyRelative})` : ""}`
                : "Never logged"}
            </dd>
          </div>
          <div>
            <dt>Uncommitted</dt>
            <dd>{formatGitChangeSummary(git)}</dd>
          </div>
        </dl>
        {configDrift?.hasDrift && <p className="dash-detail-warn">{configDrift.detail}</p>}
        {!configDrift?.hasDrift && git?.isHaDirty && (
          <p className="dash-detail-warn">Uncommitted HA YAML is not on staging until you commit and apply.</p>
        )}
        {!configDrift?.hasDrift && !git?.isHaDirty && git?.isRepoDirty && (
          <p className="muted dash-detail-lead">
            {git.repoChangedFileCount} docs/repo file(s) uncommitted — does not affect prod vs staging parity.
          </p>
        )}
        {representation?.configMatchesGit && !git?.isHaDirty && (
          <p className="dash-detail-ok">Config on staging matches git.</p>
        )}
        {git?.isDirty && onShowUncommittedFiles && (
          <button type="button" className="dash-detail-link-btn" onClick={onShowUncommittedFiles}>
            View {git.changedFileCount} uncommitted file{git.changedFileCount === 1 ? "" : "s"}…
          </button>
        )}
      </>
    );
  }

  if (rowKey === "person") {
    const personDomain = domainMap.get("person");
    return (
      <>
        {presence && (
          <p className={representation?.presenceMatches ? "dash-detail-ok" : "dash-detail-warn"}>{presence.detail}</p>
        )}
        <DomainDetail domain="person" domainData={personDomain} />
      </>
    );
  }

  if (rowKey === "mqtt") {
    const mqttDomain = domainMap.get("mqtt");
    return (
      <>
        <DomainDetail domain="mqtt" domainData={mqttDomain} />
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
    <>
      {gitHint != null && (
        <p className="dash-detail-lead muted">Git YAML: {gitHint} · live entity counts may differ.</p>
      )}
      <DomainDetail domain={rowKey} domainData={resolvedDomain} gitHint={gitHint} />
    </>
  );
}

function pickDefaultRow(
  rows: MetricRow[],
  representation?: StagingRepresentationStatus | null,
  entityParity?: EntityParitySnapshot | null,
): MonitoringRowKey {
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
  syncActivity,
  presence,
  mqtt,
  mirror,
  gitConfigured,
  mirrorConfigured,
  onRemediate,
}: {
  inventory?: ConfigInventoryStats | null;
  prod?: HaMonitoringStats | null;
  staging?: HaMonitoringStats | null;
  entityParity?: EntityParitySnapshot | null;
  representation?: StagingRepresentationStatus | null;
  configDrift?: ConfigDriftStatus | null;
  git?: GitSnapshot | null;
  syncActivity?: SyncActivitySnapshot | null;
  presence?: PresenceSummary | null;
  mqtt?: MqttBridgeStats | null;
  mirror?: DashboardStatus["mirror"];
  gitConfigured?: boolean;
  mirrorConfigured?: boolean;
  onRemediate?: () => void;
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
        label: "Config & git",
        git: git?.commitHash ?? "—",
        prod: "—",
        staging: configDrift?.hasDrift ? "Pending" : representation?.configMatchesGit ? "Applied" : "—",
        aligned: representation?.configMatchesGit,
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
    setSelectedKey(pickDefaultRow(rows, representation, entityParity));
  }, [entityParity, representation, configDrift?.hasDrift, rows]);

  const selectedRow = rows.find((r) => r.key === selectedKey) ?? rows[0];
  const [gitFilesOpen, setGitFilesOpen] = useState(false);

  return (
    <div className="dash-live-primary">
      <section className="dash-panel dash-monitoring-table">
        <header className="dash-panel-head dash-panel-head-tight">
          <h3>Parity</h3>
          <span className="muted dash-table-hint">Select a row</span>
        </header>
        <div className="dash-compare-table-wrap">
          <table className="dash-compare-table dash-compare-table-selectable">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">Git (YAML)</th>
                <th scope="col">Production</th>
                <th scope="col">Staging</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rowClass = row.aligned == null ? parityClass(row.prod === row.staging) : parityClass(row.aligned);
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

      <section className="dash-panel dash-monitoring-detail" aria-live="polite">
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
            syncActivity={syncActivity}
            presence={presence}
            mqtt={mqtt}
            onShowUncommittedFiles={() => setGitFilesOpen(true)}
          />
        </div>
        <DetailActions
          rowKey={selectedKey}
          representation={representation}
          configDrift={configDrift}
          syncActivity={syncActivity}
          domainData={monitoringRowDomain(selectedKey, entityParity)}
          mirror={mirror}
          git={git}
          gitConfigured={gitConfigured ?? false}
          mirrorConfigured={mirrorConfigured ?? false}
          onDone={onRemediate}
        />
      </section>

      <GitUncommittedFilesDialog
        git={git}
        open={gitFilesOpen}
        onClose={() => setGitFilesOpen(false)}
        onCommitted={onRemediate}
      />
    </div>
  );
}
