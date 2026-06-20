import type {
  ComponentIssue,
  DashboardStatus,
  OnboardingStatus,
  ProdStoragePreflightResult,
} from "../api";
import { deployProdBlockMessage, getDeployProdState, prodLovelaceBundlePending, stagingProdPathPending } from "./gitWorkflow";
import { isMirrorControlMode } from "./mirrorMode";

export type NavAttentionPath =
  | "/"
  | "/environment"
  | "/diagnostics"
  | "/operations"
  | "/settings"
  | "/onboarding";

export type NavAttentionItem = {
  id: string;
  path: NavAttentionPath;
  label: string;
  detail?: string;
  severity: "warn" | "error";
  /** Same-page element id (without #) */
  anchor?: string;
  /** Operations sidebar section id */
  opsSection?: OpsSection;
  /** Operations button / action id */
  opsAction?: OpsAttentionAction;
  /** Diagnostics tab id */
  diagTab?: "signals" | "ops" | "sync" | "person-poll" | "mqtt" | "ha";
  /** Settings sidebar section id */
  settingsSection?: "paths" | "production" | "staging" | "mirror" | "intervals" | "advanced";
  /** Overview workflow slot — used to assign ordered badges on the live page */
  overviewSlot?: OverviewAttentionSlot;
};

export type OverviewAttentionSlot =
  | "ha-errors"
  | "parity"
  | "deploy-commit"
  | "deploy-push"
  | "deploy-gate"
  | "deploy-impact"
  | "deploy-prod";

const OVERVIEW_SLOT_ORDER: OverviewAttentionSlot[] = [
  "ha-errors",
  "deploy-gate",
  "deploy-impact",
  "parity",
  "deploy-commit",
  "deploy-push",
  "deploy-prod",
];

export type OpsSection =
  | "baseline"
  | "entity-deploy"
  | "config-sync"
  | "storage-sync"
  | "mqtt-mirror"
  | "staging-ha";

export type OpsAttentionAction =
  | "apply-config"
  | "person-poll"
  | "storage-sync"
  | "deploy-mirror"
  | "restart-staging";


const OPS_ACTION_ORDER: Record<OpsSection, OpsAttentionAction[]> = {
  baseline: [],
  "entity-deploy": [],
  "config-sync": ["apply-config", "person-poll"],
  "storage-sync": ["storage-sync", "restart-staging"],
  "mqtt-mirror": ["deploy-mirror"],
  "staging-ha": ["restart-staging"],
};

function suggestedOpsAction(preset?: string | null): OpsAttentionAction | null {
  if (!preset) return null;
  if (preset.includes("storage")) return "storage-sync";
  if (preset === "apply-config") return "apply-config";
  if (preset === "person-poll") return "person-poll";
  if (preset.includes("mirror") || preset === "refresh-mirror" || preset === "deploy-mirror") return "deploy-mirror";
  return null;
}

function suggestedOpsSection(preset?: string | null): OpsSection {
  const action = suggestedOpsAction(preset);
  if (action === "storage-sync" || action === "restart-staging") return "storage-sync";
  if (action === "deploy-mirror") return "mqtt-mirror";
  return "config-sync";
}

function opsItemExists(
  items: NavAttentionItem[],
  section: OpsSection,
  action: OpsAttentionAction,
): boolean {
  return items.some((item) => item.path === "/operations" && item.opsSection === section && item.opsAction === action);
}

export type NavAttentionCounts = Record<NavAttentionPath, number>;

const PATHS: NavAttentionPath[] = [
  "/",
  "/environment",
  "/diagnostics",
  "/operations",
  "/settings",
  "/onboarding",
];

function emptyCounts(): NavAttentionCounts {
  return {
    "/": 0,
    "/environment": 0,
    "/diagnostics": 0,
    "/operations": 0,
    "/settings": 0,
    "/onboarding": 0,
  };
}

function push(items: NavAttentionItem[], item: NavAttentionItem) {
  if (items.some((x) => x.id === item.id)) return;
  items.push(item);
}

function buildHaIssueItems(issues: ComponentIssue[]): NavAttentionItem[] {
  return issues.map((issue, i) => ({
    id: `ha-issue-${i}-${issue.source}-${issue.message.slice(0, 24)}`,
    path: "/" as const,
    label: issue.message,
    detail: issue.source,
    severity: issue.level,
    anchor: "overview-ha-errors",
    overviewSlot: "ha-errors" as const,
    diagTab: "ha" as const,
  }));
}

