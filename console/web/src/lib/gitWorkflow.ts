import type { ConfigDriftStatus, GitSnapshot, LovelaceDriftStatus } from "../api";

/** Prod HA only receives HA YAML — doc commits on main are not a deploy gap. */
export function prodHaYamlPending(git?: GitSnapshot | null): boolean {
  if (!git?.configured) return false;
  if (git.prodDeployTracked === false) return true;
  return (git.mainHaChangesForProdHa ?? 0) > 0;
}

/** Dashboard / helper .storage edits on main waiting for prod deploy. */
export function prodStorageBundlePending(git?: GitSnapshot | null): boolean {
  if (!git?.configured) return false;
  if (git.prodDeployTracked === false) return (git.mainStorageChangesForProdHa ?? 0) > 0;
  return (git.mainStorageChangesForProdHa ?? 0) > 0 && (git.mainAheadOfProdHa ?? 0) > 0;
}

export function prodLovelaceBundlePending(git?: GitSnapshot | null): boolean {
  const files = git?.mainStorageFileList ?? [];
  return files.some((p) => p.includes("lovelace"));
}

export function prodHelperBundlePending(git?: GitSnapshot | null): boolean {
  const files = git?.mainStorageFileList ?? [];
  return files.some((p) => !p.includes("lovelace"));
}

/** @deprecated use prodStorageBundlePending */
export function prodLovelaceTitlePending(git?: GitSnapshot | null): boolean {
  return prodLovelaceBundlePending(git);
}

/** @deprecated use prodStorageBundlePending */
export function prodDashboardOnlyOnMain(git?: GitSnapshot | null): boolean {
  return prodStorageBundlePending(git) && (git?.mainHaChangesForProdHa ?? 0) === 0;
}

export function prodHaStatusLabel(git?: GitSnapshot | null): string {
  if (!git?.configured) return "—";
  if (git.prodDeployTracked === false) return "Never deployed";
  if ((git.mainHaChangesForProdHa ?? 0) > 0) {
    const n = git.mainHaChangesForProdHa ?? 0;
    return `${n} HA file${n === 1 ? "" : "s"} pending deploy`;
  }
  if (prodStorageBundlePending(git)) {
    const n = git.mainStorageChangesForProdHa ?? 0;
    if (prodLovelaceBundlePending(git) && prodHelperBundlePending(git)) {
      return `${n} dashboard + helper edit${n === 1 ? "" : "s"} pending deploy`;
    }
    if (prodLovelaceBundlePending(git)) return `${n} Lovelace edit${n === 1 ? "" : "s"} pending deploy`;
    return `${n} helper edit${n === 1 ? "" : "s"} pending deploy`;
  }
  return "Current";
}

/** HA or deploy-tracked .storage on GitHub staging but not on main — on the prod path. */
export function stagingProdPathPending(git?: GitSnapshot | null): boolean {
  return (git?.stagingAheadOfMain ?? 0) > 0 && (git?.stagingHaChanges ?? 0) > 0;
}

/** Docs/repo-only commits on GitHub staging — never reach prod; done after push. */
export function stagingDocsOnlyOnGitHub(git?: GitSnapshot | null): boolean {
  return (git?.stagingAheadOfMain ?? 0) > 0 && (git?.stagingHaChanges ?? 0) === 0;
}

/** GitHub row in Compare Instances needs review (push, uncommitted HA, or HA on staging). */
export function githubCompareNeedsReview(git?: GitSnapshot | null): boolean {
  if (!git?.configured) return false;
  if ((git.commitsAhead ?? 0) > 0) return true;
  if ((git.isHaDirty ?? false) && (git.haChangedFileCount ?? 0) > 0) return true;
  return stagingProdPathPending(git);
}

export function githubCompareGitColumn(git?: GitSnapshot | null): string {
  if ((git?.commitsAhead ?? 0) > 0) return `${git!.commitsAhead} to push`;
  if (stagingProdPathPending(git)) return `${git!.stagingAheadOfMain} on staging`;
  if (git?.stagingAheadOfMain == null) return "—";
  return "On main";
}

export function githubCompareStagingColumn(git?: GitSnapshot | null): string {
  if ((git?.commitsAhead ?? 0) > 0) {
    return git?.unpushedCommits?.[0]?.subject ?? git?.commitSubject ?? "Review push preview";
  }
  if ((git?.isHaDirty ?? false) && (git?.haChangedFileCount ?? 0) > 0) {
    return `${git!.haChangedFileCount} HA not committed`;
  }
  if (stagingProdPathPending(git)) {
    return `${git!.stagingHaChanges} HA on staging`;
  }
  if (git?.stagingAheadOfMain == null) return "—";
  return "On main";
}

