export type HealthCheck = { name: string; status: string; detail: string };
export type HealthCheckPlanItem = { id: string; name: string };
export type TestResult = { ok: boolean; message: string };
export type DeployResult = { ok: boolean; message: string; logTail?: string };
export type OperationResult = { ok: boolean; message: string; logTail?: string | null };

export type OnboardingStatus = {
  currentStep: number;
  completedSteps: string[];
  isComplete: boolean;
  topology: { prodHaType: string; stagingHaType: string; sameHostAsKit: boolean };
  paths: {
    haConfigRepo: string;
    haBranch: string;
    haStagingConfig: string;
    sidecarData: string;
    mirrorData: string;
  };
  prod: { url: string; sshTarget: string; hasToken: boolean; hasSshKey: boolean };
  staging: { url: string; hasToken: boolean };
  mirror: { enabled: boolean; prodMqttHost: string; prodMqttPort: number; stagingMqttBrokerHost?: string; stagingMqttPort?: number };
  haMqttConfirmed: boolean;
  lastHealthChecks?: HealthCheck[];
  gitConfigured: boolean;
  mirrorConfigured: boolean;
  mirrorRunning: boolean;
  detected?: DetectedSetupSnapshot | null;
};

export type DetectedSetupSnapshot = {
  topology?: OnboardingStatus["topology"] | null;
  paths?: OnboardingStatus["paths"] | null;
  prodUrl?: string | null;
  stagingUrl?: string | null;
  sshTarget?: string | null;
  prodMqttHost?: string | null;
  prodMqttPort?: number | null;
  stagingMqttBrokerHost?: string | null;
  stagingMqttPort?: number | null;
  stagingHaContainer?: string | null;
  sources?: Record<string, string>;
  notes?: string[];
  canAutoFillTopology: boolean;
  canAutoFillPaths: boolean;
};

export type DashboardStatus = {
  onboardingComplete: boolean;
  subsystems: HealthCheck[];
  sidecar?: {
    running: boolean;
    lastPersonSync?: string | null;
    lastApply?: string | null;
    lastStorageSync?: string | null;
    personPollIntervalSeconds: number;
    storageSyncIntervalSeconds: number;
  };
  mirror?: {
    running: boolean;
    configured: boolean;
    mode: string;
    prodMqttHost?: string | null;
    prodMqttPort: number;
  };
  stagingHaUrl?: string | null;
  prodHaUrl?: string | null;
  stagingTarget?: StagingTargetSnapshot | null;
  git?: GitSnapshot | null;
  personSync?: PersonSyncSnapshot | null;
  presence?: PresenceSummary | null;
  configDrift?: ConfigDriftStatus | null;
  readiness: ReadinessItem[];
  suggestedAction?: SuggestedAction | null;
  syncActivity?: SyncActivitySnapshot | null;
  configInventory?: ConfigInventoryStats | null;
  prodMonitoring?: HaMonitoringStats | null;
  stagingMonitoring?: HaMonitoringStats | null;
  entityParity?: EntityParitySnapshot | null;
  stagingRepresentation?: StagingRepresentationStatus | null;
  mqttBridge?: MqttBridgeStats | null;
  syncLogTail: string[];
  pollHistory: PollHistoryPoint[];
  issues: ComponentIssue[];
  liveMetrics?: LiveMetricsSnapshot | null;
  refreshedAt: string;
};

export type LiveMetricsSnapshot = {
  status: LiveStatusChips;
  reachability: HaReachabilitySnapshot;
  bridge?: BridgeUptimeSnapshot | null;
  automation?: AutomationActivitySnapshot | null;
};

export type LiveStatusChips = {
  git?: GitLiveChip | null;
  mirror?: MirrorLiveChip | null;
  staging?: StagingLiveChip | null;
};

export type GitLiveChip = {
  configured: boolean;
  branch?: string | null;
  commitHash?: string | null;
  isHaDirty: boolean;
  haChangedFileCount: number;
  isRepoDirty: boolean;
  repoChangedFileCount: number;
  commitsAhead?: number | null;
  commitsBehind?: number | null;
};

