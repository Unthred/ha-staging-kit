namespace HaStagingConsole.Models;

public sealed record DashboardStatus(
    bool OnboardingComplete,
    IReadOnlyList<SubsystemStatus> Subsystems,
    SidecarRuntimeStatus? Sidecar,
    MirrorRuntimeStatus? Mirror,
    string? StagingHaUrl);

public sealed record SubsystemStatus(string Name, string Status, string Detail);

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

public sealed record SettingsView(
    PathSettings Paths,
    ProdSettings Prod,
    StagingSettings Staging,
    MirrorSettings Mirror,
    SidecarIntervals Intervals,
    string? StagingHaContainer);

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
    SidecarIntervals Intervals,
    string? StagingHaContainer);

public sealed record OperationResult(bool Ok, string Message, string? LogTail);

public sealed record MirrorModeRequest(bool ControlMode);
