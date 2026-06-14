import type { GitLiveChip, GitSnapshot } from "../api";

export function formatGitChangeSummary(git?: GitSnapshot | null): string {
  if (!git?.configured) return "—";
  if (!git.isDirty) return "HA YAML clean";

  const parts: string[] = [];
  if (git.isHaDirty) {
    parts.push(`${git.haChangedFileCount} HA YAML`);
  }
  if (git.isRepoDirty) {
    parts.push(`${git.repoChangedFileCount} docs/repo`);
  }
  return parts.join(" · ");
}

export function formatGitLiveChangeSummary(git?: GitLiveChip | null): string {
  if (!git?.configured) return "—";
  if (!git.isHaDirty && !git.isRepoDirty) return "HA YAML clean";

  const parts: string[] = [];
  if (git.isHaDirty) parts.push(`${git.haChangedFileCount} HA YAML`);
  if (git.isRepoDirty) parts.push(`${git.repoChangedFileCount} docs/repo`);
  return parts.join(" · ");
}

export function gitSyncLabel(
  git?: Pick<GitSnapshot, "commitsAhead" | "commitsBehind"> | Pick<GitLiveChip, "commitsAhead" | "commitsBehind"> | null,
): string {
  if (!git) return "—";
  const parts: string[] = [];
  if ((git.commitsAhead ?? 0) > 0) parts.push(`↑${git.commitsAhead}`);
  if ((git.commitsBehind ?? 0) > 0) parts.push(`↓${git.commitsBehind}`);
  return parts.length > 0 ? parts.join(" ") : "in sync";
}
