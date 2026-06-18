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
    SyncActivitySnapshot? SyncActivity,
    ConfigInventoryStats? ConfigInventory,
    HaMonitoringStats? ProdMonitoring,
    HaMonitoringStats? StagingMonitoring,
    EntityParitySnapshot? EntityParity,
    StagingRepresentationStatus? StagingRepresentation,
    MqttBridgeStats? MqttBridge,
    IReadOnlyList<string> SyncLogTail,
    IReadOnlyList<PollHistoryPoint> PollHistory,
    IReadOnlyList<ComponentIssue> Issues,
    IReadOnlyList<ComponentIssue> HaIssues,
    LiveMetricsSnapshot? LiveMetrics,
    DateTimeOffset RefreshedAt);

public sealed record LiveMetricsSnapshot(
    LiveStatusChips Status,
    HaReachabilitySnapshot Reachability,
    BridgeUptimeSnapshot? Bridge,
    AutomationActivitySnapshot? Automation);

public sealed record LiveStatusChips(
    GitLiveChip? Git,
    MirrorLiveChip? Mirror,
    StagingLiveChip? Staging);

public sealed record GitLiveChip(
    bool Configured,
    string? Branch,
    string? CommitHash,
    bool IsHaDirty,
    int HaChangedFileCount,
    bool IsRepoDirty,
    int RepoChangedFileCount,
    int? CommitsAhead,
    int? CommitsBehind);

public sealed record MirrorLiveChip(
    bool Configured,
    bool Running,
    string Mode,
    bool BridgeConnected,
    string? ProdMqttHost,
    int ProdMqttPort);

public sealed record StagingLiveChip(
    bool ApiReachable,
    bool ContainerRunning,
    string? Version,
    string InstallLabel,
    string? ContainerName);

public sealed record HaReachabilitySnapshot(
    bool Available,
    int? ProdLatencyMs,
    bool ProdReachable,
    int? StagingLatencyMs,
    bool StagingReachable,
    IReadOnlyList<ReachabilityHistoryPoint> History);

public sealed record ReachabilityHistoryPoint(
    DateTimeOffset At,
    int? ProdLatencyMs,
    bool ProdReachable,
    int? StagingLatencyMs,
    bool StagingReachable);

public sealed record BridgeUptimeSnapshot(
    bool Available,
    bool Connected,
    IReadOnlyList<BridgeUptimeBucket> Buckets,
    IReadOnlyList<BridgeStatePoint> PollHistory);

public sealed record BridgeUptimeBucket(DateTimeOffset At, bool Connected);

public sealed record BridgeStatePoint(DateTimeOffset At, bool Connected);

public sealed record AutomationActivitySnapshot(
    bool Available,
    int ProdRunsLastHour,
    int StagingRunsLastHour,
    IReadOnlyList<AutomationActivityBucket> ProdBuckets,
    IReadOnlyList<AutomationActivityBucket> StagingBuckets);

public sealed record AutomationActivityBucket(DateTimeOffset At, int Runs);

public sealed record HaProbeResult(bool Available, bool Reachable, int? LatencyMs);

public sealed record SubsystemStatus(string Name, string Status, string Detail);

public sealed record ComponentIssue(
    string Source,
    string Level,
    string Message,
    string? Domain = null,
    string? EntryId = null,
    string? Reason = null);

public sealed record HaLogSnapshot(
    string InstanceLabel,
    string Source,
    IReadOnlyList<string> Lines)
{
    public static HaLogSnapshot Empty(string instanceLabel) =>
        new(instanceLabel, "Log unavailable", []);
}

public sealed record HaInstanceDiagnosticsSnapshot(
    IReadOnlyList<ComponentIssue> Issues,
    string? Url);

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
    bool IsDirty,
    int ChangedFileCount,
    bool IsHaDirty,
    int HaChangedFileCount,
    bool IsRepoDirty,
    int RepoChangedFileCount,
    IReadOnlyList<string> HaChangedSample,
    IReadOnlyList<string> RepoChangedSample,
    IReadOnlyList<string> HaChangedFiles,
    IReadOnlyList<string> RepoChangedFiles,
    int? CommitsAhead,
    int? CommitsBehind,
    string? RemoteUrl,
    int? StagingAheadOfMain,
    int StagingHaChanges,
    int? MainAheadOfProdHa,
    int MainHaChangesForProdHa,
    int MainStorageChangesForProdHa,
    IReadOnlyList<string> StagingHaFileList,
    IReadOnlyList<string> StagingRepoFileList,
    IReadOnlyList<string> MainHaFileList,
    IReadOnlyList<string> MainStorageFileList,
    bool ProdDeployTracked = false,
    string? ProdLastDeploySha = null,
    string? ProdPreviousDeploySha = null);

