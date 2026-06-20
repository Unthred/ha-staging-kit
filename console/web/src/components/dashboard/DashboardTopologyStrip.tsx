import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type { GitSnapshot, StagingTargetSnapshot } from "../../api";
import { prodHaYamlPending, prodStorageBundlePending } from "../../lib/gitWorkflow";

function topologyLabel(type?: string | null) {
  if (type === "docker") return "Docker container";
  if (type === "ha_os") return "Home Assistant OS";
  return type || null;
}

/** Matches StagingTargetBuilder.BuildNotes when staging has no add-on store. */
const DOCKER_NO_ADDONS_NOTE =
  "Settings → Apps / Add-ons store requires Home Assistant OS. Staging is not HA OS — use this kit console for sync and testing, not HA add-ons.";

function TopologyCell({ children }: { children: ReactNode }) {
  return <div className="dash-topology-grid-cell">{children}</div>;
}

export function DashboardTopologyStrip({
  prodUrl,
  stagingUrl,
  git,
  target,
}: {
  prodUrl?: string | null;
  stagingUrl?: string | null;
  git?: GitSnapshot | null;
  target?: StagingTargetSnapshot | null;
}) {
  const prodType = topologyLabel(target?.prodHaType);
  const stagingType = topologyLabel(target?.stagingHaType);
  const yamlPending = git?.configured ? prodHaYamlPending(git) : false;
  const storagePending = git?.configured ? prodStorageBundlePending(git) : false;
  const showNoAddonStore = target == null || !target.addonsAvailable;
  const topologyNote = target?.notes ?? (target == null ? DOCKER_NO_ADDONS_NOTE : null);

  return (
    <section className="dash-panel dash-topology-strip" aria-label="Environment topology">
      <header className="dash-panel-head dash-panel-head-tight">
        <div>
          <p className="dash-panel-eyebrow">Topology</p>
          <h3>Prod &amp; staging</h3>
        </div>
        <div className="dash-topology-head-links">
          <Link to="/" className="dash-chip-link">
            Overview
          </Link>
          <Link to="/settings" className="dash-chip-link">
            Settings
          </Link>
        </div>
      </header>

      <div className="dash-topology-grid" role="table" aria-label="Production and staging comparison">
        <div className="dash-topology-grid-head" role="row">
          <span className="dash-topology-grid-label" role="columnheader" />
          <span className="dash-topology-grid-colhead" role="columnheader">
            Production
          </span>
          <span className="dash-topology-grid-colhead" role="columnheader">
            Staging
          </span>
        </div>

        <div className="dash-topology-grid-row" role="row">
          <span className="dash-topology-grid-label" role="rowheader">
            Web UI
          </span>
          <TopologyCell>
            {prodUrl ? (
              <a href={prodUrl} target="_blank" rel="noreferrer">
                {prodUrl}
              </a>
            ) : (
              "—"
            )}
          </TopologyCell>
          <TopologyCell>
            {stagingUrl ? (
              <a href={stagingUrl} target="_blank" rel="noreferrer">
                {stagingUrl}
              </a>
            ) : (
              "—"
            )}
          </TopologyCell>
        </div>

        <div className="dash-topology-grid-row" role="row">
          <span className="dash-topology-grid-label" role="rowheader">
            Install type
          </span>
          <TopologyCell>{prodType ?? "—"}</TopologyCell>
          <TopologyCell>
                {stagingType || target == null ? (
                  <>
                    {target?.installLabel ?? stagingType ?? "Docker container"}
                    {showNoAddonStore && (
                      <span className="dash-topology-tag muted"> · no add-on store</span>
                    )}
                  </>
                ) : (
                  "—"
                )}
          </TopologyCell>
        </div>

        <div className="dash-topology-grid-row" role="row">
          <span className="dash-topology-grid-label" role="rowheader">
            Deploy
          </span>
          <TopologyCell>
            {git?.configured ? (
              git.prodDeployTracked && git.prodLastDeploySha ? (
                <>
                  <code>{git.prodLastDeploySha.slice(0, 7)}</code>
                  {git.prodPreviousDeploySha ? (
                    <span className="muted dash-topology-sub">
                      {" "}
                      · rollback <code>{git.prodPreviousDeploySha.slice(0, 7)}</code>
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="muted">Not recorded</span>
              )
            ) : (
              "—"
            )}
          </TopologyCell>
          <TopologyCell>
            <span className="muted">Apply via Overview</span>
          </TopologyCell>
        </div>

        <div className="dash-topology-grid-row" role="row">
          <span className="dash-topology-grid-label" role="rowheader">
            HA version
          </span>
          <TopologyCell>—</TopologyCell>
          <TopologyCell>{target?.version ?? "—"}</TopologyCell>
        </div>

        <div className="dash-topology-grid-row" role="row">
          <span className="dash-topology-grid-label" role="rowheader">
            Location
          </span>
          <TopologyCell>—</TopologyCell>
          <TopologyCell>{target?.locationName ?? "—"}</TopologyCell>
        </div>
      </div>

      {(yamlPending || storagePending || topologyNote) && (
        <div className="dash-topology-footnotes">
          {(yamlPending || storagePending) && (
            <p className="dash-topology-footnote muted">
              Pending on main:{" "}
              {yamlPending && `${git?.mainHaChangesForProdHa ?? 0} YAML`}
              {yamlPending && storagePending ? " · " : ""}
              {storagePending ? `${git?.mainStorageChangesForProdHa ?? 0} .storage` : ""}
              {" · "}
              <Link to="/">Overview</Link>
            </p>
          )}
          {topologyNote && <p className="dash-topology-footnote muted">{topologyNote}</p>}
        </div>
      )}
    </section>
  );
}
