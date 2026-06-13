namespace HaStagingConsole.Models;

public sealed record DashboardStatus(
    bool OnboardingComplete,
    IReadOnlyList<SubsystemStatus> Subsystems,
    SidecarRuntimeStatus? Sidecar,
    MirrorRuntimeStatus? Mirror,
    string? StagingHaUrl,
    string? ProdHaUrl,
    StagingTargetSnapshot? StagingTarget,
    GitSnapshotStatus? Git,
    PersonSyncSnapshot? PersonSync,
    PresenceSummary? Presence,
    ConfigDriftStatus? ConfigDrift,
    IReadOnlyList<ReadinessItem> Readiness,
    SuggestedAction? SuggestedAction,
    IReadOnlyList<string> SyncLogTail,
    IReadOnlyList<PollHistoryPoint> PollHistory,
    IReadOnlyList<ComponentIssue> Issues,
    DateTimeOffset RefreshedAt);

public sealed record SubsystemStatus(string Name, string Status, string Detail);

public sealed record ComponentIssue(string Source, string Level, string Message);

public sealed record SidecarRuntimeStatus(
    bool Running,
    string? LastPersonSync,
    string? LastApply,
    string? LastStorageSync,
    int PersonPollIntervalSeconds,
    int StorageSyncIntervalSeconds);

public sealed record MirrorRuntimeStatus(
    bool Running,
    bool Configured,
    string Mode,
    string? ProdMqttHost,
    int ProdMqttPort);

public sealed record GitSnapshotStatus(
    bool Configured,
    string? Branch,
    string? CommitHash,
    string? CommitSubject,
    DateTimeOffset? CommitDate,
    bool IsDirty);

public sealed record PersonSyncSnapshot(
    int? LastCount,
    DateTimeOffset? LastAt,
    string? LastAtRelative);

public sealed record PresenceSummary(
    int ProdPersonCount,
    int StagingPersonCount,
    int MatchedCount,
    string Detail);

public sealed record ConfigDriftStatus(
    bool HasDrift,
    string? RepoCommit,
    string? LastAppliedCommit,
    string Detail);

public sealed record ReadinessItem(string Id, string Label, bool Ok, string? Detail);

public sealed record SuggestedAction(string Title, string Detail, string Link, string LinkLabel);

public sealed record PollHistoryPoint(DateTimeOffset At, int Count, bool Ok);

public sealed record StagingTargetSnapshot(
    string? Url,
    string? ConfigPath,
    string? GitRepoPath,
    string? GitBranch,
    string? ContainerName,
    bool ContainerRunning,
    string InstallType,
    string InstallLabel,
    bool AddonsAvailable,
    bool ApiReachable,
    string? Version,
    string? LocationName,
    string? HaConfigDir,
    bool ConfigPathWritable,
    string StagingHaType,
    string ProdHaType,
    string? StagingMqttBroker,
    int StagingMqttPort,
    string? Notes);

public sealed record SettingsView(
    PathSettings Paths,
    ProdSettings Prod,
    StagingSettings Staging,
    MirrorSettings Mirror,
    TopologySettings Topology,
    SidecarIntervals Intervals,
    string? StagingHaContainer,
    StagingTargetSnapshot? StagingTarget);

public sealed record SidecarIntervals(
    int PersonPollIntervalSeconds,
    int StorageSyncIntervalSeconds,
    bool ApplyOnStart,
    bool SkipStorageSync);

public sealed record SettingsUpdateRequest(
    PathSettings Paths,
    string ProdUrl,
    string? ProdToken,
    string SshTarget,
    string? SshPrivateKey,
    string StagingUrl,
    string? StagingToken,
    MirrorSettings Mirror,
    TopologySettings Topology,
    SidecarIntervals Intervals,
    string? StagingHaContainer);

public sealed record OperationResult(bool Ok, string Message, string? LogTail);

public sealed record MirrorModeRequest(bool ControlMode);