public sealed record GitFileDiffResult(string Path, string Status, string Diff);

public sealed record GitChangedFilesResult(
    IReadOnlyList<string> HaChangedFiles,
    IReadOnlyList<string> RepoChangedFiles);

public sealed record GitCommitRequest(string Scope, string? Message);

public sealed record GitPushRequest(string? Branch);

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
    string Detail,
    bool ApplyGapHasHaChanges = false,
    int ApplyGapHaFileCount = 0);

public sealed record ReadinessItem(string Id, string Label, bool Ok, string? Detail);

public sealed record SuggestedAction(
    string Title,
    string Detail,
    string Link,
    string LinkLabel,
    string Severity = "info",
    string? ActionPreset = null);

public sealed record SyncActivitySnapshot(
    DateTimeOffset? LastPersonPollAt,
    string? LastPersonPollRelative,
    int? LastPersonPollCount,
    DateTimeOffset? LastApplyAt,
    string? LastApplyRelative,
    string? LastApplyCommit,
    DateTimeOffset? LastStorageSyncAt,
    string? LastStorageSyncRelative);

public sealed record ConfigInventoryStats(
    bool Available,
    int AutomationCount,
    int ScriptCount,
    int PackageCount,
    int BlueprintCount);

public sealed record HaMonitoringStats(
    bool Available,
    int AutomationEntities,
    int ScriptEntities,
    int PersonEntities,
    int MqttEntities,
    int SensorEntities,
    int TotalEntities);

public sealed record EntityParitySnapshot(
    bool Available,
    bool HasDifferences,
    bool IsAligned,
    int UnexpectedProdOnlyCount,
    int UnexpectedStagingOnlyCount,
    int ExpectedStagingOnlyCount,
    IReadOnlyList<string> UnexpectedProdOnlySample,
    IReadOnlyList<string> UnexpectedStagingOnlySample,
    IReadOnlyList<string> ExpectedStagingOnlySample,
    IReadOnlyList<EntityDomainParity> Domains);

public sealed record EntityDomainParity(
    string Domain,
    int ProdOnlyCount,
    int StagingOnlyCount,
    int UnexpectedProdOnlyCount,
    int UnexpectedStagingOnlyCount,
    IReadOnlyList<string> ProdOnlySample,
    IReadOnlyList<string> StagingOnlySample);

public sealed record StagingRepresentationStatus(
    bool Available,
    string Verdict,
    string Headline,
    string Summary,
    bool ConfigMatchesGit,
    bool EntityRegistryAligned,
    bool PresenceMatches,
    bool GitClean,
    IReadOnlyList<RepresentationIssue> Issues);

public sealed record RepresentationIssue(
    string Severity,
    string Category,
    string Title,
    string Detail,
    IReadOnlyList<string> Samples);

public sealed record MqttBridgeStats(
    bool Available,
    bool BridgeConnected,
    int ConnectedClients,
    int RecentEvents,
    IReadOnlyList<MqttActivityBucket> ActivityBuckets);

public sealed record MqttActivityBucket(DateTimeOffset At, int Events);

public sealed record PollHistoryPoint(DateTimeOffset At, int Count, bool Ok);

public sealed record LovelaceEntityReference(
    string Source,
    string? Dashboard,
    string View,
    string? CardType,
    string? CardTitle);

public sealed record LovelaceFixOption(
    string Id,
    string Label,
    string Action,
    string? ReplacementEntityId,
    string? Description);

public sealed record LovelaceEntityChoice(
    string EntityId,
    string Source,
    string Label,
    string Hint,
    bool CanApplyInRepo);

public sealed record ProdRegistryTombstoneDetail(
    string EntityId,
    string? UniqueId,
    string? Platform,
    string? CreatedAt,
    string? Label);

public sealed record ProdEntityContext(
    string? SimilarProdEntityId,
    string? Platform,
    string? DeviceName,
    string? UniqueId,
    string? IntegrationHint,
    bool ExpectedEntityDeletedOnProd,
    IReadOnlyList<string> DeletedRegistryEntityIds,
    IReadOnlyList<ProdRegistryTombstoneDetail> DeletedRegistryTombstones,
    string? LiveDeviceUniquePrefix,
    string? TombstoneDeviceUniquePrefix,
    bool TombstoneMatchesLiveDevice,
    string? EntityIdOccupiedBy = null,
    string? EntityIdOccupiedByPlatform = null,
    string? EntityIdOccupiedByDisabledBy = null,
    IReadOnlyList<string>? ProdFixSteps = null,
    string? ProdFixAction = null);

public sealed record Z2mStaleConfigEntry(
    string Ieee,
    string FriendlyName,
    bool InStateJson);

