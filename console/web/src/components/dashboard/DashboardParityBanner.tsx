import type { GitSnapshot, StagingRepresentationStatus } from "../../api";
import { formatGitChangeSummary, gitSyncLabel } from "../../lib/gitStatus";
import { prodHaYamlPending } from "../../lib/gitWorkflow";
import { SectionAttentionBadge } from "../PageAttentionPanel";

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
  embedded,
  attentionOrder,
}: {
  representation?: StagingRepresentationStatus | null;
  git?: GitSnapshot | null;
  compact?: boolean;
  /** Render inside the parity table panel (no outer section wrapper). */
  embedded?: boolean;
  attentionOrder?: number;
}) {
  if (!representation?.available) return null;

  const tone =
    representation.verdict === "aligned" ? "ok" : representation.verdict === "review" ? "warn" : "danger";

  const reviewCount = representation.issues.filter((i) => i.severity !== "info").length;
  const haGitIssue = representation.issues.find((i) => i.category === "git-ha");
  const repoGitIssue = representation.issues.find((i) => i.category === "git-repo");

  const Tag = embedded ? "div" : "section";

  return (
    <Tag
      className={`dash-parity-banner dash-parity-banner-${tone} ${compact ? "dash-parity-banner-compact" : ""}${embedded ? " dash-parity-banner-embedded" : ""}`}
      aria-live="polite"
    >
      <div className="dash-parity-banner-main">
        <h3 className="dash-parity-banner-headline">
          {representation.headline}
          <SectionAttentionBadge order={attentionOrder} />
        </h3>
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
        {git?.stagingAheadOfMain != null && (
          <CheckItem
            ok={
              git.stagingAheadOfMain === 0 &&
              !(git.isHaDirty ?? false) &&
              (git.commitsAhead ?? 0) === 0
            }
            warn={
              (git.isHaDirty ?? false) ||
              (git.commitsAhead ?? 0) > 0 ||
              git.stagingAheadOfMain > 0
            }
            label={
              (git.isHaDirty ?? false) && (git.haChangedFileCount ?? 0) > 0
                ? `Commit pending · ${git.haChangedFileCount} HA`
                : (git.commitsAhead ?? 0) > 0
                  ? `Push pending · ${git.commitsAhead} commit${git.commitsAhead === 1 ? "" : "s"}`
                  : git.stagingAheadOfMain === 0
                    ? "Staging on main"
                    : (git.stagingHaChanges ?? 0) === 0
                      ? `Merge pending · ${git.stagingAheadOfMain} docs on GitHub`
                      : `Merge pending · ${git.stagingHaChanges} HA on GitHub`
            }
          />
        )}
        {git?.configured && (
          <CheckItem
            ok={!prodHaYamlPending(git)}
            warn={git.prodDeployTracked === false}
            label={
              git.prodDeployTracked === false
                ? "Prod HA untracked"
                : prodHaYamlPending(git)
                  ? `Prod HA behind · ${git.mainHaChangesForProdHa} HA file${(git.mainHaChangesForProdHa ?? 0) === 1 ? "" : "s"}`
                  : "Prod HA current"
            }
          />
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
          {compact || embedded
            ? "Select a row below →"
            : `${reviewCount} item${reviewCount === 1 ? "" : "s"} to review — select a row below.`}
        </p>
      )}
    </Tag>
  );
}