function buildHaDiagnosticsItems(issues: ComponentIssue[]): NavAttentionItem[] {
  return issues.map((issue, i) => ({
    id: `diag-ha-${i}-${issue.source}`,
    path: "/diagnostics" as const,
    label: issue.message,
    detail: issue.source,
    severity: issue.level,
    diagTab: "ha" as const,
    anchor: "diag-ha-logs",
  }));
}

function buildLogSignalItems(issues: ComponentIssue[]): NavAttentionItem[] {
  return issues.map((issue, i) => {
    const isPersonPoll = issue.source.toLowerCase().includes("person poll");
    return {
      id: `diag-signal-${i}-${issue.source}`,
      path: "/diagnostics" as const,
      label: issue.message,
      detail: issue.source,
      severity: issue.level,
      diagTab: (isPersonPoll ? "person-poll" : "signals") as NavAttentionItem["diagTab"],
      anchor: isPersonPoll ? undefined : "diag-insights",
    };
  });
}

function buildDeployItems(
  dashboard: DashboardStatus,
  preflight: ProdStoragePreflightResult | null,
): NavAttentionItem[] {
  const items: NavAttentionItem[] = [];
  const git = dashboard.git;
  if (!git?.configured) return items;

  const deploy = getDeployProdState(git, dashboard.configDrift);
  const blockMsg = deployProdBlockMessage(deploy);

  if (blockMsg) {
    push(items, {
      id: "deploy-block",
      path: "/",
      label: blockMsg,
      severity: "warn",
      anchor: "deploy-flow-panel",
      overviewSlot:
        deploy.blockReason === "commit"
          ? "deploy-commit"
          : deploy.blockReason === "push"
            ? "deploy-push"
            : "deploy-prod",
    });
  }

  if (git.isDirty) {
    push(items, {
      id: "deploy-commit",
      path: "/",
      label:
        stagingProdPathPending(git)
          ? `${git.changedFileCount ?? 0} local file(s) not committed — commit before shipping HA`
          : `${git.changedFileCount ?? 0} local file(s) uncommitted`,
      severity: "warn",
      anchor: "deploy-flow-panel",
      overviewSlot: "deploy-commit",
    });
  }

  if ((git.commitsAhead ?? 0) > 0) {
    push(items, {
      id: "deploy-push",
      path: "/",
      label: `${git.commitsAhead} commit(s) not pushed to GitHub`,
      severity: "warn",
      anchor: "deploy-flow-panel",
      overviewSlot: "deploy-push",
    });
  }

  const lovelacePending = prodLovelaceBundlePending(git);
  const z2mPending = (git.mainHaFileList ?? []).some((path) =>
    path.replace(/\\/g, "/").toLowerCase().startsWith("zigbee2mqtt/"),
  );
  const gateRelevant = (lovelacePending || z2mPending) && deploy.pending;

  if (gateRelevant) {
    if (preflight?.pendingCommit) {
      push(items, {
        id: "deploy-pending-commit",
        path: "/",
        label: "Lovelace fixes committed locally — push to GitHub before prod deploy",
        severity: "warn",
        anchor: "deploy-flow-panel",
        overviewSlot: "deploy-push",
      });
    }
    if ((preflight?.deployIssueCount ?? 0) > 0) {
      push(items, {
        id: "deploy-entity-gate",
        path: "/",
        label: `${preflight!.deployIssueCount} entity blocker(s) — fix in Operations → Entity Janitor`,
        severity: "error",
        anchor: "ops-entity-deploy",
        overviewSlot: "deploy-gate",
        opsSection: "entity-deploy",
      });
    }
    for (const z of preflight?.z2mConfigIssues ?? []) {
      if (!z.blocksDeploy) continue;
      push(items, {
        id: `deploy-z2m-${z.liveIeee}`,
        path: "/",
        label: z.summary || "Zigbee2MQTT config issue blocks prod deploy",
        severity: "error",
        anchor: "ops-entity-deploy",
        overviewSlot: "deploy-gate",
        opsSection: "entity-deploy",
      });
    }
    if (!preflight || ((preflight.deployIssueCount ?? 0) === 0 && !preflight.pendingCommit)) {
      push(items, {
        id: "deploy-gate-scan",
        path: "/",
        label: "Entity Janitor scan required before release — open Operations → Entity Janitor",
        severity: "warn",
        anchor: "ops-entity-deploy",
        overviewSlot: "deploy-gate",
        opsSection: "entity-deploy",
      });
    }
  } else if (deploy.pending && !deploy.canDeploy && !blockMsg) {
    push(items, {
      id: "deploy-blocked",
      path: "/",
      label: "Prod deploy blocked — complete the ship wizard steps below",
      severity: "warn",
      anchor: "deploy-flow-panel",
      overviewSlot: "deploy-prod",
    });
  } else if (deploy.pending && deploy.canDeploy) {
    push(items, {
      id: "deploy-ready",
      path: "/",
      label: "Prod deploy pending — complete the ship wizard below",
      severity: "warn",
      anchor: "deploy-flow-panel",
      overviewSlot: "deploy-prod",
    });
  }

  return items;
}

