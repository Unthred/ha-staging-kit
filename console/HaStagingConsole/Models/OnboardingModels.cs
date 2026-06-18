namespace HaStagingConsole.Models;

public sealed record DetectedSetupSnapshot(
    TopologySettings? Topology,
    PathSettings? Paths,
    string? ProdUrl,
    string? StagingUrl,
    string? SshTarget,
    string? ProdMqttHost,
    int? ProdMqttPort,
    string? StagingMqttBrokerHost,
    int? StagingMqttPort,
    string? StagingHaContainer,
    IReadOnlyDictionary<string, string> Sources,
    IReadOnlyList<string> Notes,
    bool CanAutoFillTopology,
    bool CanAutoFillPaths);

public sealed record OnboardingStatus(
    int CurrentStep,
    IReadOnlyList<string> CompletedSteps,
    bool IsComplete,
    TopologySettings Topology,
    PathSettings Paths,
    ProdSettings Prod,
    StagingSettings Staging,
    MirrorSettings Mirror,
    bool HaMqttConfirmed,
    IReadOnlyList<HealthCheckResult>? LastHealthChecks,
    bool GitConfigured,
    bool MirrorConfigured,
    bool MirrorRunning,
    DetectedSetupSnapshot? Detected);

public sealed record TopologySettings(
    string ProdHaType,
    string StagingHaType,
    bool SameHostAsKit);

public sealed record PathSettings(
    string HaConfigRepo,
    string HaBranch,
    string HaStagingConfig,
    string SidecarData,
    string MirrorData);

public sealed record ProdSettings(
    string Url,
    string SshTarget,
    bool HasToken,
    bool HasSshKey);

public sealed record StagingSettings(string Url, bool HasToken);

public sealed record MirrorSettings(
    bool Enabled,
    string ProdMqttHost,
    int ProdMqttPort,
    string StagingMqttBrokerHost = "",
    int StagingMqttPort = 1883);

public sealed record HealthCheckResult(string Name, string Status, string Detail);

public sealed record HealthCheckPlanItem(string Id, string Name);

public sealed record OnboardingState
{
    public int CurrentStep { get; set; }
    public List<string> CompletedSteps { get; set; } = [];
    public bool IsComplete { get; set; }
    public TopologySettings Topology { get; set; } = new("ha_os", "docker", true);
    public PathSettings Paths { get; set; } = new("", "staging", "", "./data/sidecar", "./data/mirror");
    public ProdSettings Prod { get; set; } = new("", "", false, false);
    public StagingSettings Staging { get; set; } = new("", false);
    public MirrorSettings Mirror { get; set; } = new(false, "", 1883);
    public bool HaMqttConfirmed { get; set; }
    public List<HealthCheckResult>? LastHealthChecks { get; set; }
    public AppearanceSettings Appearance { get; set; } = new();
}

public sealed record TopologyRequest(string ProdHaType, string StagingHaType, bool SameHostAsKit);

public sealed record PathsRequest(
    string HaConfigRepo,
    string HaBranch,
    string HaStagingConfig,
    string SidecarData,
    string MirrorData);

public sealed record ProdSecretsRequest(
    string Url,
    string Token,
    string SshTarget,
    string? SshPrivateKey);

public sealed record StagingSecretsRequest(string Url, string Token);

public sealed record MirrorRequest(
    bool Enabled,
    string ProdMqttHost,
    int ProdMqttPort,
    string? StagingMqttBrokerHost = null,
    int? StagingMqttPort = null);

public sealed record TestResult(bool Ok, string Message);

public sealed record ApiTestRequest(string? Url, string? Token);

public sealed record SshTestRequest(string? SshTarget, string? SshPrivateKey);

public sealed record MqttTestRequest(string? ProdMqttHost, int? ProdMqttPort);

public sealed record StagingPathTestRequest(string? HaStagingConfig);

public sealed record GitRepoTestRequest(string? HaConfigRepo);

public sealed record MountHint(string Label, string Path, string? Detail);

public sealed record BrowseEntry(string Name, string Path, bool IsDirectory, string? Badge);

public sealed record BrowseResult(
    string Path,
    IReadOnlyList<BrowseEntry> Entries,
    string? Error,
    bool IsGitRepo = false,
    string? ParentPath = null);

public sealed record DeployResult(bool Ok, string Message, string? LogTail);

public sealed record ContainerStatus(
    string Id,
    string Label,
    string ConfiguredNames,
    string? ResolvedName,
    bool Running);

public sealed record RestartContainerRequest(string Role);

public sealed record OnboardingReport(
    string Summary,
    IReadOnlyList<string> NextSteps,
    IReadOnlyList<HealthCheckResult> HealthChecks);
