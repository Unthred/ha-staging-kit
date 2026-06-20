import type { ReleaseImpactPreviewResult } from "../api";

export function impactLevelLabel(level: ReleaseImpactPreviewResult["impactLevel"]): string {
  switch (level) {
    case "high":
      return "High — blocked";
    case "medium":
      return "Medium — confirm";
    case "low":
      return "Low";
    default:
      return level;
  }
}

export function impactLevelClass(level: ReleaseImpactPreviewResult["impactLevel"]): string {
  switch (level) {
    case "high":
      return "release-impact--high";
    case "medium":
      return "release-impact--medium";
    case "low":
      return "release-impact--low";
    default:
      return "release-impact--unknown";
  }
}
