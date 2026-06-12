export type HealthCheck = { name: string; status: string; detail: string };
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
  mirror: { enabled: boolean; prodMqttHost: string; prodMqttPort: number };
  haMqttConfirmed: boolean;
  lastHealthChecks?: HealthCheck[];
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
};

export type SettingsView = {
  paths: OnboardingStatus["paths"];
  prod: OnboardingStatus["prod"];
  staging: OnboardingStatus["staging"];
  mirror: OnboardingStatus["mirror"];
  intervals: {
    personPollIntervalSeconds: number;
    storageSyncIntervalSeconds: number;
    applyOnStart: boolean;
    skipStorageSync: boolean;
  };
  stagingHaContainer?: string | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
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
  testProd: () => api<TestResult>("/api/onboarding/test/prod-api", { method: "POST" }),
  testStaging: () => api<TestResult>("/api/onboarding/test/staging-api", { method: "POST" }),
  testSsh: () => api<TestResult>("/api/onboarding/test/ssh", { method: "POST" }),
  testMqtt: () => api<TestResult>("/api/onboarding/test/mqtt", { method: "POST" }),
  deploy: () => api<DeployResult>("/api/onboarding/deploy", { method: "POST" }),
  storageSync: () => api<DeployResult>("/api/onboarding/storage-sync", { method: "POST" }),
  deployMirror: () => api<DeployResult>("/api/onboarding/deploy-mirror", { method: "POST" }),
  health: () => api<HealthCheck[]>("/api/onboarding/health", { method: "POST" }),
  complete: () => api<OnboardingStatus>("/api/onboarding/complete", { method: "POST" }),
};

export const dashboardApi = {
  status: () => api<DashboardStatus>("/api/dashboard"),
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
  deployMirror: () => api<OperationResult>("/api/operations/deploy-mirror", { method: "POST" }),
  restartStaging: () => api<OperationResult>("/api/operations/restart-staging", { method: "POST" }),
};
