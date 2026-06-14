import type { ConfigDriftStatus, GitSnapshot } from "../api";

export function canShipToStaging(git?: GitSnapshot | null, drift?: ConfigDriftStatus | null): boolean {
  if (!git?.configured) return false;
  if (git.isDirty) return false;
  return (git.commitsAhead ?? 0) > 0 || Boolean(drift?.hasDrift);
}

export function canDeployToProd(git?: GitSnapshot | null, drift?: ConfigDriftStatus | null): boolean {
  if (!git?.configured) return false;
  if (git.isDirty) return false;
  if ((git.commitsAhead ?? 0) > 0) return false;
  if (drift?.hasDrift) return false;
  return true;
}

export function shipToStagingSummary(git?: GitSnapshot | null, drift?: ConfigDriftStatus | null): string {
  const parts: string[] = [];
  if ((git?.commitsAhead ?? 0) > 0) parts.push(`push ${git!.commitsAhead} commit(s) to origin/${git!.branch ?? "staging"}`);
  if (drift?.hasDrift) parts.push("apply git to staging appdata");
  parts.push("restart staging Home Assistant");
  return parts.join(" → ");
}
