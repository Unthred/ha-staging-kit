export function isMirrorControlMode(mode: string | undefined | null): boolean {
  return (mode ?? "").trim().toLowerCase() === "control";
}

export function mirrorModeLabel(mode: string | undefined | null): string {
  return isMirrorControlMode(mode) ? "Control mode" : "Read-only";
}

export function mirrorModeChipStatus(mode: string | undefined | null): string {
  return isMirrorControlMode(mode) ? "fail" : "pass";
}
