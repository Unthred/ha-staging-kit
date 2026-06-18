import { Link } from "react-router-dom";
import type { ConfigDriftStatus, GitSnapshot } from "../../api";
import { formatRelativeTime } from "../../lib/formatTime";
import { SectionAttentionBadge } from "../PageAttentionPanel";

/** Slim git ↔ staging apply status for the Environment page (workflow lives on Overview). */
export function DashboardGitPanel({
  git,
  drift,
  attentionCount = 0,
}: {
  git?: GitSnapshot | null;
  drift?: ConfigDriftStatus | null;
  attentionCount?: number;
}) {
  if (!git?.configured) {
    return (
      <section className="dash-panel dash-config-repo-panel">
        <header className="dash-panel-head">
          <div>
            <p className="dash-panel-eyebrow">Git ↔ staging</p>
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
      <header className="dash-panel-head dash-panel-head-tight">
        <div>
          <p className="dash-panel-eyebrow">Git ↔ staging</p>
          <h3>
            Apply status
            <SectionAttentionBadge count={attentionCount} />
          </h3>
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
                {git.repoChangedFileCount} docs uncommitted
              </span>
            )}
            {drift?.hasDrift && <span className="dash-badge dash-badge-warn">Apply pending</span>}
            {inSync && !drift?.hasDrift && <span className="dash-badge dash-badge-ok">Applied</span>}
          </div>
        </div>
      </header>

      {drift ? (
        <div
          className={`dash-config-apply-banner ${drift.hasDrift ? "dash-config-apply-banner-warn" : "dash-config-apply-banner-ok"}`}
        >
          <p className="dash-config-apply-title">{drift.hasDrift ? "Apply pending" : "Staging disk matches git"}</p>
          <p className="dash-config-apply-detail">{drift.detail}</p>
          {drift.repoCommit && (
            <p className="dash-config-apply-meta muted">
              Git HEAD <code>{drift.repoCommit}</code>
              {drift.lastAppliedCommit ? (
                <>
                  {" "}
                  · last applied to staging <code>{drift.lastAppliedCommit}</code>
                </>
              ) : (
                " · never applied to staging"
              )}
            </p>
          )}
          {drift.hasDrift && drift.applyGapHasHaChanges && (
            <p className="dash-config-apply-link">
              <Link to="/">Reload from repo on Overview</Link>
              {" · "}
              <Link to="/">Ship workflow on Overview</Link>
            </p>
          )}
        </div>
      ) : (
        <dl className="dash-kv dash-kv-compact">
          <div>
            <dt>Git HEAD</dt>
            <dd>
              <code>{git.commitHash ?? "—"}</code>
              {git.commitSubject ? <> · {git.commitSubject}</> : null}
            </dd>
          </div>
          <div>
            <dt>Committed</dt>
            <dd>{git.commitDate ? formatRelativeTime(git.commitDate) : "—"}</dd>
          </div>
        </dl>
      )}

      {syncActivityHint(drift)}

      {(git.isHaDirty || git.isRepoDirty) && (
        <p className="muted dash-config-repo-note dash-config-repo-note-compact">
          Uncommitted — <Link to="/">Overview</Link>
        </p>
      )}
    </section>
  );
}

function syncActivityHint(drift?: ConfigDriftStatus | null) {
  if (!drift?.hasDrift || !drift.lastAppliedCommit) return null;
  if (drift.applyGapHasHaChanges) return null;
  return (
    <p className="muted dash-config-repo-note dash-config-repo-note-compact">
      Docs-only drift — staging YAML already at last apply.
    </p>
  );
}
