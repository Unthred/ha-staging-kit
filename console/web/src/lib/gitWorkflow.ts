import type { ConfigDriftStatus, GitSnapshot } from "../api";

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
  const stagingHaPending =
    (git?.stagingAheadOfMain ?? 0) > 0 && (git?.stagingHaChanges ?? 0) > 0;

  const pending =
    prodHaYamlPending(git) || stagingHaPending || prodStorageBundlePending(git);

  const pendingHaFiles = neverDeployed
    ? mainHa + mainStorage
    : Math.max(mainHa, mainStorage, stagingHaPending ? git?.stagingHaChanges ?? 0 : 0);

  let blockReason: DeployProdBlockReason | undefined;
  const needsPromote = (git?.stagingAheadOfMain ?? 0) > 0;

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