function buildOverviewItems(
  dashboard: DashboardStatus,
  preflight: ProdStoragePreflightResult | null,
): NavAttentionItem[] {
  const items: NavAttentionItem[] = [...buildDeployItems(dashboard, preflight)];

  for (const issue of dashboard.stagingRepresentation?.issues ?? []) {
    if (issue.severity === "info") continue;
    push(items, {
      id: `parity-${issue.category}-${issue.title}`,
      path: "/",
      label: issue.title,
      detail: issue.detail,
      severity: issue.severity === "error" ? "error" : "warn",
      anchor: "staging-parity",
      overviewSlot: "parity",
    });
  }

  if (dashboard.mirror?.configured && isMirrorControlMode(dashboard.mirror.mode)) {
    push(items, {
      id: "mirror-control-mode",
      path: "/environment",
      label: "MQTT mirror is in control mode — staging can actuate prod",
      severity: "error",
      anchor: "mirror-control",
    });
  }

  for (const s of dashboard.subsystems) {
    if (s.status !== "fail") continue;
    push(items, {
      id: `subsystem-fail-${s.name}`,
      path: "/diagnostics",
      label: `${s.name}: ${s.detail}`,
      severity: "error",
      diagTab: "signals",
      anchor: "diag-subsystems",
    });
  }

  return items;
}

function buildEnvironmentItems(dashboard: DashboardStatus): NavAttentionItem[] {
  const items: NavAttentionItem[] = [];

  for (const r of dashboard.readiness) {
    if (r.ok) continue;
    push(items, {
      id: `readiness-${r.id}`,
      path: "/environment",
      label: r.label,
      detail: r.detail ?? undefined,
      severity: "warn",
      anchor: "env-readiness",
    });
  }

  // Git ↔ staging apply + uncommitted HA YAML — actionable on Overview (ship) / Operations (apply).
  // Only surface git sync issues here that Environment uniquely owns.
  if ((dashboard.git?.commitsBehind ?? 0) > 0) {
    push(items, {
      id: "git-behind",
      path: "/environment",
      label: `Git branch is ${dashboard.git?.commitsBehind} commit(s) behind remote`,
      severity: "warn",
      anchor: "env-git",
    });
  }

  if (dashboard.mirror?.configured && !dashboard.mirror.running) {
    push(items, {
      id: "mirror-stopped",
      path: "/environment",
      label: "MQTT mirror broker is not running",
      severity: "warn",
      anchor: "env-kit",
    });
  }

  if (dashboard.sidecar && !dashboard.sidecar.running) {
    push(items, {
      id: "sync-loop-stopped",
      path: "/environment",
      label: "Config sync loop is not running",
      severity: "error",
      anchor: "env-kit",
    });
  }

  return items;
}

