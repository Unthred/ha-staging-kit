import type { ProdStorageDeployGateResult, ProdStoragePreflightResult } from "../api";

export type LovelaceGateStatus = {
  active: boolean;
  busy: boolean;
  ok: boolean | null;
  missingEntityCount: number;
};

/** Full entity deploy scan (Operations panel). */
export function gateStatusFromPreflight(result: ProdStoragePreflightResult): LovelaceGateStatus {
  const noScanPending = result.issues.some(
    (issue) =>
      issue.includes("No Lovelace bundle or zigbee2mqtt changes") ||
      issue.includes("No Lovelace bundle changes pending") ||
      issue.includes("full scan below is for cleanup"),
  );
  const z2mBlockers = result.z2mConfigIssues.filter((issue) => issue.blocksDeploy).length;
  const entityBlockers = noScanPending ? 0 : result.missingEntityIssues.length;
  const count = noScanPending ? z2mBlockers : entityBlockers + z2mBlockers;
  const blockersRemain = entityBlockers + z2mBlockers > 0;
  return {
    active: true,
    busy: false,
    ok: noScanPending ? z2mBlockers === 0 : blockersRemain ? false : result.ok,
    missingEntityCount: count,
  };
}

/** Diff-scoped deploy/release gate — only new issues since last prod deploy block ship. */
export function gateStatusFromDeployGate(result: ProdStorageDeployGateResult): LovelaceGateStatus {
  const z2mBlockers = result.z2mConfigIssues.filter((issue) => issue.blocksDeploy).length;
  const count = result.deltaBlockerCount > 0 ? result.deltaBlockerCount : result.missingEntityIssues.length + z2mBlockers;
  return {
    active: true,
    busy: false,
    ok: result.ok,
    missingEntityCount: count,
  };
}
