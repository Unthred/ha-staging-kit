import { Link } from "react-router-dom";
import type { ConfigDriftStatus, GitSnapshot } from "../../api";
import { formatRelativeTime } from "../../lib/formatTime";
import { useStableMinHeight } from "../../hooks/useStableMinHeight";
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
  const panelStable = useStableMinHeight("env-git-panel-v2");
  const loading = git == null;

  if (!loading && !git.configured) {
    return (
      <section ref={panelStable.ref} style={panelStable.style} className="dash-panel dash-config-repo-panel">
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
  const showApplyLinks = Boolean(drift?.hasDrift && drift.applyGapHasHaChanges);
  const showDocsHint = Boolean(drift?.hasDrift && drift.lastAppliedCommit && !drift.applyGapHasHaChanges);
  const showUncommitted = Boolean(!loading && git && (git.isHaDirty || git.isRepoDirty));

  const bannerTitle = loading
    ? "Loading git status…"
    : drift?.hasDrift
      ? "Apply pending"
      : "Staging disk matches git";

  const bannerDetail = loading ? "—" : (drift?.detail ?? git?.commitSubject ?? "—");

  const footerContent = loading
    ? null
    : showUncommitted
      ? (
          <>
            Uncommitted — <Link to="/">Overview</Link>
          </>
        )
      : showDocsHint
        ? "Docs-only drift — staging YAML already at last apply."
        : null;

  return (
    <section ref={panelStable.ref} style={panelStable.style} className="dash-panel dash-config-repo-panel">
      <header className="dash-panel-head dash-panel-head-tight">
        <div>
          <p className="dash-panel-eyebrow">Git ↔ staging</p>
          <h3>
            Apply status
            <SectionAttentionBadge count={attentionCount} />
          </h3>
        </div>
        <div className="dash-config-repo-head-actions">
          <div className="dash-git-badges dash-git-badges-reserved">
            {!loading && git?.isHaDirty && (
              <span className="dash-badge dash-badge-warn">
                {git.haChangedFileCount} HA YAML uncommitted
              </span>
            )}
            {!loading && git?.isRepoDirty && (
              <span className="dash-badge dash-badge-info">
                {git.repoChangedFileCount} docs uncommitted
              </span>
            )}
            {!loading && drift?.hasDrift && <span className="dash-badge dash-badge-warn">Apply pending</span>}
            {!loading && inSync && !drift?.hasDrift && <span className="dash-badge dash-badge-ok">Applied</span>}
          </div>
        </div>
      </header>

      <div
        className={`dash-config-apply-banner dash-config-apply-banner-shell${
          loading
            ? " dash-config-apply-banner-ok dash-config-apply-banner-skeleton"
            : drift?.hasDrift
              ? " dash-config-apply-banner-warn"
              : " dash-config-apply-banner-ok"
        }`}
        aria-busy={loading}
      >
        <p className="dash-config-apply-title">{bannerTitle}</p>
        <p className="dash-config-apply-detail">{bannerDetail}</p>
        <p className="dash-config-apply-meta muted">
          {loading ? (
            "—"
          ) : drift?.repoCommit ? (
            <>
              Git HEAD <code>{drift.repoCommit}</code>
              {drift.lastAppliedCommit ? (
                <>
                  {" "}
                  · last applied to staging <code>{drift.lastAppliedCommit}</code>
                </>
              ) : (
                " · never applied to staging"
              )}
            </>
          ) : git?.commitHash ? (
            <>
              Git HEAD <code>{git.commitHash}</code>
              {git.commitDate ? <> · committed {formatRelativeTime(git.commitDate)}</> : null}
            </>
          ) : (
            "—"
          )}
        </p>
        <p className="dash-config-apply-link dash-config-apply-link-reserved">
          {showApplyLinks ? (
            <>
              <Link to="/">Reload from repo on Overview</Link>
              {" · "}
              <Link to="/">Ship workflow on Overview</Link>
            </>
          ) : (
            "\u00a0"
          )}
        </p>
      </div>

      {footerContent ? (
        <p className="muted dash-config-repo-note dash-config-repo-note-compact">{footerContent}</p>
      ) : null}
    </section>
  );
}