function buildOperationsItems(
  dashboard: DashboardStatus,
  preflight: ProdStoragePreflightResult | null,
): NavAttentionItem[] {
  const items: NavAttentionItem[] = [];
  const git = dashboard.git;
  const deploy = getDeployProdState(git, dashboard.configDrift);
  const lovelacePending = prodLovelaceBundlePending(git);
  const z2mPending = (git?.mainHaFileList ?? []).some((path) =>
    path.replace(/\\/g, "/").toLowerCase().startsWith("zigbee2mqtt/"),
  );
  const gateRelevant = (lovelacePending || z2mPending) && deploy.pending;

  if (gateRelevant) {
    if ((preflight?.deployIssueCount ?? 0) > 0) {
      push(items, {
        id: "ops-entity-gate-blockers",
        path: "/operations",
        label: `${preflight!.deployIssueCount} entity blocker(s)`,
        severity: "error",
        anchor: "ops-entity-deploy",
        opsSection: "entity-deploy",
      });
    } else if (!preflight || preflight.deployIssueCount === 0) {
      push(items, {
        id: "ops-entity-gate-scan",
        path: "/operations",
        label: "Entity Janitor scan required before release",
        severity: "warn",
        anchor: "ops-entity-deploy",
        opsSection: "entity-deploy",
      });
    }
  }

  const lastPoll = dashboard.pollHistory?.[dashboard.pollHistory.length - 1];
  if (lastPoll && !lastPoll.ok) {
    push(items, {
      id: "person-poll-failed",
      path: "/diagnostics",
      label: "Person poll is failing — check staging write token in Settings",
      severity: "warn",
      diagTab: "person-poll",
      opsSection: "config-sync",
      opsAction: "person-poll",
    });
  }

  if (dashboard.configDrift?.applyGapHasHaChanges) {
    push(items, {
      id: "ops-apply-config",
      path: "/operations",
      label: `${dashboard.configDrift.applyGapHaFileCount ?? 0} HA file(s) not applied to staging`,
      detail: dashboard.configDrift.detail,
      severity: "warn",
      opsSection: "config-sync",
      opsAction: "apply-config",
    });
  }

  const storageNeverSynced =
    dashboard.mirror?.configured &&
    !dashboard.syncActivity?.lastStorageSyncAt &&
    dashboard.onboardingComplete;

  if (storageNeverSynced) {
    push(items, {
      id: "storage-never-synced",
      path: "/operations",
      label: "No storage sync logged yet — run Storage sync if staging registry is stale",
      severity: "warn",
      opsSection: "storage-sync",
      opsAction: "storage-sync",
    });
    push(items, {
      id: "storage-sync-restart",
      path: "/operations",
      label: "Restart staging HA after storage sync so MQTT entities reload",
      severity: "warn",
      opsSection: "storage-sync",
      opsAction: "restart-staging",
    });
  }

  if (dashboard.mirror?.configured && !dashboard.mirror.running) {
    push(items, {
      id: "mirror-stopped",
      path: "/operations",
      label: "MQTT mirror broker is not running",
      severity: "warn",
      opsSection: "mqtt-mirror",
      opsAction: "deploy-mirror",
    });
  }

  const action = dashboard.suggestedAction;
  const suggestedAction = suggestedOpsAction(action?.actionPreset);
  const suggestedSection = suggestedOpsSection(action?.actionPreset);
  if (
    action &&
    suggestedAction &&
    (action.link.startsWith("/operations") || action.actionPreset?.includes("storage")) &&
    !opsItemExists(items, suggestedSection, suggestedAction)
  ) {
    push(items, {
      id: "suggested-ops",
      path: "/operations",
      label: action.title,
      detail: action.detail,
      severity: "warn",
      opsSection: suggestedSection,
      opsAction: suggestedAction,
    });
  }

  return items;
}

function buildSettingsItems(onboarding: OnboardingStatus | null): NavAttentionItem[] {
  const items: NavAttentionItem[] = [];
  if (!onboarding) return items;

  if (!onboarding.prod.hasToken) {
    push(items, {
      id: "settings-prod-token",
      path: "/settings",
      label: "Production read token not configured",
      severity: "warn",
      settingsSection: "production",
    });
  }
  if (!onboarding.staging.hasToken) {
    push(items, {
      id: "settings-staging-token",
      path: "/settings",
      label: "Staging write token not configured",
      severity: "warn",
      settingsSection: "staging",
    });
  }
  if (!onboarding.prod.hasSshKey) {
    push(items, {
      id: "settings-ssh",
      path: "/settings",
      label: "Production SSH key not configured",
      severity: "warn",
      settingsSection: "production",
    });
  }
  if (onboarding.mirror.enabled && !onboarding.mirrorConfigured) {
    push(items, {
      id: "settings-mirror",
      path: "/settings",
      label: "MQTT mirror enabled but not deployed",
      severity: "warn",
      settingsSection: "mirror",
    });
  }

  return items;
}

function buildOnboardingItems(onboarding: OnboardingStatus | null): NavAttentionItem[] {
  if (!onboarding || onboarding.isComplete) return [];
  const remaining = Math.max(1, 8 - onboarding.completedSteps.length);
  return [
    {
      id: "onboarding-incomplete",
      path: "/onboarding",
      label: `Setup wizard incomplete (${remaining} step(s) remaining)`,
      severity: "warn",
    },
  ];
}

