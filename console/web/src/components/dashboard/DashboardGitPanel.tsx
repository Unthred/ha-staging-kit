import { Link } from "react-router-dom";
import type { ConfigDriftStatus, ConfigInventoryStats, GitSnapshot } from "../../api";
import { formatRelativeTime } from "../../lib/formatTime";
import { formatGitChangeSummary } from "../../lib/gitStatus";
import { GitWorkflowActions } from "./GitWorkflowActions";

export function DashboardGitPanel({
  git,
  drift,
  inventory,
  onRemediate,
}: {
  git?: GitSnapshot | null;
  drift?: ConfigDriftStatus | null;
  inventory?: ConfigInventoryStats | null;
  onRemediate?: () => void;
}) {
  if (!git?.configured) {
    return (
      <section className="dash-panel dash-config-repo-panel">
        <header className="dash-panel-head">
          <div>
            <p className="dash-panel-eyebrow">Config repo</p>
            <h3>Repo not mounted</h3>
          </div>
        </header>
        <p className="muted">
          HA config repo is not available at <code>/repo</code> inside the kit container.
        </p>
        <Link to="/settings" className="dash-chip-link">
          Paths &amp; git settings
        </Link>
      </section>
    );
  }

  const inSync = drift && !drift.hasDrift;

  return (
    <section className="dash-panel dash-config-repo-panel">
      <header className="dash-panel-head">
        <div>
          <p className="dash-panel-eyebrow">Config repo</p>
          <h3>{git.branch ?? "staging"}</h3>
        </div>
        <div className="dash-config-repo-head-actions">
          <div className="dash-git-badges">
            {git.isHaDirty && (
              <span className="dash-badge dash-badge-warn">
                {git.haChangedFileCount} HA YAML uncommitted
              </span>
            )}
            {git.isRepoDirty && (
              <span className="dash-badge dash-badge-info">
                {git.repoChangedFileCount} docs/repo uncommitted
              </span>
            )}
            {drift?.hasDrift && <span className="dash-badge dash-badge-warn">Apply pending</span>}
            {inSync && !drift?.hasDrift && <span className="dash-badge dash-badge-ok">Applied</span>}
          </div>
          <Link to="/settings" className="dash-chip-link">
            Paths &amp; git
          </Link>
        </div>
      </header>

      {drift && (
        <div
          className={`dash-config-apply-banner ${drift.hasDrift ? "dash-config-apply-banner-warn" : "dash-config-apply-banner-ok"}`}
        >
          <p className="dash-config-apply-title">{drift.hasDrift ? "Apply pending" : "Staging matches git"}</p>
          <p className="dash-config-apply-detail">{drift.detail}</p>
          {drift.repoCommit && (
            <p className="dash-config-apply-meta muted">
              Git <code>{drift.repoCommit}</code>
              {drift.lastAppliedCommit ? (
                <>
                  {" "}
                  · last applied <code>{drift.lastAppliedCommit}</code>
                </>
              ) : (
                " · never applied"
              )}
            </p>
          )}
          {drift.hasDrift && (
            <p className="dash-config-apply-link">
              <Link to="/">Apply from Live overview</Link>
              {" · "}
              <Link to="/operations">Operations</Link>
            </p>
          )}
        </div>
      )}

      <div className="dash-config-repo-stats">
        <h4 className="dash-config-repo-group-label">Git</h4>
        <div className="dash-stat-card dash-config-repo-stat">
          <span className="dash-stat-value dash-stat-value-mono">{git.commitHash ?? "—"}</span>
          <span className="dash-stat-label">HEAD commit</span>
        </div>
        <div className="dash-stat-card dash-config-repo-stat">
          <span className="dash-stat-value">{git.commitsAhead ?? 0}</span>
          <span className="dash-stat-label">Ahead of origin</span>
        </div>
        <div className="dash-stat-card dash-config-repo-stat">
          <span className="dash-stat-value">{git.commitsBehind ?? 0}</span>
          <span className="dash-stat-label">Behind origin</span>
        </div>
        {git.stagingAheadOfMain != null && (
          <div className="dash-stat-card dash-config-repo-stat">
            <span className="dash-stat-value">{git.stagingAheadOfMain}</span>
            <span className="dash-stat-label">
              {git.stagingAheadOfMain === 0
                ? "Staging on main"
                : (git.stagingHaChanges ?? 0) === 0
                ? "Staged · docs only"
                : `Staged · ${git.stagingHaChanges} HA files`}
            </span>
          </div>
        )}
        {git.mainAheadOfProdHa != null && (
          <div className="dash-stat-card dash-config-repo-stat">
            <span className="dash-stat-value">{git.mainAheadOfProdHa}</span>
            <span className="dash-stat-label">
              {git.mainAheadOfProdHa === 0
                ? "Prod HA current"
                : (git.mainHaChangesForProdHa ?? 0) === 0
                ? "Prod HA · docs only"
                : `Prod HA · ${git.mainHaChangesForProdHa} HA files`}
            </span>
          </div>
        )}
        <div className="dash-stat-card dash-config-repo-stat">
          <span className="dash-stat-value dash-stat-value-mono">{drift?.lastAppliedCommit ?? "—"}</span>
          <span className="dash-stat-label">Last applied</span>
        </div>

        {inventory?.available && (
          <>
            <h4 className="dash-config-repo-group-label">Shared YAML</h4>
            <div className="dash-stat-card dash-config-repo-stat dash-stat-purple">
              <span className="dash-stat-value">{inventory.automationCount}</span>
              <span className="dash-stat-label">Automations</span>
            </div>
            <div className="dash-stat-card dash-config-repo-stat dash-stat-teal">
              <span className="dash-stat-value">{inventory.scriptCount}</span>
              <span className="dash-stat-label">Scripts</span>
            </div>
            <div className="dash-stat-card dash-config-repo-stat">
              <span className="dash-stat-value">{inventory.packageCount}</span>
              <span className="dash-stat-label">Package files</span>
            </div>
            <div className="dash-stat-card dash-config-repo-stat">
              <span className="dash-stat-value">{inventory.blueprintCount}</span>
              <span className="dash-stat-label">Blueprints</span>
            </div>
          </>
        )}
      </div>

      <div className="dash-config-repo-meta">
        <dl className="dash-kv dash-kv-compact">
          <div>
            <dt>Latest message</dt>
            <dd>{git.commitSubject ?? "—"}</dd>
          </div>
          <div>
            <dt>Committed</dt>
            <dd>{git.commitDate ? formatRelativeTime(git.commitDate) : "—"}</dd>
          </div>
          <div>
            <dt>Remote</dt>
            <dd>
              <code className="dash-inline-code">{git.remoteUrl ?? "origin"}</code>
            </dd>
          </div>
          <div>
            <dt>Uncommitted</dt>
            <dd>{formatGitChangeSummary(git)}</dd>
          </div>
        </dl>
        {inventory?.available && (
          <p className="muted dash-config-repo-note">
            Prod and staging should run this YAML. Live entity counts are on <Link to="/">Live overview</Link>.
          </p>
        )}
      </div>

      {(git.haChangedSample.length > 0 || git.repoChangedSample.length > 0) && (
        <div className="dash-config-repo-samples">
          {git.haChangedSample.length > 0 && (
            <div>
              <p className="dash-config-repo-sample-title">HA YAML</p>
              <ul className="dash-config-repo-sample-list">
                {git.haChangedSample.map((path) => (
                  <li key={path}>
                    <code>{path}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {git.repoChangedSample.length > 0 && (
            <div>
              <p className="dash-config-repo-sample-title dash-config-repo-sample-title-muted">Docs / repo</p>
              <ul className="dash-config-repo-sample-list">
                {git.repoChangedSample.map((path) => (
                  <li key={path}>
                    <code>{path}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <GitWorkflowActions git={git} drift={drift} onDone={onRemediate} compact showLead={false} />
    </section>
  );
}