public sealed record Z2mStaleConfigIssue(
    string ExpectedFriendlyName,
    string LiveIeee,
    string LiveFriendlyName,
    IReadOnlyList<Z2mStaleConfigEntry> StaleEntries,
    string Summary,
    IReadOnlyList<LovelaceFixOption> FixOptions,
    bool BlocksDeploy = true);

public sealed record Z2mConfigFixRequest(
    string LiveIeee,
    string ExpectedFriendlyName,
    IReadOnlyList<string>? StaleIpees);

public sealed record LovelaceMissingEntityIssue(
    string EntityId,
    bool OnStaging,
    string SuggestionKind,
    string IssueClass,
    string Suggestion,
    string ManualFixSummary,
    string? SuggestedProdEntity,
    ProdEntityContext? ProdContext,
    IReadOnlyList<LovelaceEntityReference> References,
    IReadOnlyList<LovelaceFixOption> FixOptions,
    IReadOnlyList<LovelaceEntityChoice>? EntityChoices,
    string? AwaitingPublishAction = null);

public sealed record EntityDeployRecheckDelta(
    IReadOnlyList<string> ResolvedEntityIds,
    IReadOnlyList<string> NewEntityIds,
    DateTimeOffset? PreviousScanAt);

public sealed record ProdStoragePreflightResult(
    bool Ok,
    int EntityRefCount,
    int BlockerCount,
    int DeferredCount,
    IReadOnlyList<string> MissingEntities,
    IReadOnlyList<LovelaceMissingEntityIssue> MissingEntityIssues,
    IReadOnlyList<LovelaceMissingEntityIssue> DeferredEntityIssues,
    IReadOnlyList<string> MissingCustomCards,
    IReadOnlyList<string> Issues,
    bool PendingCommit,
    int DeployIssueCount,
    int FixedLocallyCount,
    EntityDeployRecheckDelta? Recheck,
    bool CanUndoLovelaceFix,
    string? LovelaceUndoDescription,
    IReadOnlyList<Z2mStaleConfigIssue> Z2mConfigIssues,
    IReadOnlyList<LovelaceMissingEntityIssue> DeployMissingEntityIssues,
    bool AllowProdRegistryPurge);

public sealed record LovelaceParityFixRequest(
    string EntityId,
    string Action,
    string? ReplacementEntityId);

public sealed record PurgeProdDeletedEntitiesRequest(string EntityId, string? SimilarProdEntityId);

public sealed record FixProdEntitySuffixRequest(string ExpectedEntityId, string SuffixProdEntityId);

public sealed record FixProdEntityIdRequest(string ExpectedEntityId, string WrongProdEntityId);

public sealed record LovelaceParityFixResult(
    bool Ok,
    string Message,
    IReadOnlyList<string> FilesChanged,
    int ChangeCount);

public sealed record DiagnosticsStatus(
    IReadOnlyList<SubsystemStatus> Subsystems,
    IReadOnlyList<ComponentIssue> Issues,
    IReadOnlyList<ComponentIssue> HaIssues,
    IReadOnlyList<PollHistoryPoint> PollHistory,
    SyncActivitySnapshot? SyncActivity,
    IReadOnlyList<string> SyncLogLines,
    IReadOnlyList<string> MqttLogLines,
    HaLogSnapshot ProdHaLog,
    HaLogSnapshot StagingHaLog,
    bool MirrorConfigured,
    string SyncLogPath,
    string? MqttLogPath,
    DateTimeOffset RefreshedAt,
    IReadOnlyList<OperationLogEntry> OperationLog,
    string? StagingHaUrl,
    string? ProdHaUrl);

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

public sealed record AppearanceSettings(
    string ThemeMode = "dark",
    string BadgeColor = "#ffb74d",
    string AccentColor = "#03a9f4",
    string Density = "comfortable",
    string FontScale = "default",
    bool ReduceMotion = false,
    string StatusIntensity = "default",
    bool HideNavBadges = false,
    bool HighContrast = false);

public sealed record SettingsView(
    PathSettings Paths,
    ProdSettings Prod,
    StagingSettings Staging,
    MirrorSettings Mirror,
    TopologySettings Topology,
    SidecarIntervals Intervals,
    string? StagingHaContainer,
    StagingTargetSnapshot? StagingTarget,
    AppearanceSettings Appearance);

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
    string? StagingHaContainer,
    AppearanceSettings Appearance);

public sealed record OperationResult(bool Ok, string Message, string? LogTail);

public sealed record OperationLogEntry(
    string Operation,
    bool Ok,
    string Message,
    string? LogTail,
    DateTimeOffset When);

public sealed record MirrorModeRequest(bool ControlMode);
