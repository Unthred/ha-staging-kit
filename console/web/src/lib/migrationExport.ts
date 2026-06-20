import type { LovelaceMissingEntityIssue, ProdEntityNamingIssue } from "../api";

export function canExportMigrationFromNaming(issue: ProdEntityNamingIssue): boolean {
  return issue.prodFixAction === "suffix-collision" || issue.prodFixAction === "registry-rename";
}

export function canExportMigrationFromDeployGate(issue: LovelaceMissingEntityIssue): boolean {
  if (issue.prodContext?.prodFixAction) return true;
  if (
    issue.suggestionKind === "rename" &&
    issue.suggestedProdEntity &&
    issue.suggestedProdEntity !== issue.entityId
  ) {
    return true;
  }
  if (
    issue.prodContext?.expectedEntityDeletedOnProd &&
    (issue.prodContext.deletedRegistryEntityIds?.length ?? 0) > 0
  ) {
    return true;
  }
  return false;
}

export function exportMigrationDeployGateBody(issue: LovelaceMissingEntityIssue) {
  return { source: "deploy-gate" as const, deployGate: issue };
}

export function exportMigrationNamingBody(issue: ProdEntityNamingIssue) {
  return { source: "naming" as const, naming: issue };
}