export type MirrorLiveChip = {
  configured: boolean;
  running: boolean;
  mode: string;
  bridgeConnected: boolean;
  prodMqttHost?: string | null;
  prodMqttPort: number;
};

export type StagingLiveChip = {
  apiReachable: boolean;
  containerRunning: boolean;
  version?: string | null;
  installLabel: string;
  containerName?: string | null;
};

export type HaReachabilitySnapshot = {
  available: boolean;
  prodLatencyMs?: number | null;
  prodReachable: boolean;
  stagingLatencyMs?: number | null;
  stagingReachable: boolean;
  history: ReachabilityHistoryPoint[];
};

export type ReachabilityHistoryPoint = {
  at: string;
  prodLatencyMs?: number | null;
  prodReachable: boolean;
  stagingLatencyMs?: number | null;
  stagingReachable: boolean;
};

export type BridgeUptimeSnapshot = {
  available: boolean;
  connected: boolean;
  buckets: BridgeUptimeBucket[];
  pollHistory: BridgeStatePoint[];
};

export type BridgeUptimeBucket = {
  at: string;
  connected: boolean;
};

export type BridgeStatePoint = {
  at: string;
  connected: boolean;
};

export type AutomationActivitySnapshot = {
  available: boolean;
  prodRunsLastHour: number;
  stagingRunsLastHour: number;
  prodBuckets: AutomationActivityBucket[];
  stagingBuckets: AutomationActivityBucket[];
};

export type AutomationActivityBucket = {
  at: string;
  runs: number;
};

export type GitFileDiff = {
  path: string;
  status: "added" | "modified" | "deleted" | string;
  diff: string;
};

export type GitSnapshot = {
  configured: boolean;
  branch?: string | null;
  commitHash?: string | null;
  commitSubject?: string | null;
  commitDate?: string | null;
  isDirty: boolean;
  changedFileCount: number;
  isHaDirty: boolean;
  haChangedFileCount: number;
  isRepoDirty: boolean;
  repoChangedFileCount: number;
  haChangedSample: string[];
  repoChangedSample: string[];
  haChangedFiles: string[];
  repoChangedFiles: string[];
  commitsAhead?: number | null;
  commitsBehind?: number | null;
  remoteUrl?: string | null;
  stagingAheadOfMain?: number | null;
  stagingHaChanges?: number | null;
  mainAheadOfProdHa?: number | null;
  mainHaChangesForProdHa?: number | null;
};

export type PersonSyncSnapshot = {
  lastCount?: number | null;
  lastAt?: string | null;
  lastAtRelative?: string | null;
};

export type PresenceSummary = {
  prodPersonCount: number;
  stagingPersonCount: number;
  matchedCount: number;
  detail: string;
};

export type StagingTargetSnapshot = {
  url?: string | null;
  configPath?: string | null;
  gitRepoPath?: string | null;
  gitBranch?: string | null;
  containerName?: string | null;
  containerRunning: boolean;
  installType: string;
  installLabel: string;
  addonsAvailable: boolean;
  apiReachable: boolean;
  version?: string | null;
  locationName?: string | null;
  haConfigDir?: string | null;
  configPathWritable: boolean;
  stagingHaType: string;
  prodHaType: string;
  stagingMqttBroker?: string | null;
  stagingMqttPort: number;
  notes?: string | null;
};

export type ConfigDriftStatus = {
  hasDrift: boolean;
  repoCommit?: string | null;
  lastAppliedCommit?: string | null;
  detail: string;
};

export type ReadinessItem = {
  id: string;
  label: string;
  ok: boolean;
  detail?: string | null;
};

export type SuggestedAction = {
  title: string;
  detail: string;
  link: string;
  linkLabel: string;
  severity?: "critical" | "warning" | "info";
  actionPreset?: string | null;
};

export type SyncActivitySnapshot = {
  lastPersonPollAt?: string | null;
  lastPersonPollRelative?: string | null;
  lastPersonPollCount?: number | null;
  lastApplyAt?: string | null;
  lastApplyRelative?: string | null;
  lastApplyCommit?: string | null;
  lastStorageSyncAt?: string | null;
  lastStorageSyncRelative?: string | null;
};

