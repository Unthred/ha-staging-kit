import type { DiagnosticsStatus, HaLogSnapshot, HealthCheck } from "../api";

export const PLACEHOLDER_SUBSYSTEMS: HealthCheck[] = [
  { name: "Config sync", status: "skip", detail: "—" },
  { name: "Production HA", status: "skip", detail: "—" },
  { name: "Staging HA", status: "skip", detail: "—" },
];

const emptyHaLog = (instanceLabel: string): HaLogSnapshot => ({
  instanceLabel,
  source: "—",
  lines: [],
});

export const EMPTY_DIAGNOSTICS: DiagnosticsStatus = {
  subsystems: PLACEHOLDER_SUBSYSTEMS,
  issues: [],
  haIssues: [],
  pollHistory: [],
  syncActivity: null,
  syncLogLines: [],
  personPollLogLines: [],
  mqttLogLines: [],
  prodHaLog: emptyHaLog("Production HA"),
  stagingHaLog: emptyHaLog("Staging HA"),
  mirrorConfigured: false,
  syncLogPath: "—",
  personPollLogPath: "—",
  mqttLogPath: null,
  refreshedAt: "",
  operationLog: [],
  stagingHaUrl: null,
  prodHaUrl: null,
};
