import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  operationsApi,
  toApiError,
  type ApiError,
  type LovelaceFixOption,
  type ProdStoragePreflightResult,
  type Z2mStaleConfigIssue,
} from "../../api";
import { ActionButton } from "../ActionButton";
import { SectionAttentionBadge } from "../PageAttentionPanel";
import { useToast } from "../Toast";
import { useNavAttentionContext } from "../../context/NavAttentionContext";
import { LovelaceIssueDetailBody } from "./LovelaceIssueDetailBody";
import { DeployLovelaceGateScanProgress } from "./DeployLovelaceGateScanProgress";
import { usePreflightScanProgress } from "../../hooks/usePreflightScanProgress";

/** Minimum ms between focus-triggered entity deploy rescans. */
const DEPLOY_GATE_FOCUS_RECHECK_MS = 90_000;
/** Coalesce kit-fix rescans so rapid fixes trigger one background scan. */
const DEPLOY_GATE_RESCAN_DEBOUNCE_MS = 1_500;

type LoadMode = "foreground" | "background";
type ListTab = "blocking" | "awaiting" | "deferred";

function sortByEntityId<T extends { entityId: string }>(issues: T[]): T[] {
  return [...issues].sort((a, b) => a.entityId.localeCompare(b.entityId));
}

/** Keep prior list order on background rescans so rows do not reshuffle. */
function stabilizeIssueList<T extends { entityId: string }>(prev: T[], next: T[]): T[] {
  const nextById = new Map(next.map((issue) => [issue.entityId, issue]));
  const ordered: T[] = [];
  for (const issue of prev) {
    const updated = nextById.get(issue.entityId);
    if (updated) {
      ordered.push(updated);
      nextById.delete(issue.entityId);
    }
  }
  return [...ordered, ...sortByEntityId([...nextById.values()])];
}

function stabilizeScanResult(
  prev: ProdStoragePreflightResult,
  next: ProdStoragePreflightResult,
): ProdStoragePreflightResult {
  return {
    ...next,
    missingEntityIssues: stabilizeIssueList(prev.missingEntityIssues, next.missingEntityIssues),
    deployMissingEntityIssues: stabilizeIssueList(
      prev.deployMissingEntityIssues,
      next.deployMissingEntityIssues,
    ),
    deferredEntityIssues: stabilizeIssueList(prev.deferredEntityIssues, next.deferredEntityIssues),
  };
}

function selectAfterRemovingFromList<T extends { entityId: string }>(
  list: T[],
  removedEntityId: string,
): string | null {
  const index = list.findIndex((item) => item.entityId === removedEntityId);
  const after = list.filter((item) => item.entityId !== removedEntityId);
  if (after.length === 0) return null;
  if (index < 0) return after[0]?.entityId ?? null;
  return after[index]?.entityId ?? after[index - 1]?.entityId ?? after[0]?.entityId ?? null;
}

function mergeScanWithPendingFixes(
  server: ProdStoragePreflightResult,
  pendingFixedIds: Set<string>,
): ProdStoragePreflightResult {
  if (pendingFixedIds.size === 0) return server;

  let blocking = [...server.missingEntityIssues];
  let awaiting = [...server.deployMissingEntityIssues];

  for (const id of [...pendingFixedIds]) {
    const serverBlockingIssue = blocking.find((issue) => issue.entityId === id);
    const serverAwaitingIssue = awaiting.find((issue) => issue.entityId === id);

    if (!serverBlockingIssue && serverAwaitingIssue) {
      pendingFixedIds.delete(id);
      continue;
    }

    if (!serverBlockingIssue) continue;

    blocking = blocking.filter((issue) => issue.entityId !== id);
    if (!awaiting.some((issue) => issue.entityId === id)) {
      awaiting.push({
        ...serverBlockingIssue,
        awaitingPublishAction: serverAwaitingIssue?.awaitingPublishAction ?? "fixed",
      });
    }
  }

  return {
    ...server,
    missingEntityIssues: sortByEntityId(blocking),
    deployMissingEntityIssues: sortByEntityId(awaiting),
  };
}

/** Keep optimistic defers visible until the server scan agrees (same pattern as rename/remove). */
function mergeScanWithPendingDefers(
  server: ProdStoragePreflightResult,
  pendingDeferredIds: Set<string>,
): ProdStoragePreflightResult {
  if (pendingDeferredIds.size === 0) return server;

  let blocking = [...server.missingEntityIssues];
  let deferred = [...server.deferredEntityIssues];

  for (const id of [...pendingDeferredIds]) {
    if (deferred.some((issue) => issue.entityId === id)) {
      pendingDeferredIds.delete(id);
      continue;
    }

    const blockingIssue = blocking.find((issue) => issue.entityId === id);
    if (!blockingIssue) continue;

    blocking = blocking.filter((issue) => issue.entityId !== id);
    deferred.push(blockingIssue);
  }

  return {
    ...server,
    missingEntityIssues: sortByEntityId(blocking),
    deferredEntityIssues: sortByEntityId(deferred),
  };
}

export type LovelaceGateStatus = {
  active: boolean;
  busy: boolean;
  ok: boolean | null;
  missingEntityCount: number;
};

