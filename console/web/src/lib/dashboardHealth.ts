import type { DashboardStatus } from "../api";

export type HealthTone = "good" | "caution" | "critical" | "idle";

export function statusTone(status: string): HealthTone {
  switch (status) {
    case "pass":
      return "good";
    case "warn":
      return "caution";
    case "fail":
      return "critical";
    default:
      return "idle";
  }
}

export function toneLabel(tone: HealthTone): string {
  switch (tone) {
    case "good":
      return "Healthy";
    case "caution":
      return "Needs attention";
    case "critical":
      return "Critical";
    default:
      return "Inactive";
  }
}

export function computeHealthScore(subsystems: DashboardStatus["subsystems"]): number {
  const active = subsystems.filter((s) => s.status !== "skip");
  if (active.length === 0) return 0;

  const points = active.reduce((sum, s) => {
    if (s.status === "pass") return sum + 100;
    if (s.status === "warn") return sum + 55;
    if (s.status === "fail") return sum + 10;
    return sum;
  }, 0);

  return Math.round(points / active.length);
}

export function countHealthy(subsystems: DashboardStatus["subsystems"]): { healthy: number; total: number } {
  const active = subsystems.filter((s) => s.status !== "skip");
  const healthy = active.filter((s) => s.status === "pass").length;
  return { healthy, total: active.length };
}

export function healthToneFromScore(score: number): HealthTone {
  if (score >= 85) return "good";
  if (score >= 50) return "caution";
  return "critical";
}

export function shortDetail(text: string, max = 88): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}
