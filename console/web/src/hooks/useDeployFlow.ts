import { useCallback, useEffect, useState } from "react";
import type { ConfigDriftStatus, GitSnapshot } from "../api";
import { releaseAgentApi } from "../api";
import {
  deployProdBlockMessage,
  getDeployProdState,
  prodHelperBundlePending,
  prodLovelaceBundlePending,
  prodStorageBundlePending,
} from "../lib/gitWorkflow";
import { gateStatusFromPreflight, type LovelaceGateStatus } from "../lib/entityDeployGate";
import { useNavAttentionContext } from "../context/NavAttentionContext";
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
  const { invalidatePreflight, runPreflight, preflightBusy } = useNavAttentionContext();
  const { prodWritesLocked, prodWritesEnabled, lockMessage } = useReleaseSafety();
  const [gateRefreshKey, setGateRefreshKey] = useState(0);
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
  const z2mPending = (git?.mainHaFileList ?? []).some((path) =>
    path.replace(/\\/g, "/").toLowerCase().startsWith("zigbee2mqtt/"),
  );
  const gateRelevant = (lovelacePending || z2mPending) && deployState.pending;
  const gateBlocksDeploy =
    gateRelevant && !deployBlockMsg && (gateStatus.busy || preflightBusy || gateStatus.ok === false);
  const canRequestRelease = deployState.canDeploy && !gateBlocksDeploy;
  const canLegacyDeploy = canRequestRelease && !prodWritesLocked;
  const canReleaseRollback =
    (releaseHistory?.releases.length ?? 0) >= 2 && (releaseHistory?.currentIndex ?? 0) > 1;
  const releaseRollbackTarget = canReleaseRollback
    ? releaseHistory?.releases.find((r) => r.index === (releaseHistory?.currentIndex ?? 0) - 1)
    : undefined;

  useEffect(() => {
    if (!gateRelevant) {
      invalidatePreflight();
      setGateStatus({ active: false, busy: false, ok: null, missingEntityCount: 0 });
      return;
    }

    let cancelled = false;
    setGateStatus({ active: true, busy: true, ok: null, missingEntityCount: 0 });

    runPreflight()
      .then((result) => {
        if (cancelled) return;
        setGateStatus(gateStatusFromPreflight(result));
      })
      .catch(() => {
        if (cancelled) return;
        setGateStatus({ active: true, busy: false, ok: false, missingEntityCount: 0 });
      });

    return () => {
      cancelled = true;
    };
  }, [gateRelevant, gateRefreshKey, git?.mainAheadOfProdHa, git?.prodLastDeploySha, invalidatePreflight, runPreflight]);

  useEffect(() => {
    if (!canRequestRelease) {
      setRequestReleaseTitle(undefined);
      return;
    }

    let cancelled = false;
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
  }, [canRequestRelease, gateRefreshKey, git?.mainAheadOfProdHa, git?.prodLastDeploySha]);

  const bumpGate = () => {
    invalidatePreflight();
    setGateRefreshKey((k) => k + 1);
    void reloadReleaseHistory();
    onDone?.();
  };

  const step1State: DeployStepState = isDirty ? (stagingOnMain ? "info" : "action") : "done";
  const step2State: DeployStepState = commitsAhead > 0 ? "action" : "done";
  const step3State: DeployStepState = deployBlockMsg
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
    step3Text = `${gateStatus.missingEntityCount} entity blocker${gateStatus.missingEntityCount === 1 ? "" : "s"} — fix in Operations → Entity deploy gate`;
  } else if (gateStatus.ok === false) {
    step3Text = "Entity deploy scan failed — fix in Operations → Entity deploy gate";
  } else if ((gateStatus.busy || preflightBusy) && gateRelevant) {
    step3Text = "Running entity deploy scan against prod…";
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
      : gateStatus.busy && gateRelevant
        ? "Running entity deploy scan against prod…"
        : gateStatus.ok === false
          ? "Fix entity deploy blockers in Operations → Entity deploy gate"
          : deployState.pending
            ? prodWritesLocked
              ? "Apply GitHub main to prod via release agent (migrations + deploy)"
              : undefined
            : "Prod HA is already current");

  const legacyDeployTitle = prodWritesLocked ? lockMessage : requestReleaseButtonTitle;

  const gateHintVisible =
    gateRelevant &&
    !deployBlockMsg &&
    (gateStatus.busy || preflightBusy || gateStatus.ok === false || gateStatus.ok === null);

  const allDone = step1State === "done" && step2State === "done" && step3State === "done";

  return {
    git,
    gateRefreshKey,
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