export function computeNavAttention(input: {
  dashboard: DashboardStatus | null;
  onboarding: OnboardingStatus | null;
  preflight: ProdStoragePreflightResult | null;
}): { items: NavAttentionItem[]; counts: NavAttentionCounts } {
  const { dashboard, onboarding, preflight } = input;
  if (!dashboard) return { items: [], counts: emptyCounts() };

  const items: NavAttentionItem[] = [
    ...buildOverviewItems(dashboard, preflight),
    ...buildHaIssueItems(dashboard.haIssues ?? []),
    ...buildLogSignalItems(dashboard.issues),
    ...buildHaDiagnosticsItems(dashboard.haIssues ?? []),
    ...buildEnvironmentItems(dashboard),
    ...buildOperationsItems(dashboard, preflight),
    ...buildSettingsItems(onboarding),
    ...buildOnboardingItems(onboarding),
  ];

  const counts = emptyCounts();
  for (const path of PATHS) {
    counts[path] =
      path === "/operations"
        ? operationsAttentionStepCount(items)
        : path === "/"
          ? overviewAttentionSlotCount(items)
          : items.filter((i) => i.path === path).length;
  }

  return { items, counts };
}

export function navAttentionForPath(items: NavAttentionItem[], path: string): NavAttentionItem[] {
  return items.filter((i) => i.path === path);
}

export function navAttentionCount(items: NavAttentionItem[], path: string): number {
  return navAttentionForPath(items, path).length;
}

export function attentionCountForAnchor(items: NavAttentionItem[], anchor: string): number {
  return items.filter((i) => i.anchor === anchor).length;
}

export function attentionCountForAnchors(items: NavAttentionItem[], anchors: string[]): number {
  return items.filter((i) => i.anchor && anchors.includes(i.anchor)).length;
}

export function attentionCountForOpsSection(
  items: NavAttentionItem[],
  section: NavAttentionItem["opsSection"],
): number {
  return items.filter((i) => i.opsSection === section).length;
}

export function attentionCountForSettingsSection(
  items: NavAttentionItem[],
  section: NavAttentionItem["settingsSection"],
): number {
  return items.filter((i) => i.settingsSection === section).length;
}

export function attentionCountForDiagTab(items: NavAttentionItem[], tab: NavAttentionItem["diagTab"]): number {
  return items.filter((i) => i.diagTab === tab).length;
}

/** Distinct overview badge slots — matches numbered badges rendered on the live page. */
export function overviewAttentionSlotCount(items: NavAttentionItem[]): number {
  return OVERVIEW_SLOT_ORDER.filter((slot) =>
    items.some((item) => item.path === "/" && item.overviewSlot === slot),
  ).length;
}

/** Ordered 1-based badges for overview sections that need attention. */
export function overviewAttentionOrders(
  items: NavAttentionItem[],
): Partial<Record<OverviewAttentionSlot, number>> {
  const active = OVERVIEW_SLOT_ORDER.filter((slot) =>
    items.some((item) => item.path === "/" && item.overviewSlot === slot),
  );
  const orders: Partial<Record<OverviewAttentionSlot, number>> = {};
  active.forEach((slot, index) => {
    orders[slot] = index + 1;
  });
  return orders;
}

/** Unique operations workflow steps — used for the top nav badge count. */
export function operationsAttentionStepCount(items: NavAttentionItem[]): number {
  const actions = new Set(
    items.filter((item) => item.path === "/operations" && item.opsAction).map((item) => item.opsAction),
  );
  return actions.size;
}

/** Number of distinct action buttons needing attention in one operations section. */
export function operationsSectionActionCount(items: NavAttentionItem[], section: OpsSection): number {
  return Object.keys(operationsActionOrders(items, section)).length;
}

/** Ordered badges for action buttons within one operations section. */
export function operationsActionOrders(
  items: NavAttentionItem[],
  section: OpsSection,
): Partial<Record<OpsAttentionAction, number>> {
  const active = (OPS_ACTION_ORDER[section] ?? []).filter((action) =>
    items.some((item) => item.path === "/operations" && item.opsSection === section && item.opsAction === action),
  );
  const orders: Partial<Record<OpsAttentionAction, number>> = {};
  active.forEach((action, index) => {
    orders[action] = index + 1;
  });
  return orders;
}