export type ConfigInventoryStats = {
  available: boolean;
  automationCount: number;
  scriptCount: number;
  packageCount: number;
  blueprintCount: number;
};

export type HaMonitoringStats = {
  available: boolean;
  automationEntities: number;
  scriptEntities: number;
  personEntities: number;
  mqttEntities: number;
  sensorEntities: number;
  totalEntities: number;
};

export type EntityParitySnapshot = {
  available: boolean;
  hasDifferences: boolean;
  isAligned: boolean;
  unexpectedProdOnlyCount: number;
  unexpectedStagingOnlyCount: number;
  expectedStagingOnlyCount: number;
  unexpectedProdOnlySample: string[];
  unexpectedStagingOnlySample: string[];
  expectedStagingOnlySample: string[];
  domains: EntityDomainParity[];
};

export type EntityDomainParity = {
  domain: string;
  prodOnlyCount: number;
  stagingOnlyCount: number;
  unexpectedProdOnlyCount: number;
  unexpectedStagingOnlyCount: number;
  prodOnlySample: string[];
  stagingOnlySample: string[];
};

export type StagingRepresentationStatus = {
  available: boolean;
  verdict: "aligned" | "review" | "drift";
  headline: string;
  summary: string;
  configMatchesGit: boolean;
  entityRegistryAligned: boolean;
  presenceMatches: boolean;
  gitClean: boolean;
  issues: RepresentationIssue[];
};

export type RepresentationIssue = {
  severity: "info" | "warn" | "error";
  category: string;
  title: string;
  detail: string;
  samples: string[];
};

export type MqttBridgeStats = {
  available: boolean;
  bridgeConnected: boolean;
  connectedClients: number;
  recentEvents: number;
  activityBuckets: MqttActivityBucket[];
};

export type MqttActivityBucket = {
  at: string;
  events: number;
};

export type PollHistoryPoint = {
  at: string;
  count: number;
  ok: boolean;
};

export type ComponentIssue = {
  source: string;
  level: "error" | "warn";
  message: string;
};

export type SettingsView = {
  paths: OnboardingStatus["paths"];
  prod: OnboardingStatus["prod"];
  staging: OnboardingStatus["staging"];
  mirror: OnboardingStatus["mirror"];
  topology: OnboardingStatus["topology"];
  intervals: {
    personPollIntervalSeconds: number;
    storageSyncIntervalSeconds: number;
    applyOnStart: boolean;
    skipStorageSync: boolean;
  };
  stagingHaContainer?: string | null;
  stagingTarget?: StagingTargetSnapshot | null;
};

export type ContainerStatus = {
  id: string;
  label: string;
  configuredNames: string;
  resolvedName?: string | null;
  running: boolean;
};

export type MountHint = { label: string; path: string; detail?: string | null };
export type BrowseEntry = { name: string; path: string; isDirectory: boolean; badge?: string | null };
export type BrowseResult = {
  path: string;
  entries: BrowseEntry[];
  error?: string | null;
  isGitRepo?: boolean;
  parentPath?: string | null;
};

export class ApiError extends Error {
  readonly title: string;
  readonly detail: string;
  readonly status?: number;
  readonly hint?: string;

  constructor(title: string, detail: string, status?: number, hint?: string) {
    super(detail);
    this.name = "ApiError";
    this.title = title;
    this.detail = detail;
    this.status = status;
    this.hint = hint;
  }
}