function awaitingFixLabel(action?: string | null): string {
  if (!action) return "Awaiting publish";
  switch (action.toLowerCase()) {
    case "rename":
      return "Awaiting publish — rename";
    case "remove":
      return "Awaiting publish — remove";
    case "defer":
      return "Awaiting publish — deferred";
    case "fixed":
      return "Awaiting publish — fixed";
    default:
      return `Awaiting publish — ${action}`;
  }
}

function kindLabel(kind: string, issueClass?: string): string {
  switch (issueClass ?? kind) {
    case "git_wrong_name":
      return "Dashboard mismatch";
    case "prod_typo":
      return "Fix on prod";
    case "missing_on_prod":
      return "Missing on prod";
    case "staging_only":
      return "Staging only";
    case "rename":
      return "Dashboard wrong name";
    case "remove":
      return "Remove stale card";
    case "add_on_prod":
      return "Add on prod or remove";
    case "deferred":
      return "Deferred";
    default:
      return "Review";
  }
}

function isJsonParseIssue(issue: string): boolean {
  return (
    issue.includes("Invalid JSON") ||
    issue.includes("Local dashboard JSON is invalid") ||
    issue.includes("dashboard JSON is invalid")
  );
}

function GateTitle({
  children,
  attentionOrder,
  status,
}: {
  children: ReactNode;
  attentionOrder?: number;
  status?: ReactNode;
}) {
  return (
    <p className="deploy-lovelace-gate-title">
      <span className="deploy-lovelace-gate-title-text">{children}</span>
      {status}
      <SectionAttentionBadge order={attentionOrder} />
    </p>
  );
}

