import type { GitSnapshot, StagingRepresentationStatus } from "../../api";
import { formatGitChangeSummary, gitSyncLabel } from "../../lib/gitStatus";

function CheckItem({ ok, label, warn }: { ok: boolean; label: string; warn?: boolean }) {
  const tone = ok ? "ok" : warn ? "warn" : "bad";
  return (
    <li className={`dash-parity-check dash-parity-check-${tone}`}>
      <span className="dash-parity-check-icon" aria-hidden>
        {ok ? "✓" : warn ? "~" : "!"}
      </span>
      <span>{label}</span>
    </li>
  );
}

export function DashboardParityBanner({
  representation,
  git,
  compact,
}: {
  representation?: StagingRepresentationStatus | null;
  git?: GitSnapshot | null;
  compact?: boolean;
}) {
  if (!representation?.available) return null;

  const tone =
    representation.verdict === "aligned" ? "ok" : representation.verdict === "review" ? "warn" : "danger";

  const reviewCount = representation.issues.filter((i) => i.severity !== "info").length;
  const haGitIssue = representation.issues.find((i) => i.category === "git-ha");
  const repoGitIssue = representation.issues.find((i) => i.category === "git-repo");

  return (
    <section
      className={`dash-parity-banner dash-parity-banner-${tone} ${compact ? "dash-parity-banner-compact" : ""}`}
      aria-live="polite"
    >
      <div className="dash-parity-banner-main">
        <h3 className="dash-parity-banner-headline">{representation.headline}</h3>
        {!compact && <p className="dash-parity-banner-summary">{representation.summary}</p>}
      </div>

      <ul className="dash-parity-checklist">
        <CheckItem ok={representation.configMatchesGit} label="Config" />
        <CheckItem ok={representation.entityRegistryAligned} label="Entities" />
        <CheckItem ok={representation.presenceMatches} label="Presence" />
        <CheckItem ok={representation.gitClean} label="HA YAML" />
        {git?.isRepoDirty && representation.gitClean && (
          <CheckItem ok={false} warn label={`Docs (${git.repoChangedFileCount})`} />
        )}
      </ul>

      {git?.configured && (
        <p className="dash-parity-git-meta muted">
          {git.branch ?? "—"}
          {git.commitHash ? ` @ ${git.commitHash}` : ""}
          {" · "}
          {formatGitChangeSummary(git)}
          {" · "}
          {gitSyncLabel(git)}
        </p>
      )}

      {compact && haGitIssue && <p className="dash-parity-info dash-parity-info-compact">{haGitIssue.detail}</p>}
      {compact && !haGitIssue && repoGitIssue && (
        <p className="dash-parity-info dash-parity-info-compact dash-parity-info-muted">{repoGitIssue.detail}</p>
      )}

      {reviewCount > 0 && representation.verdict !== "aligned" && (
        <p className="dash-parity-review-hint muted">
          {compact ? "Select a row →" : `${reviewCount} item${reviewCount === 1 ? "" : "s"} to review — select a row below.`}
        </p>
      )}
    </section>
  );
}