function parseApiError(status: number, text: string): ApiError {
  const trimmed = text.trim();

  if (status === 503 && /no server is available/i.test(trimmed)) {
    return new ApiError(
      "Console API unavailable",
      "The reverse proxy could not reach the staging console on this host.",
      503,
      "The console container may have stopped, or HAProxy has no healthy backend. Try restarting below, or open http://<unraid-ip>:8081/ directly."
    );
  }

  if (status === 502) {
    return new ApiError(
      "Bad gateway",
      "A proxy received an invalid response from the console container.",
      502,
      "The console may still be starting after a restart. Wait a few seconds and retry."
    );
  }

  if (trimmed.startsWith("<") && /<html/i.test(trimmed)) {
    const titleMatch = trimmed.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const pageTitle = titleMatch?.[1]?.trim();
    return new ApiError(
      pageTitle ?? `HTTP ${status} error page`,
      status === 503
        ? "Upstream service unavailable — the console or config sync worker may be stopped."
        : `Received an HTML error page instead of JSON (HTTP ${status}).`,
      status,
      "This often means HAProxy returned an error while the React UI was already loaded from cache."
    );
  }

  try {
    const json = JSON.parse(trimmed) as { message?: string; title?: string };
    if (json.message) {
      return new ApiError(json.title ?? "Request failed", json.message, status);
    }
  } catch {
    /* not JSON */
  }

  return new ApiError(
    `Request failed (${status})`,
    trimmed.slice(0, 500) || "Unknown error",
    status
  );
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
    return new ApiError(
      "Cannot reach console",
      "The browser could not connect to the console API.",
      undefined,
      "Check that ha-staging-kit is running on port 8081."
    );
  }
  if (err instanceof Error) return new ApiError("Error", err.message);
  return new ApiError("Error", String(err));
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
  } catch (err) {
    throw toApiError(err);
  }

  if (!res.ok) {
    throw parseApiError(res.status, await res.text());
  }

  return res.json() as Promise<T>;
}

