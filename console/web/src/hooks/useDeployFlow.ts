import { useState } from "react";
import type { ConfigDriftStatus, GitSnapshot } from "../api";
import {
  deployProdBlockMessage,
  getDeployProdState,
  prodHelperBundlePending,
  prodLovelaceBundlePending,
  prodStorageBundlePending,
} from "../lib/gitWorkflow";
import type { LovelaceGateStatus } from "../components/dashboard/DeployLovelaceGatePanel";

export type DeployStepState = "done" | "action" | "info" | "blocked";

export function useDeployFlow({
  git,
  configDrift,
  onDone,
}: {
  git?: GitSnapshot | null;
  configDrift?: ConfigDriftStatus | null;
  onDone?: () => void;
}) {
  const [gateRefreshKey, setGateRefreshKey] = useState(0);
  const [gateStatus, setGateStatus] = useState<LovelaceGateStatus>({
    active: false,
    busy: false,
    ok: null,
    missingEntityCount: 0,
  });

  const isDirty = git?.isDirty ?? false;
  const changedCount = git?.changedFileCount ?? 0;
  const commitsAhead = git?.commitsAhead ?? 0;
  const deployState = getDeployProdState(git, configDrift);
  const deployBlockMsg = deployProdBlockMessage(deployState);
  const stagingOnMain = (git?.stagingAheadOfMain ?? 0) === 0;
  const lovelacePending = prodLovelaceBundlePending(git);
  const z2mPending = (git?.mainHaFileList ?? []).some((path) =>
    path.replace(/\\/g, "/").toLowerCase().startsWith("zigbee2mqtt/"),
  );
  const gateRelevant = (lovelacePending || z2mPending) && deployState.pending;
  const gateBlocksDeploy =
    gateRelevant && !deployBlockMsg && (gateStatus.busy || gateStatus.ok === false);
  const canDeploy = deployState.canDeploy && !gateBlocksDeploy;

  const bumpGate = () => {
    setGateRefreshKey((k) => k + 1);
    onDone?.();
  };

  const step1State: DeployStepState = isDirty ? (stagingOnMain ? "info" : "action") : "done";
  const step2State: DeployStepState = commitsAhead > 0 ? "action" : "done";
  let step3State: DeployStepState = deployBlockMsg
    ? "blocked"
    : gateStatus.ok === false
      ? "blocked"
      : deployState.pending
        ? "action"
        : "done";

  const step1Text = isDirty
    ? stagingOnMain
      ? `${changedCount} local file${changedCount === 1 ? "" : "s"} uncommitted — prod deploy uses GitHub main`
      : `${changedCount} file${changedCount === 1 ? "" : "s"} not committed locally`
    : configDrift?.hasDrift && !configDrift.applyGapHasHaChanges
      ? "Local repo clean — doc commits only, no HA work to ship"
      : "Local repo clean";

  const step2Text =
    commitsAhead > 0
      ? `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} not on GitHub yet`
      : "Staging branch is on GitHub";

  let step3Text: string;
  if (deployBlockMsg) {
    step3Text = deployBlockMsg;
  } else if (gateStatus.ok === false && gateStatus.missingEntityCount > 0) {
    step3Text = `${gateStatus.missingEntityCount} entity blocker${gateStatus.missingEntityCount === 1 ? "" : "s"} — fix blockers above; scan refreshes when you return here`;
  } else if (gateStatus.ok === false) {
    step3Text = "Entity deploy scan failed — fix above before deploy";
  } else if (gateStatus.busy && gateRelevant) {
    step3Text = "Running entity deploy scan against prod…";
  } else if (deployState.pendingHaFiles > 0 && (git?.stagingAheadOfMain ?? 0) > 0 && (git?.mainHaChangesForProdHa ?? 0) === 0) {
    step3Text = `${deployState.pendingHaFiles} HA on GitHub staging → merge to main and deploy`;
  } else if (deployState.neverDeployed && deployState.pendingHaFiles > 0) {
    step3Text = `${deployState.pendingHaFiles} HA file${deployState.pendingHaFiles === 1 ? "" : "s"} on GitHub — first deploy`;
  } else if (deployState.pendingHaFiles > 0) {
    const commitNote =
      deployState.pendingMainCommits > 0
        ? ` (${deployState.pendingMainCommits} commit${deployState.pendingMainCommits === 1 ? "" : "s"} on main)`
        : "";
    step3Text = z2mPending && !lovelacePending
      ? `Zigbee2MQTT config on GitHub main → prod${commitNote}`
      : `${deployState.pendingHaFiles} HA on GitHub main → prod${commitNote}`;
  } else if (deployState.pending) {
    step3Text = "Merge staging → main and deploy";
  } else if (prodStorageBundlePending(git)) {
    const lovelace = prodLovelaceBundlePending(git);
    const helpers = prodHelperBundlePending(git);
    if (lovelace && helpers) step3Text = "Lovelace + helpers on main → prod (entity scan runs first)";
    else if (lovelace) step3Text = "Lovelace bundle on main → prod (entity scan runs first)";
    else step3Text = "Helper .storage on main → prod";
  } else {
    step3Text = "Prod HA matches GitHub main";
  }

  const deployTitle = deployBlockMsg
    ? deployBlockMsg
    : gateStatus.busy && gateRelevant
      ? "Running entity deploy scan against prod…"
      : gateStatus.ok === false
        ? "Fix entity deploy scan blockers above — scan refreshes when you return to Overview"
        : deployState.pending
          ? undefined
          : "Prod HA is already current";

  const allDone = step1State === "done" && step2State === "done" && step3State === "done";

  return {
    git,
    gateRefreshKey,
    gateStatus,
    setGateStatus,
    bumpGate,
    gateRelevant,
    gateBlocksDeploy,
    canDeploy,
    deployState,
    deployBlockMsg,
    z2mPending,
    step1State,
    step2State,
    step3State,
    step1Text,
    step2Text,
    step3Text,
    deployTitle,
    allDone,
  };
}

export type DeployFlowModel = ReturnType<typeof useDeployFlow>;