export function DeployLovelaceGatePanel({
  active,
  refreshKey,
  onStatusChange,
  onFixed,
  attentionOrder,
}: {
  active: boolean;
  refreshKey: number;
  onStatusChange?: (status: LovelaceGateStatus) => void;
  onFixed?: () => void;
  attentionOrder?: number;
}) {
  const { publishPreflight } = useNavAttentionContext();
  const { push: pushToast } = useToast();
  const [data, setData] = useState<ProdStoragePreflightResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [backgroundScanning, setBackgroundScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [fixBusy, setFixBusy] = useState(false);
  const [z2mFixBusy, setZ2mFixBusy] = useState(false);
  const [selectedZ2mIeee, setSelectedZ2mIeee] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmPurgeDeleted, setConfirmPurgeDeleted] = useState(false);
  const preferSelectAfterLoadRef = useRef<string | null | undefined>(undefined);
  const lastScanAtRef = useRef(0);
  const rescanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadRef = useRef(false);
  const pendingFixedIdsRef = useRef<Set<string>>(new Set());
  const pendingDeferredIdsRef = useRef<Set<string>>(new Set());
  const intendedSelectIdRef = useRef<string | null>(null);
  const dataRef = useRef<ProdStoragePreflightResult | null>(null);
  const listsRef = useRef<HTMLDivElement>(null);
  const [reviewStacked, setReviewStacked] = useState(false);
  const [listTab, setListTab] = useState<ListTab>("blocking");
  const scanProgress = usePreflightScanProgress(busy);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    setConfirmPurgeDeleted(false);
  }, [selectedId]);

  const blockingIssues = data?.missingEntityIssues ?? [];
  const deferredIssues = data?.deferredEntityIssues ?? [];
  const deployMissingIssues = data?.deployMissingEntityIssues ?? [];
  const sortedBlockingIssues = useMemo(() => sortByEntityId(blockingIssues), [blockingIssues]);
  const sortedAwaitingIssues = useMemo(() => sortByEntityId(deployMissingIssues), [deployMissingIssues]);
  const sortedDeferredIssues = useMemo(() => sortByEntityId(deferredIssues), [deferredIssues]);
  const activeListIssues =
    listTab === "blocking"
      ? sortedBlockingIssues
      : listTab === "awaiting"
        ? sortedAwaitingIssues
        : sortedDeferredIssues;
  const z2mIssues = data?.z2mConfigIssues ?? [];
  const blockingZ2mIssues = useMemo(
    () => z2mIssues.filter((issue) => issue.blocksDeploy),
    [z2mIssues],
  );
  const selectedZ2m = useMemo(
    () => z2mIssues.find((issue) => issue.liveIeee === selectedZ2mIeee) ?? z2mIssues[0] ?? null,
    [selectedZ2mIeee, z2mIssues],
  );
  const allIssues = useMemo(
    () => [...blockingIssues, ...deferredIssues, ...deployMissingIssues],
    [blockingIssues, deferredIssues, deployMissingIssues],
  );
  const selected = useMemo(
    () =>
      allIssues.find((issue) => issue.entityId === selectedId) ??
      blockingIssues[0] ??
      deployMissingIssues[0] ??
      deferredIssues[0] ??
      null,
    [allIssues, blockingIssues, deployMissingIssues, deferredIssues, selectedId],
  );
  const selectedIsDeferred = selected
    ? deferredIssues.some((issue) => issue.entityId === selected.entityId)
    : false;
  const selectedAwaitsPublish = selected
    ? deployMissingIssues.some((issue) => issue.entityId === selected.entityId)
    : false;

  useEffect(() => {
    if (!selected?.entityChoices?.length) {
      setSelectedChoiceId(null);
      return;
    }
    const preferred =
      selected.entityChoices.find((c) => c.source === "prod") ?? selected.entityChoices[0];
    setSelectedChoiceId(preferred.entityId);
  }, [selected?.entityId, selected?.entityChoices, selected?.suggestionKind]);

  const selectedChoice = useMemo(
    () => selected?.entityChoices?.find((c) => c.entityId === selectedChoiceId) ?? null,
    [selected?.entityChoices, selectedChoiceId],
  );

  const report = useCallback(
    (next: LovelaceGateStatus) => {
      onStatusChange?.(next);
    },
    [onStatusChange],
  );

  const gateStatusFromResult = useCallback((result: ProdStoragePreflightResult): LovelaceGateStatus => {
    const noScanPending = result.issues.some(
      (i) =>
        i.includes("No Lovelace bundle or zigbee2mqtt changes") ||
        i.includes("No Lovelace bundle changes pending"),
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
  }, []);

  const load = useCallback(async (preferSelectId?: string | null, mode: LoadMode = "foreground") => {
    if (!active) {
      setData(null);
      setError(null);
      setSelectedId(null);
      publishPreflight(null);
      report({ active: false, busy: false, ok: null, missingEntityCount: 0 });
      return;
    }

    const preferredId =
      preferSelectId !== undefined && preferSelectId !== null
        ? preferSelectId
        : preferSelectAfterLoadRef.current !== undefined
          ? preferSelectAfterLoadRef.current
          : undefined;
    preferSelectAfterLoadRef.current = undefined;

    const background = mode === "background";
    if (!background) {
      pendingFixedIdsRef.current.clear();
      pendingDeferredIdsRef.current.clear();
      intendedSelectIdRef.current = null;
    }
    if (background) {
      setBackgroundScanning(true);
    } else {
      setScanError(null);
      setBusy(true);
      report({ active: true, busy: true, ok: null, missingEntityCount: 0 });
    }
    try {
      const result = await operationsApi.prodStoragePreflight();
      let merged = mergeScanWithPendingFixes(result, pendingFixedIdsRef.current);
      merged = mergeScanWithPendingDefers(merged, pendingDeferredIdsRef.current);
      if (background && dataRef.current) {
        merged = stabilizeScanResult(dataRef.current, merged);
      } else {
        merged = {
          ...merged,
          missingEntityIssues: sortByEntityId(merged.missingEntityIssues),
          deployMissingEntityIssues: sortByEntityId(merged.deployMissingEntityIssues),
          deferredEntityIssues: sortByEntityId(merged.deferredEntityIssues),
        };
      }
      setData(merged);
      publishPreflight(merged);
      setError(null);
      setScanError(null);
      const all = [
        ...merged.missingEntityIssues,
        ...merged.deployMissingEntityIssues,
        ...merged.deferredEntityIssues,
      ];
      const resolvedSelection =
        preferredId && all.some((issue) => issue.entityId === preferredId)
          ? preferredId
          : preferredId === null
            ? null
            : merged.missingEntityIssues[0]?.entityId ??
              merged.deployMissingEntityIssues[0]?.entityId ??
              merged.deferredEntityIssues[0]?.entityId ??
              null;
      setSelectedId((current) => {
        const intended = intendedSelectIdRef.current;
        if (intended && all.some((issue) => issue.entityId === intended)) {
          intendedSelectIdRef.current = null;
          return intended;
        }
        if (background && current && all.some((issue) => issue.entityId === current)) {
          return current;
        }
        return resolvedSelection;
      });
      if (merged.z2mConfigIssues.length > 0) {
        setSelectedZ2mIeee((current) =>
          current && merged.z2mConfigIssues.some((issue) => issue.liveIeee === current)
            ? current
            : merged.z2mConfigIssues[0]?.liveIeee ?? null,
        );
      } else {
        setSelectedZ2mIeee(null);
      }
      report(gateStatusFromResult(merged));
      lastScanAtRef.current = Date.now();
    } catch (e) {
      const apiError = toApiError(e);
      if (background) {
        setScanError(apiError.message);
      } else {
        setError(apiError);
        setData(null);
        publishPreflight(null);
        setSelectedId(null);
      }
      report({ active: true, busy: false, ok: false, missingEntityCount: 0 });
    } finally {
      if (background) setBackgroundScanning(false);
      else setBusy(false);
    }
  }, [active, gateStatusFromResult, publishPreflight, report]);

  useEffect(() => {
    if (!active) {
      initialLoadRef.current = false;
      void load(undefined, "foreground");
      return;
    }
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      void load(undefined, "foreground");
    }
  }, [active, load]);

  useEffect(() => {
    if (!active || !data || refreshKey === 0) return;
    if (rescanTimerRef.current) clearTimeout(rescanTimerRef.current);
    rescanTimerRef.current = setTimeout(() => {
      rescanTimerRef.current = null;
      void load(undefined, "background");
    }, DEPLOY_GATE_RESCAN_DEBOUNCE_MS);
    return () => {
      if (rescanTimerRef.current) {
        clearTimeout(rescanTimerRef.current);
        rescanTimerRef.current = null;
      }
    };
  }, [active, data, load, refreshKey]);

  useEffect(() => {
    if (!active || !data) return;
    const needsAttention =
      blockingIssues.length > 0 || blockingZ2mIssues.length > 0 || data.pendingCommit;
    if (!needsAttention) return;

    const maybeRecheckOnReturn = () => {
      if (document.visibilityState !== "visible") return;
      if (busy || fixBusy || z2mFixBusy) return;
      if (Date.now() - lastScanAtRef.current < DEPLOY_GATE_FOCUS_RECHECK_MS) return;
      void load(undefined, "background");
    };

    window.addEventListener("focus", maybeRecheckOnReturn);
    document.addEventListener("visibilitychange", maybeRecheckOnReturn);
    return () => {
      window.removeEventListener("focus", maybeRecheckOnReturn);
      document.removeEventListener("visibilitychange", maybeRecheckOnReturn);
    };
  }, [
    active,
    data,
    blockingIssues.length,
    blockingZ2mIssues.length,
    data?.pendingCommit,
    busy,
    fixBusy,
    z2mFixBusy,
    load,
  ]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const syncStacked = () => setReviewStacked(mq.matches);
    syncStacked();
    mq.addEventListener("change", syncStacked);
    return () => mq.removeEventListener("change", syncStacked);
  }, []);

  useEffect(() => {
    if (!selectedId || !listsRef.current) return;
    const frame = requestAnimationFrame(() => {
      listsRef.current
        ?.querySelector<HTMLElement>(".deploy-lovelace-gate-issue.active")
        ?.scrollIntoView({ block: "nearest", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, listTab, activeListIssues.length]);

  const applyOptimisticFix = useCallback(
    (entityId: string, action: LovelaceFixOption["action"]) => {
      setData((prev) => {
        if (!prev) return prev;
        if (action === "defer") {
          const issue = prev.missingEntityIssues.find((i) => i.entityId === entityId);
          if (!issue) return prev;
          const next = {
            ...prev,
            missingEntityIssues: prev.missingEntityIssues.filter((i) => i.entityId !== entityId),
            deferredEntityIssues: [...prev.deferredEntityIssues, issue],
          };
          publishPreflight(next);
          report(gateStatusFromResult(next));
          return next;
        }
        if (action === "undefer") {
          const issue = prev.deferredEntityIssues.find((i) => i.entityId === entityId);
          if (!issue) return prev;
          const next = {
            ...prev,
            deferredEntityIssues: prev.deferredEntityIssues.filter((i) => i.entityId !== entityId),
            missingEntityIssues: [...prev.missingEntityIssues, issue],
          };
          publishPreflight(next);
          report(gateStatusFromResult(next));
          return next;
        }
        const issue = prev.missingEntityIssues.find((i) => i.entityId === entityId);
        if (!issue) return prev;
        const next = {
          ...prev,
          missingEntityIssues: prev.missingEntityIssues.filter((i) => i.entityId !== entityId),
          deployMissingEntityIssues: sortByEntityId([
            ...prev.deployMissingEntityIssues,
            {
              ...issue,
              awaitingPublishAction:
                action === "rename" || action === "remove" ? action : action === "defer" ? "defer" : "fixed",
            },
          ]),
          fixedLocallyCount:
            action === "rename" || action === "remove" ? prev.fixedLocallyCount + 1 : prev.fixedLocallyCount,
        };
        publishPreflight(next);
        report(gateStatusFromResult(next));
        return next;
      });
    },
    [gateStatusFromResult, publishPreflight, report],
  );

  const refreshAfterFix = useCallback(
    (currentEntityId: string | null, action: LovelaceFixOption["action"]) => {
      if (currentEntityId) {
        const prev = dataRef.current;
        if (prev) {
          if (action === "undefer") {
            intendedSelectIdRef.current = currentEntityId;
            setSelectedId(currentEntityId);
            setListTab("blocking");
          } else if (action === "defer") {
            pendingDeferredIdsRef.current.add(currentEntityId);
            const nextId = selectAfterRemovingFromList(prev.missingEntityIssues, currentEntityId);
            if (nextId) {
              intendedSelectIdRef.current = nextId;
              setSelectedId(nextId);
            } else {
              intendedSelectIdRef.current = null;
              setSelectedId(null);
            }
          } else if (action === "rename" || action === "remove") {
            pendingFixedIdsRef.current.add(currentEntityId);
            const nextId = selectAfterRemovingFromList(prev.missingEntityIssues, currentEntityId);
            if (nextId) {
              intendedSelectIdRef.current = nextId;
              setSelectedId(nextId);
            } else {
              intendedSelectIdRef.current = null;
              setSelectedId(null);
            }
            setListTab("blocking");
          }
        }
        applyOptimisticFix(currentEntityId, action);
      }
      onFixed?.();
    },
    [applyOptimisticFix, onFixed],
  );

  const applyFix = useCallback(
    async (option: LovelaceFixOption, replacementOverride?: string) => {
      if (!selected && option.action !== "undo" && option.action !== "undo_all") return;
      const currentEntityId = selected?.entityId ?? null;

      const replacement =
        option.action === "rename"
          ? (replacementOverride ?? option.replacementEntityId ?? "").trim()
          : null;

      if (option.action === "rename" && !replacement) {
        pushToast("Enter the entity id to rename to.", "err");
        return;
      }
      if (option.action === "defer" || option.action === "undefer") {
        setFixBusy(true);
        try {
          const result = await operationsApi.lovelaceParityFix({
            entityId: selected!.entityId,
            action: option.action,
          });
          if (!result.ok) {
            pushToast(result.message, "err");
            return;
          }
          pushToast(result.message, "ok");
          refreshAfterFix(currentEntityId, option.action);
        } catch (e) {
          pushToast(toApiError(e).message, "err");
        } finally {
          setFixBusy(false);
        }
        return;
      }

      if (option.action === "undo" || option.action === "undo_all") {
        setFixBusy(true);
        try {
          const result = await operationsApi.lovelaceParityFix({
            entityId: "_",
            action: option.action,
          });
          if (!result.ok) {
            pushToast(result.message, "err");
            return;
          }
          pushToast(result.message, "ok");
          pendingFixedIdsRef.current.clear();
          pendingDeferredIdsRef.current.clear();
          intendedSelectIdRef.current = null;
          setSelectedId(null);
          onFixed?.();
          await load(undefined, "foreground");
        } catch (e) {
          pushToast(toApiError(e).message, "err");
        } finally {
          setFixBusy(false);
        }
        return;
      }

      setFixBusy(true);
      try {
        const entityId = selected!.entityId;
        const result = await operationsApi.lovelaceParityFix({
          entityId,
          action: option.action,
          replacementEntityId: replacement,
        });
        if (!result.ok) {
          pushToast(result.message, "err");
          return;
        }
        pushToast(result.message, "ok");
        refreshAfterFix(currentEntityId, option.action);
      } catch (e) {
        pushToast(toApiError(e).message, "err");
      } finally {
        setFixBusy(false);
      }
    },
    [load, onFixed, pushToast, refreshAfterFix, selected],
  );

  const undoLastFix = useCallback(async () => {
    await applyFix({ id: "undo", label: "Undo", action: "undo" });
  }, [applyFix]);

  const undoAllFixes = useCallback(async () => {
    if (
      !window.confirm(
        "Revert all local dashboard fixes? Every item fixed in your draft will move back to the blocking list so you can redo them.",
      )
    ) {
      return;
    }
    await applyFix({ id: "undo_all", label: "Revert all", action: "undo_all" });
  }, [applyFix]);

  const handleFixOption = (option: LovelaceFixOption) => {
    void applyFix(option);
  };

  const applyEntityChoice = useCallback(async () => {
    if (!selected || !selectedChoice) return;

    if (selectedChoice.entityId === selected.entityId) {
      pushToast("Dashboard already uses this entity id.", "warn");
      return;
    }

    await applyFix(
      {
        id: "entity-choice",
        label: "Rename",
        action: "rename",
        replacementEntityId: selectedChoice.entityId,
      },
      selectedChoice.entityId,
    );
  }, [applyFix, pushToast, selected, selectedChoice]);

  const applyZ2mFix = useCallback(async (issue: Z2mStaleConfigIssue) => {
    setZ2mFixBusy(true);
    try {
      const result = await operationsApi.fixZ2mConfig({
        liveIeee: issue.liveIeee,
        expectedFriendlyName: issue.expectedFriendlyName,
        staleIpees: issue.staleEntries.map((entry) => entry.ieee),
      });
      if (!result.ok) {
        pushToast(result.message, "err");
        return;
      }
      pushToast(result.message, "ok");
      onFixed?.();
    } catch (e) {
      pushToast(toApiError(e).message, "err");
    } finally {
      setZ2mFixBusy(false);
    }
  }, [onFixed, pushToast]);

  if (!active) return null;

  if (busy && !data) {
    return (
      <div className="deploy-lovelace-gate deploy-lovelace-gate--loading">
        <p className="deploy-lovelace-gate-title">Entity deploy scan</p>
        <DeployLovelaceGateScanProgress progress={scanProgress} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="deploy-lovelace-gate deploy-lovelace-gate--warn">
        <GateTitle attentionOrder={attentionOrder}>Could not run entity deploy scan</GateTitle>
        <p className="muted">{error.message}</p>
        <button type="button" className="btn secondary btn-compact" onClick={() => void load()}>
          Retry check
        </button>
      </div>
    );
  }

  if (!data) return null;

  const noScanPending = data.issues.some(
    (i) =>
      i.includes("No Lovelace bundle or zigbee2mqtt changes") ||
      i.includes("No Lovelace bundle changes pending"),
  );
  if (noScanPending && z2mIssues.length === 0) return null;

  if (data.ok && deferredIssues.length === 0 && !data.pendingCommit && z2mIssues.length === 0) {
    return (
      <div className="deploy-lovelace-gate deploy-lovelace-gate--ok">
        <GateTitle attentionOrder={attentionOrder}>
          Entity deploy scan passed — {data.entityRefCount} entity reference
          {data.entityRefCount === 1 ? "" : "s"} verified on prod
        </GateTitle>
        <p className="deploy-lovelace-gate-lead muted">
          Prod has every entity the deploy dashboard expects. Deploy will not rename anything on prod.
        </p>
      </div>
    );
  }

  const resourceCount = data.missingCustomCards.length;
  const showReview = true;
  const showZ2m = z2mIssues.length > 0;
  const recheck = data.recheck;
  const showRevertAllFixes =
    deployMissingIssues.length > 0 || data.fixedLocallyCount > 0 || data.canUndoLovelaceFix;
  const showUndoMenu = data.canUndoLovelaceFix || showRevertAllFixes;
  const scanSummary = data.issues.find((issue) => issue.startsWith("Scan summary:"));
  const statusIssues = data.issues.filter((issue) => !issue.startsWith("Scan summary:"));
  const invalidJsonIssue = statusIssues.find(isJsonParseIssue);
  const publishPending =
    Boolean(data.pendingCommit && blockingIssues.length === 0 && !backgroundScanning);
  const gateLead = invalidJsonIssue
    ? `${invalidJsonIssue} Blocking vs awaiting counts use a text scan until JSON is repaired.`
    : publishPending
      ? `${data.fixedLocallyCount} fixed in your local dashboard draft. ${data.deployIssueCount} issue(s) still block deploy on the published bundle until you commit and push in the ship wizard below.`
      : blockingIssues.length > 0 && deployMissingIssues.length > 0
        ? `${blockingIssues.length} still need fixes in the draft · ${deployMissingIssues.length} already fixed locally and awaiting publish.`
        : blockingIssues.length > 0 || blockingZ2mIssues.length > 0
          ? "Select a blocker — fix steps and kit actions are in the detail panel."
          : blockingIssues.length === 0 && deferredIssues.length > 0
            ? "Deferred entities won't block deploy, but cards may error on prod until you fix or restore them."
            : "Compares the deploy dashboard with live prod. Deploy never renames prod entities automatically.";
  const showRecheckDelta =
    recheck &&
    (recheck.resolvedEntityIds.length > 0 || recheck.newEntityIds.length > 0) &&
    blockingIssues.length === 0 &&
    blockingZ2mIssues.length === 0 &&
    !backgroundScanning;
  const showDiagnostics =
    Boolean(scanError) ||
    statusIssues.length > 0 ||
    Boolean(scanSummary) ||
    showRecheckDelta;

  return (
    <div
      className={`deploy-lovelace-gate ${blockingIssues.length === 0 ? "deploy-lovelace-gate--warn" : "deploy-lovelace-gate--blocked"}${reviewStacked ? " deploy-lovelace-gate--stacked" : ""}`}
    >
      <div className="deploy-lovelace-gate-toolbar">
        <div className="deploy-lovelace-gate-toolbar-main">
          <p className="deploy-lovelace-gate-toolbar-title">
            <span>Entity deploy gate</span>
            <SectionAttentionBadge order={attentionOrder} />
          </p>
          <div className="deploy-lovelace-gate-toolbar-chips" aria-label="Issue counts">
            <span className="deploy-lovelace-gate-chip">{blockingIssues.length} blocking</span>
            <span className="deploy-lovelace-gate-chip">{deployMissingIssues.length} awaiting</span>
            <span className="deploy-lovelace-gate-chip">{deferredIssues.length} deferred</span>
          </div>
          <span
            className="deploy-lovelace-gate-scan-inline"
            aria-hidden={!backgroundScanning || busy}
            title={backgroundScanning && !busy ? "Updating scan" : undefined}
          >
            <span className={`deploy-lovelace-gate-scan-dot${backgroundScanning && !busy ? " is-active" : ""}`} />
          </span>
        </div>
        {showUndoMenu && (
          <details className="deploy-lovelace-gate-undo-menu">
            <summary className="btn secondary btn-compact">Undo</summary>
            <div className="deploy-lovelace-gate-undo-menu-panel">
              {data.canUndoLovelaceFix && (
                <button
                  type="button"
                  className="deploy-lovelace-gate-undo-menu-item"
                  disabled={fixBusy}
                  onClick={() => void undoLastFix()}
                  title={data.lovelaceUndoDescription ?? undefined}
                >
                  Undo last fix
                  {data.lovelaceUndoDescription ? (
                    <span className="muted"> ({data.lovelaceUndoDescription})</span>
                  ) : null}
                </button>
              )}
              {showRevertAllFixes && (
                <button
                  type="button"
                  className="deploy-lovelace-gate-undo-menu-item"
                  disabled={fixBusy}
                  onClick={() => void undoAllFixes()}
                >
                  Revert all local fixes
                </button>
              )}
            </div>
          </details>
        )}
      </div>
      <p
        className={`deploy-lovelace-gate-toolbar-lead${invalidJsonIssue ? " deploy-lovelace-gate-toolbar-lead--json-error" : " muted"}`}
        title={gateLead}
        role={invalidJsonIssue ? "alert" : undefined}
      >
        {invalidJsonIssue ? (
          <>
            <strong>{invalidJsonIssue}</strong>
            {" Blocking vs awaiting counts use a text scan until JSON is repaired."}
          </>
        ) : (
          gateLead
        )}
      </p>

      <div className="deploy-lovelace-gate-workspace">
        {busy && (
          <DeployLovelaceGateScanProgress
            progress={scanProgress}
            fallbackLabel="Rechecking entity deploy scan…"
            overlay
          />
        )}
        {showReview && (
          <div className="deploy-lovelace-gate-review deploy-lovelace-gate-review--workspace">
            <div className="deploy-lovelace-gate-lists-column">
              <div className="deploy-lovelace-gate-list-tabs" role="tablist" aria-label="Entity issue lists">
                <button
                  type="button"
                  role="tab"
                  aria-selected={listTab === "blocking"}
                  className={`deploy-lovelace-gate-list-tab${listTab === "blocking" ? " active" : ""}`}
                  onClick={() => setListTab("blocking")}
                >
                  Blocking ({blockingIssues.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={listTab === "awaiting"}
                  className={`deploy-lovelace-gate-list-tab${listTab === "awaiting" ? " active" : ""}`}
                  onClick={() => setListTab("awaiting")}
                >
                  Awaiting ({deployMissingIssues.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={listTab === "deferred"}
                  className={`deploy-lovelace-gate-list-tab${listTab === "deferred" ? " active" : ""}`}
                  onClick={() => setListTab("deferred")}
                >
                  Deferred ({deferredIssues.length})
                </button>
              </div>
              <div className="deploy-lovelace-gate-lists" ref={listsRef}>
                {listTab === "awaiting" && deployMissingIssues.length > 0 && (
                  <p className="muted deploy-lovelace-gate-tab-hint">
                    Fixed in your local draft — commit and push in the ship wizard to clear on deploy.
                  </p>
                )}
                {listTab === "deferred" && deferredIssues.length > 0 && (
                  <p className="muted deploy-lovelace-gate-tab-hint">
                    Won&apos;t block deploy — cards may show errors on prod until you fix or restore them.
                  </p>
                )}
                {activeListIssues.length > 0 ? (
                  <ul className="deploy-lovelace-gate-issue-list">
                    {activeListIssues.map((issue) => (
                      <li key={issue.entityId}>
                        <button
                          type="button"
                          className={`deploy-lovelace-gate-issue ${
                            listTab === "awaiting" ? "deploy-lovelace-gate-issue--publish-pending " : ""
                          }${listTab === "deferred" ? "deploy-lovelace-gate-issue--deferred " : ""}${
                            selected?.entityId === issue.entityId ? "active" : ""
                          }`}
                          onClick={() => setSelectedId(issue.entityId)}
                        >
                          <code>{issue.entityId}</code>
                          <span
                            className={`deploy-lovelace-gate-kind deploy-lovelace-gate-kind--${
                              listTab === "awaiting"
                                ? "git_wrong_name"
                                : listTab === "deferred"
                                  ? "deferred"
                                  : issue.issueClass
                            }`}
                          >
                            {listTab === "awaiting"
                              ? awaitingFixLabel(issue.awaitingPublishAction)
                              : listTab === "deferred"
                                ? kindLabel("deferred")
                                : kindLabel(issue.suggestionKind, issue.issueClass)}
                          </span>
                          <span className="deploy-lovelace-gate-issue-meta muted">
                            {issue.references.length} use{issue.references.length === 1 ? "" : "s"}
                            {listTab === "blocking" && issue.onStaging ? " · on staging" : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted deploy-lovelace-gate-section-empty">
                    {listTab === "blocking"
                      ? "No blockers — check Awaiting or Deferred tabs if needed."
                      : "None"}
                  </p>
                )}
              </div>
            </div>

            <div className="deploy-lovelace-gate-detail-column">
              {selected ? (
                <div className="deploy-lovelace-gate-detail">
                  <div className="deploy-lovelace-gate-detail-scroll">
                    <LovelaceIssueDetailBody
                      issue={selected}
                      isDeferred={selectedIsDeferred}
                      measure={selectedAwaitsPublish}
                      awaitingPublishAction={selected.awaitingPublishAction}
                      allowProdRegistryPurge={data.allowProdRegistryPurge}
                      confirmPurgeDeleted={confirmPurgeDeleted}
                      setConfirmPurgeDeleted={setConfirmPurgeDeleted}
                      selectedChoiceId={selectedChoiceId}
                      setSelectedChoiceId={setSelectedChoiceId}
                      selectedChoice={selectedChoice}
                      fixBusy={fixBusy}
                      onApplyEntityChoice={() => void applyEntityChoice()}
                      onFixOption={handleFixOption}
                      onPurgeDone={() => {
                        setConfirmPurgeDeleted(false);
                        onFixed?.();
                      }}
                      onPurgeFailure={() => setConfirmPurgeDeleted(false)}
                      onProdSuffixFixDone={() => {
                        onFixed?.();
                        void load(undefined, "foreground");
                      }}
                      onProdSuffixFixFailure={() => undefined}
                    />
                  </div>
                </div>
              ) : (
                <p className="muted deploy-lovelace-gate-detail-placeholder">Select a blocker from the list.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {showDiagnostics && (
        <details className="deploy-lovelace-gate-diagnostics muted">
          <summary>Scan diagnostics</summary>
          <div className="deploy-lovelace-gate-diagnostics-body">
            {scanError && (
              <p className="deploy-lovelace-gate-scan-error" role="alert">
                Background scan failed — showing last known results. {scanError}
              </p>
            )}
            {statusIssues.length > 0 && (
              <ul className="deploy-lovelace-gate-status-issues">
                {statusIssues.map((issue) => (
                  <li
                    key={issue}
                    className={isJsonParseIssue(issue) ? "deploy-lovelace-gate-json-error" : undefined}
                  >
                    {isJsonParseIssue(issue) ? <strong>{issue}</strong> : issue}
                  </li>
                ))}
              </ul>
            )}
            {scanSummary && <p>{scanSummary}</p>}
            {showRecheckDelta && (
              <div className="deploy-lovelace-gate-recheck-delta">
                {recheck!.resolvedEntityIds.length > 0 && (
                  <p className="deploy-lovelace-gate-recheck-ok">
                    Resolved since last scan:{" "}
                    {recheck!.resolvedEntityIds.map((id) => (
                      <code key={id}>{id}</code>
                    ))}
                  </p>
                )}
                {recheck!.newEntityIds.length > 0 && (
                  <p className="deploy-lovelace-gate-recheck-new">
                    New blockers:{" "}
                    {recheck!.newEntityIds.map((id) => (
                      <code key={id}>{id}</code>
                    ))}
                  </p>
                )}
              </div>
            )}
          </div>
        </details>
      )}

      {showZ2m && (
        <div className="deploy-lovelace-gate-section deploy-lovelace-gate-z2m">
          <h4>
            Zigbee2MQTT config ({z2mIssues.length}
            {blockingZ2mIssues.length > 0 ? ` · ${blockingZ2mIssues.length} blocking` : ""})
          </h4>
          <p className="muted deploy-lovelace-gate-lead">
            Stale device blocks in prod Z2M config can reserve friendly names and block renames in the Z2M UI.
            Fix in git, deploy, then restart the Zigbee2MQTT add-on on prod.
          </p>
          <ul className="deploy-lovelace-gate-issue-list">
            {z2mIssues.map((issue) => (
              <li key={`${issue.liveIeee}-${issue.expectedFriendlyName}`}>
                <button
                  type="button"
                  className={`deploy-lovelace-gate-issue ${selectedZ2m?.liveIeee === issue.liveIeee ? "active" : ""}`}
                  onClick={() => setSelectedZ2mIeee(issue.liveIeee)}
                >
                  <code>{issue.liveIeee}</code>
                  <span
                    className={`deploy-lovelace-gate-kind deploy-lovelace-gate-kind--${issue.blocksDeploy ? "missing_on_prod" : "git_wrong_name"}`}
                  >
                    {issue.blocksDeploy ? "Fix on prod" : "Fix in git"}
                  </span>
                  <span className="deploy-lovelace-gate-issue-meta muted">
                    {issue.liveFriendlyName} → {issue.expectedFriendlyName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selectedZ2m && (
            <div className="deploy-lovelace-gate-detail deploy-lovelace-gate-z2m-detail">
              <p className="deploy-lovelace-gate-suggestion">{selectedZ2m.summary}</p>
              {selectedZ2m.staleEntries.length > 0 && (
                <ul className="deploy-lovelace-gate-ref-list">
                  {selectedZ2m.staleEntries.map((entry) => (
                    <li key={entry.ieee}>
                      Stale config: <code>{entry.ieee}</code> · {entry.friendlyName}
                    </li>
                  ))}
                </ul>
              )}
              {selectedZ2m.fixOptions.length > 0 && (
                <div className="deploy-lovelace-gate-action-buttons">
                  <button
                    type="button"
                    className="btn primary btn-compact"
                    disabled={z2mFixBusy}
                    onClick={() => void applyZ2mFix(selectedZ2m)}
                  >
                    Fix in git (Z2M config)
                  </button>
                </div>
              )}
              {z2mFixBusy && <p className="muted deploy-lovelace-gate-fix-busy">Applying git fix…</p>}
            </div>
          )}
        </div>
      )}

      {resourceCount > 0 && (
        <div className="deploy-lovelace-gate-section">
          <h4>Lovelace resources missing on prod ({resourceCount})</h4>
          <ul className="deploy-lovelace-gate-entities">
            {data.missingCustomCards.map((url) => (
              <li key={url}>
                <code>{url}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="deploy-lovelace-gate-fix">
        <div className="deploy-lovelace-gate-reset">
          <p className="deploy-lovelace-gate-reset-title">Reset workbench</p>
          <p className="muted deploy-lovelace-gate-reset-lead">
            Discards unsaved dashboard edits and kit defer/undo state, re-applies the published staging bundle to
            staging HA, and re-syncs prod registries/helpers to staging. Does not change prod or remove dashboard
            entity references that still block deploy.
          </p>
          {!confirmReset ? (
            <button type="button" className="btn secondary btn-compact" onClick={() => setConfirmReset(true)}>
              Reset workbench…
            </button>
          ) : (
            <div className="confirm-box deploy-lovelace-gate-reset-confirm">
              <p className="msg err">
                Resets the dashboard draft to the last published staging version (unsaved local edits are lost),
                clears entity-scan defer/undo, re-applies staging from the repo, and copies prod registries to
                staging. Prod is not touched.
              </p>
              <div className="deploy-lovelace-gate-action-buttons">
                <ActionButton
                  label="Yes, reset workbench"
                  toastPreset="reset-workbench"
                  variant="danger"
                  onRun={operationsApi.resetWorkbench}
                  onDone={() => {
                    setConfirmReset(false);
                    onFixed?.();
                    void load(undefined, "foreground");
                  }}
                  onFailure={() => setConfirmReset(false)}
                />
                <button type="button" className="btn secondary btn-compact" onClick={() => setConfirmReset(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