export const onboardingApi = {
  status: () => api<OnboardingStatus>("/api/onboarding/status"),
  topology: (body: OnboardingStatus["topology"]) =>
    api<OnboardingStatus>("/api/onboarding/topology", { method: "POST", body: JSON.stringify(body) }),
  paths: (body: OnboardingStatus["paths"]) =>
    api<OnboardingStatus>("/api/onboarding/paths", { method: "POST", body: JSON.stringify(body) }),
  prod: (body: { url: string; token?: string; sshTarget: string; sshPrivateKey?: string }) =>
    api<OnboardingStatus>("/api/onboarding/prod", { method: "POST", body: JSON.stringify(body) }),
  staging: (body: { url: string; token?: string }) =>
    api<OnboardingStatus>("/api/onboarding/staging", { method: "POST", body: JSON.stringify(body) }),
  mirror: (body: OnboardingStatus["mirror"]) =>
    api<OnboardingStatus>("/api/onboarding/mirror", { method: "POST", body: JSON.stringify(body) }),
  confirmHaMqtt: () => api<OnboardingStatus>("/api/onboarding/ha-mqtt-confirmed", { method: "POST" }),
  skipToDashboard: () => api<OnboardingStatus>("/api/onboarding/skip-to-dashboard", { method: "POST" }),
  testProd: (body?: { url?: string; token?: string }) =>
    api<TestResult>("/api/onboarding/test/prod-api", { method: "POST", body: JSON.stringify(body ?? {}) }),
  testStaging: (body?: { url?: string; token?: string }) =>
    api<TestResult>("/api/onboarding/test/staging-api", { method: "POST", body: JSON.stringify(body ?? {}) }),
  testSsh: (body?: { sshTarget?: string; sshPrivateKey?: string }) =>
    api<TestResult>("/api/onboarding/test/ssh", { method: "POST", body: JSON.stringify(body ?? {}) }),
  testMqtt: (body?: { prodMqttHost?: string; prodMqttPort?: number }) =>
    api<TestResult>("/api/onboarding/test/mqtt", { method: "POST", body: JSON.stringify(body ?? {}) }),
  testStagingPath: (body?: { haStagingConfig?: string }) =>
    api<TestResult>("/api/onboarding/test/staging-path", { method: "POST", body: JSON.stringify(body ?? {}) }),
  testGitRepo: (body?: { haConfigRepo?: string }) =>
    api<TestResult>("/api/onboarding/test/git-repo", { method: "POST", body: JSON.stringify(body ?? {}) }),
  mounts: () => api<MountHint[]>("/api/onboarding/mounts"),
  browse: (path?: string) => api<BrowseResult>(`/api/onboarding/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  deploy: () => api<DeployResult>("/api/onboarding/deploy", { method: "POST" }),
  storageSync: () => api<DeployResult>("/api/onboarding/storage-sync", { method: "POST" }),
  prodGitInit: () => api<DeployResult>("/api/onboarding/prod-git-init", { method: "POST" }),
  deployMirror: () => api<DeployResult>("/api/onboarding/deploy-mirror", { method: "POST" }),
  health: () => api<HealthCheck[]>("/api/onboarding/health", { method: "POST" }),
  healthPlan: () => api<HealthCheckPlanItem[]>("/api/onboarding/health/plan"),
  healthRun: (checkId: string) =>
    api<HealthCheck>(`/api/onboarding/health/run/${encodeURIComponent(checkId)}`, { method: "POST" }),
  healthSave: (results: HealthCheck[]) =>
    api<HealthCheck[]>("/api/onboarding/health/save", { method: "POST", body: JSON.stringify(results) }),
  healthContinue: () => api<OnboardingStatus>("/api/onboarding/health/continue", { method: "POST" }),
  complete: () => api<OnboardingStatus>("/api/onboarding/complete", { method: "POST" }),
};

export const dashboardApi = {
  status: () => api<DashboardStatus>("/api/dashboard"),
  gitDiff: (path: string) => api<GitFileDiff>(`/api/git/diff?path=${encodeURIComponent(path)}`),
  gitCommit: (body: { scope: "ha" | "repo"; message?: string | null }) =>
    api<OperationResult>("/api/git/commit", { method: "POST", body: JSON.stringify(body) }),
  gitPush: (branch?: string | null) =>
    api<OperationResult>("/api/git/push", {
      method: "POST",
      body: JSON.stringify({ branch: branch ?? null }),
    }),
};

export type DiagnosticsStatus = {
  subsystems: DashboardStatus["subsystems"];
  issues: ComponentIssue[];
  pollHistory: PollHistoryPoint[];
  syncActivity?: SyncActivitySnapshot | null;
  syncLogLines: string[];
  mqttLogLines: string[];
  mirrorConfigured: boolean;
  syncLogPath: string;
  mqttLogPath?: string | null;
  refreshedAt: string;
};

export const diagnosticsApi = {
  status: () => api<DiagnosticsStatus>("/api/diagnostics"),
};

export const settingsApi = {
  get: () => api<SettingsView>("/api/settings"),
  save: (body: SettingsView & {
    prodUrl: string;
    prodToken?: string;
    sshTarget: string;
    sshPrivateKey?: string;
    stagingUrl: string;
    stagingToken?: string;
  }) => api<SettingsView>("/api/settings", { method: "POST", body: JSON.stringify(body) }),
};

export const operationsApi = {
  applyConfig: () => api<OperationResult>("/api/operations/apply-config", { method: "POST" }),
  personPoll: () => api<OperationResult>("/api/operations/person-poll", { method: "POST" }),
  storageSync: () => api<OperationResult>("/api/operations/storage-sync", { method: "POST" }),
  mirrorReadOnly: () => api<OperationResult>("/api/operations/mirror-mode", { method: "POST", body: JSON.stringify({ controlMode: false }) }),
  mirrorControl: () => api<OperationResult>("/api/operations/mirror-mode", { method: "POST", body: JSON.stringify({ controlMode: true }) }),
  setMirrorMode: (controlMode: boolean) =>
    api<OperationResult>("/api/operations/mirror-mode", {
      method: "POST",
      body: JSON.stringify({ controlMode }),
    }),
  deployMirror: () => api<OperationResult>("/api/operations/deploy-mirror", { method: "POST" }),
  restartStaging: () => api<OperationResult>("/api/operations/restart-staging", { method: "POST" }),
  shipToStaging: () => api<OperationResult>("/api/operations/ship-to-staging", { method: "POST" }),
  deployToProd: () => api<OperationResult>("/api/operations/deploy-to-prod", { method: "POST" }),
};

export const systemApi = {
  containers: () => api<ContainerStatus[]>("/api/system/containers"),
  restartContainer: (role: "kit" | "web" | "sync" | "mirror") =>
    api<OperationResult>("/api/system/restart-container", {
      method: "POST",
      body: JSON.stringify({ role }),
    }),
};