export function githubCompareAligned(git?: GitSnapshot | null): boolean | undefined {
  if (!git?.configured) return undefined;
  if (git.stagingAheadOfMain == null) return undefined;
  return !githubCompareNeedsReview(git);
}

export function lovelaceInGitDirty(git?: GitSnapshot | null): boolean {
  return (git?.haChangedFiles ?? []).some((f) => f.replace(/\\/g, "/").includes("lovelace"));
}

export function lovelaceInUnpushed(git?: GitSnapshot | null): boolean {
  return (git?.unpushedHaFiles ?? []).some((f) => f.replace(/\\/g, "/").includes("lovelace"));
}

export function lovelaceOnGithubStaging(git?: GitSnapshot | null): boolean {
  return (git?.stagingHaFileList ?? []).some((f) => f.replace(/\\/g, "/").includes("lovelace"));
}

export function lovelacePendingOnMain(git?: GitSnapshot | null): boolean {
  return prodStorageBundlePending(git) && (git?.mainStorageFileList ?? []).some((f) => f.includes("lovelace"));
}

export type DashboardShipPhase = "import" | "commit" | "push" | "merge" | "release" | "done";

/** Kit / GitHub column label for the Dashboard compare row. */
export function dashboardGitColumnLabel(
  git?: GitSnapshot | null,
  lovelaceDrift?: LovelaceDriftStatus | null,
): string {
  if (!lovelaceDrift?.available) return "—";
  if (lovelacePendingOnMain(git)) return "On GitHub main";
  if (lovelaceOnGithubStaging(git)) return "On GitHub staging";
  if (lovelaceInUnpushed(git)) return "Ready to push";
  if (lovelaceInGitDirty(git)) return "Uncommitted";
  if (lovelaceDrift.stagingDiffersFromRepo) return "Staging HA only";
  return lovelaceDrift.repoTitle ?? "Up to date";
}

export function dashboardShipPhase(
  git?: GitSnapshot | null,
  lovelaceDrift?: LovelaceDriftStatus | null,
): DashboardShipPhase {
  if (!lovelaceDrift?.available) return "done";
  if (lovelaceDrift.stagingDiffersFromRepo && !lovelaceInGitDirty(git)) return "import";
  if (lovelaceInGitDirty(git)) return "commit";
  if ((git?.commitsAhead ?? 0) > 0 && lovelaceInUnpushed(git)) return "push";
  if (lovelaceOnGithubStaging(git) && stagingProdPathPending(git)) return "merge";
  if (lovelacePendingOnMain(git) || lovelaceDrift.stagingDiffersFromProd) return "release";
  return "done";
}

export type DeployProdBlockReason = "commit" | "push";

export type DeployProdState = {
  /** GitHub main (or staging→main merge) has HA work waiting for prod */
  pending: boolean;
  pendingHaFiles: number;
  pendingMainCommits: number;
  neverDeployed: boolean;
  canDeploy: boolean;
  blockReason?: DeployProdBlockReason;
};

/** Whether prod deploy is meaningful and allowed from the wizard. */
export function getDeployProdState(
  git?: GitSnapshot | null,
  _drift?: ConfigDriftStatus | null,
): DeployProdState {
  const neverDeployed = git?.prodDeployTracked === false;
  const mainHa = git?.mainHaChangesForProdHa ?? 0;
  const mainStorage = git?.mainStorageChangesForProdHa ?? 0;
  const stagingHaPending = stagingProdPathPending(git);

  const pending =
    prodHaYamlPending(git) || stagingHaPending || prodStorageBundlePending(git);

  const pendingHaFiles = neverDeployed
    ? mainHa + mainStorage
    : Math.max(mainHa, mainStorage, stagingHaPending ? git?.stagingHaChanges ?? 0 : 0);

  let blockReason: DeployProdBlockReason | undefined;
  const needsPromote = stagingHaPending;

  if ((git?.commitsAhead ?? 0) > 0) blockReason = "push";
  else if (git?.isDirty && needsPromote) blockReason = "commit";

  const canDeploy = Boolean(git?.configured) && pending && !blockReason;

  return {
    pending,
    pendingHaFiles,
    pendingMainCommits: git?.mainAheadOfProdHa ?? 0,
    neverDeployed,
    canDeploy,
    blockReason,
  };
}

export function deployProdBlockMessage(state: DeployProdState): string | null {
  if (!state.pending) return null;
  if (state.blockReason === "commit")
    return "Commit local changes — GitHub staging is not on main yet";
  if (state.blockReason === "push") return "Push to GitHub first";
  return null;
}
