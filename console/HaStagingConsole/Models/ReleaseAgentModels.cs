namespace HaStagingConsole.Models;

public sealed record ReleaseHistoryDocument(
    string? InstanceId,
    IReadOnlyList<ReleaseHistoryEntry> Releases,
    int CurrentIndex);

public sealed record ReleaseHistoryEntry(
    int Index,
    string Sha,
    string ShortSha,
    DateTimeOffset AppliedAt,
    string GitRef,
    string? Message,
    IReadOnlyList<string> MigrationsApplied,
    bool YamlDeployed,
    IReadOnlyList<string> StorageBundlePaths,
    string? RegistrySnapshot,
    string? DeviceRegistrySnapshot,
    string? ReportPath);

public sealed record MigrationsAppliedDocument(
    string? InstanceId,
    IReadOnlyList<MigrationAppliedEntry> Entries);

public sealed record MigrationAppliedEntry(
    string Id,
    string GitSha,
    DateTimeOffset AppliedAt,
    string ManifestPath);

public sealed record MigrationManifestDocument(
    string Id,
    string Title,
    string? Description,
    bool StopHomeAssistant,
    IReadOnlyList<MigrationPreconditionDocument> Preconditions,
    IReadOnlyList<MigrationStepDocument> Steps,
    string RelativePath);

public sealed record MigrationPreconditionDocument(string Type, string? EntityId, string? Path, string? Text);

public sealed record MigrationStepDocument(
    string Name,
    string Action,
    IReadOnlyDictionary<string, object?> Params);

public sealed record ReleaseAgentPlanResult(
    bool Ok,
    string Message,
    string? GitSha,
    string? ShortSha,
    IReadOnlyList<string> PendingManifests,
    IReadOnlyList<string> SkippedManifests,
    IReadOnlyList<string> WillRunManifests,
    bool RequiresRegistryStop,
    string? LogTail);

public sealed record ReleaseDeployContext(
    string? BaselineSha,
    bool YamlDeploy,
    bool LovelaceBundleDeploy,
    bool HelpersDeploy,
    bool Z2mConfigDeploy,
    bool RequiresProdRestart,
    ProdStorageDeployGateResult DeployGate);

/// <summary>Graded release impact — block only on known breakages; confirm on advisory medium.</summary>
public sealed record ReleaseImpactPreviewResult(
    bool Ok,
    string Message,
    string ImpactLevel,
    bool BlocksRelease,
    bool RequiresConfirm,
    string Summary,
    IReadOnlyList<string> Blockers,
    IReadOnlyList<string> Warnings,
    string? GitSha,
    string? ShortSha,
    string? BaselineSha,
    bool YamlDeploy,
    bool LovelaceBundleDeploy,
    bool HelpersDeploy,
    bool Z2mConfigDeploy,
    bool RequiresProdRestart,
    bool RequiresRegistryStop,
    IReadOnlyList<string> WillRunManifests,
    ProdStorageDeployGateResult? DeployGate);

public sealed record ReleaseAgentHistoryResult(
    bool Ok,
    string Message,
    IReadOnlyList<ReleaseHistoryEntry> Releases,
    int CurrentIndex);

public sealed record ReleaseAgentApplyRequest(string GitRef = "origin/main", string? Message = null, bool MergeStaging = true);

public sealed record ReleaseAgentRollbackRequest(
    int? Steps = null,
    string? ToSha = null,
    int? ToIndex = null);
