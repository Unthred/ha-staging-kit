import { useCallback, useEffect, useState } from "react";
import type { ConfigDriftStatus, GitSnapshot, ProdStorageDeployGateResult, ReleaseImpactPreviewResult } from "../api";
import { operationsApi, releaseAgentApi } from "../api";
import {
  deployProdBlockMessage,
  getDeployProdState,
  lovelaceOnGithubStaging,
  prodHelperBundlePending,
  prodLovelaceBundlePending,
  prodStorageBundlePending,
  stagingProdPathPending,
} from "../lib/gitWorkflow";
import { gateStatusFromDeployGate, type LovelaceGateStatus } from "../lib/entityDeployGate";
import { useReleaseSafety } from "../context/ReleaseSafetyContext";

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
  const { prodWritesLocked, prodWritesEnabled, lockMessage } = useReleaseSafety();
  const [gateRefreshKey, setGateRefreshKey] = useState(0);
  const [deployGate, setDeployGate] = useState<ProdStorageDeployGateResult | null>(null);
  const [deployGateBusy, setDeployGateBusy] = useState(false);
  const [impactPreview, setImpactPreview] = useState<ReleaseImpactPreviewResult | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);
  const [releaseHistory, setReleaseHistory] = useState<Awaited<ReturnType<typeof releaseAgentApi.history>> | null>(
    null,
  );
  const [requestReleaseTitle, setRequestReleaseTitle] = useState<string | undefined>(undefined);
  const [gateStatus, setGateStatus] = useState<LovelaceGateStatus>({
    active: false,
    busy: false,
    ok: null,
    missingEntityCount: 0,
  });

  const reloadReleaseHistory = useCallback(async () => {
    try {
      const history = await releaseAgentApi.history();
      setReleaseHistory(history);
    } catch {
      setReleaseHistory(null);
    }
  }, []);

  useEffect(() => {
    void reloadReleaseHistory();
  }, [reloadReleaseHistory, git?.prodLastDeploySha, git?.commitHash]);

  const isDirty = git?.isDirty ?? false;
  const changedCount = git?.changedFileCount ?? 0;
  const commitsAhead = git?.commitsAhead ?? 0;
  const deployState = getDeployProdState(git, configDrift);
  const deployBlockMsg = deployProdBlockMessage(deployState);
  const stagingOnMain = (git?.stagingAheadOfMain ?? 0) === 0;
  const lovelacePending = prodLovelaceBundlePending(git);
  const lovelaceOnStagingPending = lovelaceOnGithubStaging(git) && stagingProdPathPending(git);
  const z2mPending =
    (git?.mainHaFileList ?? []).some((path) =>
      path.replace(/\\/g, "/").toLowerCase().startsWith("zigbee2mqtt/"),
    ) ||
    (git?.stagingHaFileList ?? []).some((path) =>
      path.replace(/\\/g, "/").toLowerCase().startsWith("zigbee2mqtt/"),
    );
  const gateRelevant =
    (lovelacePending || lovelaceOnStagingPending || z2mPending) && deployState.pending;
  const impactRelevant = deployState.canDeploy && deployState.pending && !deployBlockMsg;
  const releasePreviewBusy =
    impactBusy || (gateRelevant && (gateStatus.busy || deployGateBusy));
  const releaseBlocked =
    impactPreview?.blocksRelease ??
    (gateRelevant && (gateStatus.busy || deployGateBusy || gateStatus.ok === false));
  const gateBlocksDeploy = gateRelevant && !deployBlockMsg && (gateStatus.busy || deployGateBusy || gateStatus.ok === false);
  const canRequestRelease = deployState.canDeploy && !deployBlockMsg && !releaseBlocked && !releasePreviewBusy;
  const canLegacyDeploy = canRequestRelease && !prodWritesLocked;
  const canReleaseRollback =
    (releaseHistory?.releases.length ?? 0) >= 2 && (releaseHistory?.currentIndex ?? 0) > 1;
  const releaseRollbackTarget = canReleaseRollback
    ? releaseHistory?.releases.find((r) => r.index === (releaseHistory?.currentIndex ?? 0) - 1)
    : undefined;

  useEffect(() => {
    if (!gateRelevant) {
      setDeployGate(null);
      setGateStatus({ active: false, busy: false, ok: null, missingEntityCount: 0 });
      return;
    }

    let cancelled = false;
    setDeployGateBusy(true);
    setGateStatus({ active: true, busy: true, ok: null, missingEntityCount: 0 });

    operationsApi
      .prodStorageDeployGate()
      .then((result) => {
        if (cancelled) return;
        setDeployGate(result);
        setGateStatus(gateStatusFromDeployGate(result));
      })
      .catch(() => {
        if (cancelled) return;
        setDeployGate(null);
        setGateStatus({ active: true, busy: false, ok: false, missingEntityCount: 0 });
      })
      .finally(() => {
        if (!cancelled) setDeployGateBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [gateRelevant, gateRefreshKey, git?.mainAheadOfProdHa, git?.prodLastDeploySha]);

  useEffect(() => {
    if (!impactRelevant) {
      setImpactPreview(null);
      setImpactBusy(false);
      return;
    }

    let cancelled = false;
    setImpactBusy(true);

    releaseAgentApi
      .impact()
      .then((impact) => {
        if (cancelled) return;
        setImpactPreview(impact);
      })
      .catch(() => {
        if (cancelled) return;
        setImpactPreview(null);
      })
      .finally(() => {
        if (!cancelled) setImpactBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [impactRelevant, gateRefreshKey, git?.mainAheadOfProdHa, git?.prodLastDeploySha]);

  useEffect(() => {
    if (!canRequestRelease) {
      setRequestReleaseTitle(undefined);
      return;
    }

    let cancelled = false;
    if (impactPreview?.summary) {
      setRequestReleaseTitle(impactPreview.summary);
      return () => {
        cancelled = true;
      };
    }

    releaseAgentApi
      .plan()
      .then((plan) => {
        if (cancelled || !plan.ok) return;
        const parts = [`Release @ ${plan.shortSha ?? plan.gitSha?.slice(0, 7) ?? "main"}`];
        if (plan.willRunManifests.length > 0) {
          parts.push(`migrations: ${plan.willRunManifests.join(", ")}`);
        } else {
          parts.push("no pending migrations");
        }
        if (plan.requiresRegistryStop) parts.push("stops Core for registry work");
        setRequestReleaseTitle(parts.join(" · "));
      })
      .catch(() => {
        if (!cancelled) setRequestReleaseTitle(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [canRequestRelease, impactPreview?.summary, gateRefreshKey, git?.mainAheadOfProdHa, git?.prodLastDeploySha]);

  const bumpGate = () => {
    setGateRefreshKey((k) => k + 1);
    void reloadReleaseHistory();
    onDone?.();
  };

  const step1State: DeployStepState = isDirty ? (stagingOnMain ? "info" : "action") : "done";
  const step2State: DeployStepState = commitsAhead > 0 ? "action" : "done";
  const step3State: DeployStepState = deployBlockMsg
    ? "blocked"
    : impactPreview?.blocksRelease || gateStatus.ok === false
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
      ? git?.unpushedCommits?.[0]?.subject
        ? `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} to push — ${git.unpushedCommits[0].subject}`
        : `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} not on GitHub yet`
      : "Staging branch is on GitHub";

  let step3Text: string;
  if (deployBlockMsg) {
    step3Text = deployBlockMsg;
  } else if (impactPreview?.blocksRelease && (impactPreview.deployGate?.deltaBlockerCount ?? 0) > 0) {
    step3Text = `${impactPreview.deployGate!.deltaBlockerCount} new blocker${impactPreview.deployGate!.deltaBlockerCount === 1 ? "" : "s"} in this release — fix in Operations → Entity Janitor`;
  } else if (impactPreview?.blocksRelease) {
    step3Text = "Release blocked — Entity Janitor could not verify prod safely";
  } else if (gateStatus.ok === false && gateStatus.missingEntityCount > 0) {
    step3Text = `${gateStatus.missingEntityCount} new blocker${gateStatus.missingEntityCount === 1 ? "" : "s"} in this release — fix in Operations → Entity Janitor`;
  } else if (gateStatus.ok === false) {
    step3Text = "Entity Janitor failed — fix new blockers in Operations → Entity Janitor";
  } else if ((releasePreviewBusy || gateStatus.busy || deployGateBusy || impactBusy) && impactRelevant) {
    step3Text = "Checking release impact against prod…";
  } else if ((gateStatus.busy || deployGateBusy) && gateRelevant) {
    step3Text = "Running Entity Janitor scan against prod…";
  } else if (deployState.pendingHaFiles > 0 && (git?.stagingAheadOfMain ?? 0) > 0 && (git?.mainHaChangesForProdHa ?? 0) === 0) {
    step3Text = `${deployState.pendingHaFiles} HA on GitHub staging → merge to main and request release`;
  } else if (deployState.neverDeployed && deployState.pendingHaFiles > 0) {
    step3Text = `${deployState.pendingHaFiles} HA file${deployState.pendingHaFiles === 1 ? "" : "s"} on GitHub — first release`;
  } else if (deployState.pendingHaFiles > 0) {
    const commitNote =
      deployState.pendingMainCommits > 0
        ? ` (${deployState.pendingMainCommits} commit${deployState.pendingMainCommits === 1 ? "" : "s"} on main)`
        : "";
    step3Text = z2mPending && !lovelacePending
      ? `Zigbee2MQTT config on GitHub main → prod${commitNote}`
      : `${deployState.pendingHaFiles} HA on GitHub main → prod${commitNote}`;
  } else if (deployState.pending) {
    step3Text = prodWritesLocked
      ? "Merge staging → main, then request release"
      : "Merge staging → main and deploy";
  } else if (prodStorageBundlePending(git)) {
    const lovelace = prodLovelaceBundlePending(git);
    const helpers = prodHelperBundlePending(git);
    if (lovelace && helpers) step3Text = "Lovelace + helpers on main → prod (entity scan runs first)";
    else if (lovelace) step3Text = "Lovelace bundle on main → prod (entity scan runs first)";
    else step3Text = "Helper .storage on main → prod";
  } else {
    step3Text = "Prod HA matches GitHub main";
  }

  if (prodWritesLocked && canRequestRelease && deployState.pending && !deployBlockMsg) {
    if (step3Text.endsWith("→ prod") || step3Text.includes("first release")) {
      step3Text = `${step3Text.replace(" → prod", "")} — request release`;
    } else if (!step3Text.includes("request release")) {
      step3Text = `${step3Text} — use Request release below`;
    }
  }

  const requestReleaseButtonTitle =
    requestReleaseTitle ??
    (deployBlockMsg
      ? deployBlockMsg
      : releasePreviewBusy
        ? "Checking release impact against prod…"
        : impactPreview?.blocksRelease
          ? impactPreview.summary
          : gateStatus.busy && gateRelevant
            ? "Running Entity Janitor scan against prod…"
            : gateStatus.ok === false
              ? "Fix entity blockers in Operations → Entity Janitor"
              : deployState.pending
                ? prodWritesLocked
                  ? "Apply GitHub main to prod via release agent (migrations + deploy)"
                  : undefined
                : "Prod HA is already current");

  const legacyDeployTitle = prodWritesLocked ? lockMessage : requestReleaseButtonTitle;

  const gateHintVisible =
    gateRelevant &&
    !deployBlockMsg &&
    (gateStatus.busy ||
      deployGateBusy ||
      gateStatus.ok === false ||
      (deployGate?.preExistingMissingCount ?? 0) > 0);

  const impactPreviewVisible =
    impactRelevant &&
    !deployBlockMsg &&
    (impactBusy || impactPreview !== null);

  const allDone = step1State === "done" && step2State === "done" && step3State === "done";

  return {
    git,
    gateRefreshKey,
    deployGate,
    impactPreview,
    impactBusy,
    impactPreviewVisible,
    releasePreviewBusy,
    gateStatus,
    bumpGate,
    gateRelevant,
    gateHintVisible,
    gateBlocksDeploy,
    canRequestRelease,
    canLegacyDeploy,
    canReleaseRollback,
    releaseRollbackTarget,
    releaseHistory,
    deployState,
    deployBlockMsg,
    prodWritesLocked,
    prodWritesEnabled,
    z2mPending,
    step1State,
    step2State,
    step3State,
    step1Text,
    step2Text,
    step3Text,
    requestReleaseTitle: requestReleaseButtonTitle,
    legacyDeployTitle,
    allDone,
  };
}

export type DeployFlowModel = ReturnType<typeof useDeployFlow>;
