import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  operationsApi,
  toApiError,
  type ApiError,
  type LovelaceFixOption,
  type ProdStoragePreflightResult,
  type Z2mStaleConfigIssue,
} from "../../api";
import { SectionAttentionBadge } from "../PageAttentionPanel";
import { useToast } from "../Toast";
import { useNavAttentionContext } from "../../context/NavAttentionContext";
import { isPreflightCacheFresh } from "../../hooks/useNavAttention";
import { useReleaseSafety } from "../../context/ReleaseSafetyContext";
import { LovelaceIssueDetailBody } from "./LovelaceIssueDetailBody";
import { ProdNamingIssueDetailBody, prodNamingIssueKey, prodNamingKindLabel } from "./ProdNamingIssueDetailBody";
import { DeployLovelaceGateScanProgress } from "./DeployLovelaceGateScanProgress";
import { usePreflightScanProgress } from "../../hooks/usePreflightScanProgress";
import { useStableMinHeight } from "../../hooks/useStableMinHeight";

/** Minimum ms between focus-triggered entity deploy rescans. */
const DEPLOY_GATE_FOCUS_RECHECK_MS = 90_000;
/** Coalesce kit-fix rescans so rapid fixes trigger one background scan. */
const DEPLOY_GATE_RESCAN_DEBOUNCE_MS = 1_500;

type LoadMode = "foreground" | "background";
type ListTab = "blocking" | "awaiting" | "deferred" | "naming";

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

import { gateStatusFromPreflight, type LovelaceGateStatus } from "../../lib/entityDeployGate";

