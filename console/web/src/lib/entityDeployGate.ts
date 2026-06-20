import type { ProdStoragePreflightResult } from "../api";

export type LovelaceGateStatus = {
  active: boolean;
  busy: boolean;
  ok: boolean | null;
  missingEntityCount: number;
};

export function gateStatusFromPreflight(result: ProdStoragePreflightResult): LovelaceGateStatus {
  const noScanPending = result.issues.some(
    (issue) =>
      issue.includes("No Lovelace bundle or zigbee2mqtt changes") ||
      issue.includes("No Lovelace bundle changes pending"),
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
