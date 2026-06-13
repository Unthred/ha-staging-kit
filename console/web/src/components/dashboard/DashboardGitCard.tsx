import type { GitSnapshot } from "../../api";
import { formatRelativeTime } from "../../lib/formatTime";

export function DashboardGitCard({ git }: { git?: GitSnapshot | null }) {
  if (!git?.configured) {
    return (
      <section className="dash-panel dash-git">
        <p className="dash-panel-eyebrow">Git</p>
        <h3>Not mounted</h3>
        <p className="muted">HA config repo is not available at /repo inside the container.</p>
      </section>
    );
  }

  return (
    <section className="dash-panel dash-git">
      <header className="dash-panel-head">
        <div>
          <p className="dash-panel-eyebrow">Git snapshot</p>
          <h3>{git.branch ?? "staging"}</h3>
        </div>
        {git.isDirty && <span className="dash-badge dash-badge-warn">Local changes</span>}
      </header>
      <dl className="dash-kv">
        <div>
          <dt>Commit</dt>
          <dd>
            <code>{git.commitHash ?? "—"}</code>
          </dd>
        </div>
        <div>
          <dt>Message</dt>
          <dd>{git.commitSubject ?? "—"}</dd>
        </div>
        <div>
          <dt>Committed</dt>
          <dd>{git.commitDate ? formatRelativeTime(git.commitDate) : "—"}</dd>
        </div>
      </dl>
    </section>
  );
}