export type { LovelaceGateStatus };

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
  layout = "inline",
}: {
  active: boolean;
  refreshKey: number;
  onStatusChange?: (status: LovelaceGateStatus) => void;
  onFixed?: () => void;
  attentionOrder?: number;
  /** inline = Overview embed; workspace = full-width Operations page */
  layout?: "inline" | "workspace";
}) {
  const { publishPreflight, runPreflight, invalidatePreflight, preflightBusy, preflightScannedAt } =
    useNavAttentionContext();
  const { prodWritesEnabled, lockMessage } = useReleaseSafety();
  const { push: pushToast } = useToast();
  const [data, setData] = useState<ProdStoragePreflightResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [backgroundScanning, setBackgroundScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [fixBusy, setFixBusy] = useState(false);
  const [z2mFixBusy, setZ2mFixBusy] = useState(false);
  const [selectedZ2mIeee, setSelectedZ2mIeee] = useState<string | null>(null);
  const [selectedNamingKey, setSelectedNamingKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
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
  const scanProgress = usePreflightScanProgress(busy || preflightBusy);
  const panelStable = useStableMinHeight("deploy-gate-inline-panel", layout === "inline");
  const isScanning = busy || preflightBusy;

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
  const prodNamingIssues = data?.prodNamingIssues ?? [];
  const sortedNamingIssues = useMemo(
    () => [...prodNamingIssues].sort((a, b) => a.primaryEntityId.localeCompare(b.primaryEntityId)),
    [prodNamingIssues],
  );
  const lovelaceListIssues =
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
  const selectedNaming = useMemo(
    () =>
      prodNamingIssues.find((issue) => prodNamingIssueKey(issue) === selectedNamingKey) ??
      sortedNamingIssues[0] ??
      null,
    [selectedNamingKey, prodNamingIssues, sortedNamingIssues],
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

  const gateStatusFromResult = useCallback(
    (result: ProdStoragePreflightResult): LovelaceGateStatus => gateStatusFromPreflight(result),
    [],
  );

  const load = useCallback(async (preferSelectId?: string | null, mode: LoadMode = "foreground", force = false) => {
    if (!active) {
      setData(null);
      setError(null);
      setSelectedId(null);
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
    const willScan = force || background || !isPreflightCacheFresh(preflightScannedAt);
    if (!background) {
      pendingFixedIdsRef.current.clear();
      pendingDeferredIdsRef.current.clear();
      intendedSelectIdRef.current = null;
    }
    if (background) {
      setBackgroundScanning(true);
    } else if (willScan) {
      setScanError(null);
      setBusy(true);
      report({ active: true, busy: true, ok: null, missingEntityCount: 0 });
    } else {
      setScanError(null);
      setError(null);
    }
    try {
      const result = await runPreflight({ force: force || background });
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
      if (merged.prodNamingIssues.length > 0) {
        setSelectedNamingKey((current) =>
          current && merged.prodNamingIssues.some((issue) => prodNamingIssueKey(issue) === current)
            ? current
            : prodNamingIssueKey(merged.prodNamingIssues[0]!),
        );
      } else {
        setSelectedNamingKey(null);
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
        invalidatePreflight();
        setSelectedId(null);
      }
      report({ active: true, busy: false, ok: false, missingEntityCount: 0 });
    } finally {
      if (background) setBackgroundScanning(false);
      else setBusy(false);
    }
  }, [active, gateStatusFromResult, invalidatePreflight, preflightScannedAt, publishPreflight, report, runPreflight]);

  useEffect(() => {
    if (!active) {
      initialLoadRef.current = false;
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
  }, [selectedId, selectedNamingKey, listTab, lovelaceListIssues.length, sortedNamingIssues.length]);

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

  const scanPassedNoDiff =
    data &&
    data.issues.some(
      (i) =>
        i.includes("No Lovelace or Zigbee2MQTT bundle changes pending") ||
        i.includes("full scan below is for cleanup"),
    ) &&
    blockingIssues.length === 0 &&
    deployMissingIssues.length === 0 &&
    deferredIssues.length === 0 &&
    z2mIssues.length === 0 &&
    prodNamingIssues.length === 0 &&
    data.ok;

  const scanPassedClean =
    data &&
    data.ok &&
    deferredIssues.length === 0 &&
    !data.pendingCommit &&
    z2mIssues.length === 0 &&
    prodNamingIssues.length === 0;

  const workspaceScanPassed = layout === "workspace" && Boolean(scanPassedNoDiff || scanPassedClean);
  const showNamingTabUi = prodNamingIssues.length > 0 || layout === "workspace";

  if (scanPassedNoDiff && layout !== "workspace") {
    return (
      <div className="deploy-lovelace-gate deploy-lovelace-gate--ok">
        <GateTitle attentionOrder={attentionOrder}>Entity Janitor scan passed</GateTitle>
        <p className="deploy-lovelace-gate-lead muted">
          No pending Lovelace/Z2M release diff on GitHub main. Prod has every entity the git dashboard expects (
          {data.entityRefCount} reference{data.entityRefCount === 1 ? "" : "s"}).
        </p>
      </div>
    );
  }

  if (scanPassedClean && layout !== "workspace") {
    return (
      <div className="deploy-lovelace-gate deploy-lovelace-gate--ok">
        <GateTitle attentionOrder={attentionOrder}>
          Entity Janitor scan passed — {data.entityRefCount} entity reference
          {data.entityRefCount === 1 ? "" : "s"} verified on prod
        </GateTitle>
        <p className="deploy-lovelace-gate-lead muted">
          Prod has every entity the deploy dashboard expects. Deploy will not rename anything on prod.
        </p>
      </div>
    );
  }

  const resourceCount = data?.missingCustomCards.length ?? 0;
  const showReview = true;
  const showZ2m = z2mIssues.length > 0;
  const showNamingTab = prodNamingIssues.length > 0;
  const recheck = data?.recheck;
  const showRevertAllFixes =
    deployMissingIssues.length > 0 || (data?.fixedLocallyCount ?? 0) > 0 || Boolean(data?.canUndoLovelaceFix);
  const showUndoMenu = Boolean(data?.canUndoLovelaceFix) || showRevertAllFixes;
  const scanSummary = data?.issues.find((issue) => issue.startsWith("Scan summary:"));
  const statusIssues =
    data?.issues.filter(
      (issue) =>
        !issue.startsWith("Scan summary:") &&
        !issue.includes("prod entity naming issue(s)"),
    ) ?? [];
  const invalidJsonIssue = statusIssues.find(isJsonParseIssue);
  const publishPending =
    Boolean(data?.pendingCommit && blockingIssues.length === 0 && !backgroundScanning);
  const gateLead = error && !data
    ? `${error.message} — retry the scan when the kit API is ready.`
    : !data
      ? busy || preflightBusy
        ? "Running Entity Janitor scan against prod…"
        : "Waiting for scan results…"
      : workspaceScanPassed
        ? scanPassedNoDiff
          ? `No pending Lovelace/Z2M release diff on GitHub main. Prod has every entity the git dashboard expects (${data!.entityRefCount} reference${data!.entityRefCount === 1 ? "" : "s"}).`
          : `Entity Janitor scan passed — ${data!.entityRefCount} entity reference${data!.entityRefCount === 1 ? "" : "s"} verified on prod.`
        : invalidJsonIssue
          ? `${invalidJsonIssue} Blocking vs awaiting counts use a text scan until JSON is repaired.`
          : publishPending
            ? `${data.fixedLocallyCount} fixed in your local dashboard draft. ${data.deployIssueCount} issue(s) still block deploy on the published bundle until you commit and push in the ship wizard below.`
            : blockingIssues.length > 0 && deployMissingIssues.length > 0
              ? `${blockingIssues.length} still need fixes in the draft · ${deployMissingIssues.length} already fixed locally and awaiting publish.`
              : blockingIssues.length > 0 || blockingZ2mIssues.length > 0
                ? "Select a blocker — fix steps and kit actions are in the detail panel."
                : blockingIssues.length === 0 && deferredIssues.length > 0
                  ? "Deferred entities won't block deploy, but cards may error on prod until you fix or restore them."
                  : showNamingTab
                    ? "Blocking tab covers deploy. Naming tab lists prod `_2` / cast suffix cleanups — select one for fix steps."
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
      ref={layout === "inline" ? panelStable.ref : undefined}
      style={layout === "inline" ? panelStable.style : undefined}
      className={`deploy-lovelace-gate ${
        workspaceScanPassed || (data?.ok && blockingIssues.length === 0 && blockingZ2mIssues.length === 0)
          ? "deploy-lovelace-gate--ok"
          : blockingIssues.length === 0
            ? "deploy-lovelace-gate--warn"
            : "deploy-lovelace-gate--blocked"
      }${reviewStacked ? " deploy-lovelace-gate--stacked" : ""}${layout === "workspace" ? " deploy-lovelace-gate--workspace-layout" : ""}${isScanning ? " deploy-lovelace-gate--scanning" : ""}`}
    >
      <div className="deploy-lovelace-gate-toolbar">
        <div className="deploy-lovelace-gate-toolbar-main">
          <p className="deploy-lovelace-gate-toolbar-title">
            <span>Entity Janitor</span>
            <SectionAttentionBadge order={attentionOrder} />
          </p>
          <div className="deploy-lovelace-gate-toolbar-chips" aria-label="Issue counts">
            <span className="deploy-lovelace-gate-chip">{blockingIssues.length} blocking</span>
            <span className="deploy-lovelace-gate-chip">{deployMissingIssues.length} awaiting</span>
            <span className="deploy-lovelace-gate-chip">{deferredIssues.length} deferred</span>
            {showNamingTabUi && (
              <span className="deploy-lovelace-gate-chip">{prodNamingIssues.length} naming</span>
            )}
          </div>
          <span
            className="deploy-lovelace-gate-scan-inline"
            aria-hidden={!backgroundScanning || busy}
            title={backgroundScanning && !busy ? "Updating scan" : undefined}
          >
            <span className={`deploy-lovelace-gate-scan-dot${backgroundScanning && !busy ? " is-active" : ""}`} />
          </span>
        </div>
        <div className="deploy-lovelace-gate-undo-reserve">
          {showUndoMenu ? (
            <details className="deploy-lovelace-gate-undo-menu">
              <summary className="btn secondary btn-compact">Undo</summary>
              <div className="deploy-lovelace-gate-undo-menu-panel">
                {data?.canUndoLovelaceFix && (
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
          ) : layout === "workspace" ? (
            <span className="deploy-lovelace-gate-undo-placeholder" aria-hidden="true" />
          ) : null}
        </div>
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
        {(busy || preflightBusy) && (
          <DeployLovelaceGateScanProgress
            progress={scanProgress}
            fallbackLabel={data ? "Rechecking Entity Janitor scan…" : "Running Entity Janitor scan…"}
            overlay
          />
        )}
        {showReview && (
          <div
            className="deploy-lovelace-gate-review deploy-lovelace-gate-review--workspace"
            aria-hidden={isScanning ? true : undefined}
          >
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
                {showNamingTabUi && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={listTab === "naming"}
                    className={`deploy-lovelace-gate-list-tab${listTab === "naming" ? " active" : ""}`}
                    onClick={() => setListTab("naming")}
                  >
                    Naming ({prodNamingIssues.length})
                  </button>
                )}
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
                {listTab === "naming" && prodNamingIssues.length > 0 && (
                  <p className="muted deploy-lovelace-gate-tab-hint">
                    Prod registry cleanups — numeric <code>_2</code> suffixes and cast entities that should use{" "}
                    <code>_cast</code>. Won&apos;t block deploy; select one for fix steps.
                  </p>
                )}
                {listTab === "naming" ? (
                  sortedNamingIssues.length > 0 ? (
                    <ul className="deploy-lovelace-gate-issue-list">
                      {sortedNamingIssues.map((issue) => {
                        const key = prodNamingIssueKey(issue);
                        return (
                          <li key={key}>
                            <button
                              type="button"
                              className={`deploy-lovelace-gate-issue ${
                                selectedNaming && prodNamingIssueKey(selectedNaming) === key ? "active" : ""
                              }`}
                              onClick={() => setSelectedNamingKey(key)}
                            >
                              <code>{issue.primaryEntityId}</code>
                              <span className="deploy-lovelace-gate-kind deploy-lovelace-gate-kind--prod_typo">
                                {issue.kind === "suffix_collision" ? "Suffix _2" : "Use _cast"}
                              </span>
                              <span className="deploy-lovelace-gate-issue-meta muted">
                                {issue.expectedEntityId &&
                                issue.wrongEntityId &&
                                issue.expectedEntityId !== issue.primaryEntityId
                                  ? `${issue.wrongEntityId} → ${issue.expectedEntityId}`
                                  : issue.deviceName ?? issue.livePlatform ?? prodNamingKindLabel(issue.kind)}
                                {issue.gitReferences.length > 0
                                  ? ` · ${issue.gitReferences.length} git ref(s)`
                                  : ""}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="muted deploy-lovelace-gate-section-empty">None</p>
                  )
                ) : lovelaceListIssues.length > 0 ? (
                  <ul className="deploy-lovelace-gate-issue-list">
                    {lovelaceListIssues.map((issue) => (
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
                      ? "No blockers — check Awaiting, Deferred, or Naming tabs if needed."
                      : "None"}
                  </p>
                )}
              </div>
            </div>

            <div className="deploy-lovelace-gate-detail-column">
              {listTab === "naming" && selectedNaming ? (
                <div className="deploy-lovelace-gate-detail">
                  <div className="deploy-lovelace-gate-detail-scroll">
                    <ProdNamingIssueDetailBody
                      issue={selectedNaming}
                      fixBusy={fixBusy}
                      allowProdFix={prodWritesEnabled}
                      prodWritesLockMessage={lockMessage}
                      onProdFixDone={() => {
                        onFixed?.();
                        void load(undefined, "background");
                      }}
                      onProdFixFailure={() => undefined}
                      onExportDone={() => void load(undefined, "background")}
                    />
                  </div>
                </div>
              ) : listTab !== "naming" && selected ? (
                <div className="deploy-lovelace-gate-detail">
                  <div className="deploy-lovelace-gate-detail-scroll">
                    <LovelaceIssueDetailBody
                      issue={selected}
                      isDeferred={selectedIsDeferred}
                      measure={selectedAwaitsPublish}
                      awaitingPublishAction={selected.awaitingPublishAction}
                      allowProdRegistryPurge={Boolean(data?.allowProdRegistryPurge && prodWritesEnabled)}
                      allowProdFix={prodWritesEnabled}
                      prodWritesLockMessage={lockMessage}
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
                      onExportDone={() => void load(undefined, "background")}
                    />
                  </div>
                </div>
              ) : (
                <p className="muted deploy-lovelace-gate-detail-placeholder">
                  {listTab === "naming"
                    ? "Select a prod naming issue from the list."
                    : "Select an issue from the list."}
                </p>
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
            {(data?.missingCustomCards ?? []).map((url) => (
              <li key={url}>
                <code>{url}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

    </div>
  );
}
