using System.Globalization;
using System.Text.RegularExpressions;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed partial class StatusService(
    KitPaths paths,
    SidecarRunner sidecar,
    OnboardingStore store,
    OnboardingBootstrap bootstrap,
    DashboardBuilder dashboard,
    StagingTargetBuilder stagingTarget,
    LiveMetricsStore liveMetrics,
    HaInstanceDiagnostics haDiagnostics,
    ProdWritesGuard prodWrites)
{
    public async Task<DashboardStatus> GetDashboardAsync(CancellationToken ct)
    {
        // Overall timeout so the endpoint never hangs indefinitely regardless of backend slowness.
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(25));
        ct = cts.Token;

        var env = EnvFile.Read(paths.EnvFile);
        var state = bootstrap.LoadOrBootstrap();
        var onboarding = store.ToStatus(state);
        var stagingUrl = env.GetValueOrDefault("STAGING_HA_URL", state.Staging.Url);
        var prodUrl = env.GetValueOrDefault("PROD_HA_URL", state.Prod.Url);

        // Fire all independent async work in parallel — was sequential and could accumulate 15-20+ seconds
        var stagingTargetTask    = stagingTarget.BuildAsync(state, env, ct);
        var syncRunningTask      = sidecar.IsSyncLoopRunningAsync(ct);
        var syncLogsTask         = sidecar.SyncLogTailAsync(8000, ct);
        var checkProdHaTask      = dashboard.CheckHaAsync("Production HA", prodUrl, ct);
        var mirrorRunningTask    = sidecar.IsMirrorRunningAsync(ct);
        var gitTask              = dashboard.GetGitSnapshotAsync(env, ct);
        var presenceTask         = dashboard.GetPresenceSummaryAsync(ct);
        var prodMonitoringTask   = dashboard.GetInstanceMonitoringAsync(prodUrl, paths.ProdTokenFile, ct);
        var stagingMonitoringTask = dashboard.GetInstanceMonitoringAsync(stagingUrl, paths.StagingTokenFile, ct);
        var entityParityTask     = dashboard.GetEntityParityAsync(ct);
        var prodProbeTask        = dashboard.ProbeHaReachabilityAsync(prodUrl, paths.ProdTokenFile, ct);
        var stagingProbeTask     = dashboard.ProbeHaReachabilityAsync(stagingUrl, paths.StagingTokenFile, ct);
        var automationActivityTask = dashboard.GetAutomationActivityAsync(prodUrl, stagingUrl, ct);
        var prodHaIssuesTask = haDiagnostics.CollectIssuesAsync("Production HA", prodUrl, paths.ProdTokenFile, ct);
        var stagingHaIssuesTask = haDiagnostics.CollectIssuesAsync("Staging HA", stagingUrl, paths.StagingTokenFile, ct);

        await Task.WhenAll(
            stagingTargetTask, syncRunningTask, syncLogsTask, checkProdHaTask,
            mirrorRunningTask, gitTask, presenceTask, prodMonitoringTask,
            stagingMonitoringTask, entityParityTask, prodProbeTask, stagingProbeTask,
            automationActivityTask, prodHaIssuesTask, stagingHaIssuesTask);

        var stagingTargetInfo  = stagingTargetTask.Result;
        var syncRunning        = syncRunningTask.Result;
        var syncLogs           = syncLogsTask.Result;
        var mirrorRunning      = mirrorRunningTask.Result;
        var git                = gitTask.Result;
        var presence           = presenceTask.Result;
        var prodMonitoring     = prodMonitoringTask.Result;
        var stagingMonitoring  = stagingMonitoringTask.Result;
        var entityParity       = entityParityTask.Result;
        var prodProbe          = prodProbeTask.Result;
        var stagingProbe       = stagingProbeTask.Result;
        var automationActivity = automationActivityTask.Result;
        var haIssues = MergeHaIssues(prodHaIssuesTask.Result, stagingHaIssuesTask.Result);

        // drift depends on git — must come after Group 1
        var drift = await dashboard.GetConfigDriftAsync(git, ct);

        var mirrorStatus = GetMirrorRuntime(env) with { Running = mirrorRunning };
        var subsystems = new List<SubsystemStatus>
        {
            new(
                "Config sync",
                syncRunning ? "pass" : "fail",
                syncRunning ? "Sync loop running" : $"Sync loop not running — see kit data sync.log ({paths.SyncLogLocation})"),
            checkProdHaTask.Result,
            BuildStagingSubsystem(stagingTargetInfo),
        };

        if (mirrorStatus.Configured)
        {
            subsystems.Add(new SubsystemStatus(
                "MQTT mirror",
                mirrorRunning ? "pass" : "warn",
                mirrorRunning ? $"Running — {mirrorStatus.Mode}" : "Configured but mosquitto not running"));
        }
        else
        {
            subsystems.Add(new SubsystemStatus("MQTT mirror", "skip", "Not configured"));
        }

        SidecarRuntimeStatus? sidecarRuntime = null;
        if (syncRunning)
        {
            sidecarRuntime = new SidecarRuntimeStatus(
                true,
                FormatPersonSyncLine(FindLastLine(syncLogs, PersonSyncPattern())),
                FormatPersonSyncLine(FindLastLine(syncLogs, ApplyPattern()), raw: true),
                FormatPersonSyncLine(FindLastLine(syncLogs, StoragePattern()), raw: true),
                EnvFile.GetInt(paths.ConfigEnvFile, "PERSON_POLL_INTERVAL", 60),
                EnvFile.GetInt(paths.ConfigEnvFile, "STORAGE_SYNC_INTERVAL", 86400));
        }

        var personSync = dashboard.ParsePersonSync(syncLogs);
        var syncActivity = dashboard.ParseSyncActivity(syncLogs, personSync);
        var pollHistory = dashboard.ParsePollHistory(syncLogs);
        var syncLogTail = dashboard.TailSyncLog(syncLogs);
        var configInventory = dashboard.GetConfigInventory();
        var stagingRepresentation = dashboard.BuildStagingRepresentation(git, drift, entityParity, presence);
        var mirrorData = env.GetValueOrDefault("MIRROR_DATA", "");
        var mqttBridge = dashboard.GetMqttBridgeStats(mirrorData, mirrorRunning);
        var readiness = dashboard.BuildReadiness(onboarding, syncRunning, git);
        var issues = CollectIssues(subsystems, syncLogs, env, personSync);
        var suggested = dashboard.BuildSuggestedAction(
            MergeIssues(issues, haIssues), subsystems, drift, mirrorStatus.Configured ? mirrorStatus : null, readiness, syncActivity);

        if (prodProbe.Available || stagingProbe.Available)
        {
            liveMetrics.RecordReachability(
                prodProbe.LatencyMs,
                prodProbe.Reachable,
                stagingProbe.LatencyMs,
                stagingProbe.Reachable);
        }

        var bridgeConnected = mqttBridge?.BridgeConnected ?? false;
        if (mirrorStatus.Configured)
            liveMetrics.RecordBridge(bridgeConnected);

        BridgeUptimeSnapshot? bridgeUptime = null;
        if (mirrorStatus.Configured)
        {
            bridgeUptime = dashboard.GetBridgeUptime(mirrorData, mirrorRunning, bridgeConnected);
            if (bridgeUptime is not null)
            {
                bridgeUptime = bridgeUptime with { PollHistory = liveMetrics.GetBridgeHistory() };
            }
        }
        var liveMetricsSnapshot = new LiveMetricsSnapshot(
            BuildLiveStatusChips(git, mirrorStatus, stagingTargetInfo, mqttBridge),
            new HaReachabilitySnapshot(
                prodProbe.Available || stagingProbe.Available,
                prodProbe.LatencyMs,
                prodProbe.Reachable,
                stagingProbe.LatencyMs,
                stagingProbe.Reachable,
                liveMetrics.GetReachabilityHistory()),
            bridgeUptime,
            automationActivity);

        return new DashboardStatus(
            onboarding.IsComplete,
            subsystems,
            sidecarRuntime,
            mirrorStatus.Configured ? mirrorStatus : null,
            string.IsNullOrWhiteSpace(stagingUrl) ? null : stagingUrl,
            string.IsNullOrWhiteSpace(prodUrl) ? null : prodUrl,
            stagingTargetInfo,
            git,
            personSync,
            presence,
            drift,
            readiness,
            suggested,
            syncActivity,
            configInventory,
            prodMonitoring,
            stagingMonitoring,
            entityParity,
            stagingRepresentation,
            mqttBridge,
            syncLogTail,
            pollHistory,
            issues,
            haIssues,
            liveMetricsSnapshot,
            DateTimeOffset.Now,
            prodWrites.GetView());
    }

    static LiveStatusChips BuildLiveStatusChips(
        GitSnapshotStatus? git,
        MirrorRuntimeStatus mirrorStatus,
        StagingTargetSnapshot target,
        MqttBridgeStats? mqttBridge)
    {
        GitLiveChip? gitChip = git is { Configured: true }
            ? new GitLiveChip(
                true,
                git.Branch,
                git.CommitHash,
                git.IsHaDirty,
                git.HaChangedFileCount,
                git.IsRepoDirty,
                git.RepoChangedFileCount,
                git.CommitsAhead,
                git.CommitsBehind)
            : null;

        MirrorLiveChip? mirrorChip = mirrorStatus.Configured
            ? new MirrorLiveChip(
                true,
                mirrorStatus.Running,
                mirrorStatus.Mode,
                mqttBridge?.BridgeConnected ?? false,
                mirrorStatus.ProdMqttHost,
                mirrorStatus.ProdMqttPort)
            : null;

        StagingLiveChip? stagingChip = string.IsNullOrWhiteSpace(target.Url)
            ? null
            : new StagingLiveChip(
                target.ApiReachable,
                target.ContainerRunning,
                target.Version,
                target.InstallLabel,
                target.ContainerName);

        return new LiveStatusChips(gitChip, mirrorChip, stagingChip);
    }

    public async Task<DiagnosticsStatus> GetDiagnosticsAsync(CancellationToken ct, IReadOnlyList<OperationLogEntry>? opLog = null)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(RequestDeadline.Diagnostics);
        ct = cts.Token;

        var env = EnvFile.Read(paths.EnvFile);
        var state = bootstrap.LoadOrBootstrap();
        var prodUrl = env.GetValueOrDefault("PROD_HA_URL", state.Prod.Url);
        var stagingUrl = env.GetValueOrDefault("STAGING_HA_URL", state.Staging.Url);
        var stagingTargetInfo = await stagingTarget.BuildAsync(state, env, ct);

        var syncRunning = await sidecar.IsSyncLoopRunningAsync(ct);
        var syncLogs = await sidecar.SyncLogTailAsync(8000, ct);
        var prodHaIssuesTask = haDiagnostics.CollectIssuesAsync("Production HA", prodUrl, paths.ProdTokenFile, ct);
        var stagingHaIssuesTask = haDiagnostics.CollectIssuesAsync("Staging HA", stagingUrl, paths.StagingTokenFile, ct);

        await Task.WhenAll(prodHaIssuesTask, stagingHaIssuesTask);
        var rawHaIssues = MergeHaIssues(prodHaIssuesTask.Result, stagingHaIssuesTask.Result);
        var prodDomains = rawHaIssues
            .Where(i => i.Source == "Production HA" && IsIntegrationDomain(i.Domain))
            .Select(i => i.Domain!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var stagingDomains = rawHaIssues
            .Where(i => i.Source == "Staging HA" && IsIntegrationDomain(i.Domain))
            .Select(i => i.Domain!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var stagingConfigPath = FirstNonEmptyPath(
            stagingTargetInfo.HaConfigDir,
            stagingTargetInfo.ConfigPath,
            env.GetValueOrDefault("HA_STAGING_CONFIG"),
            "/ha-config");
        var prodHaLogTask = haDiagnostics.FetchCoreLogAsync(
            "Production HA",
            prodUrl,
            paths.ProdTokenFile,
            stagingTargetInfo.ProdHaType,
            null,
            "/config",
            prodDomains,
            ct);
        var stagingContainer = env.GetValueOrDefault("STAGING_HA_CONTAINER", "Home-Assistant-Container").Trim();
        var stagingHaLogTask = haDiagnostics.FetchCoreLogAsync(
            "Staging HA",
            stagingUrl,
            paths.StagingTokenFile,
            stagingTargetInfo.InstallType,
            string.IsNullOrWhiteSpace(stagingContainer) ? null : stagingContainer,
            stagingConfigPath,
            stagingDomains,
            ct);

        await Task.WhenAll(prodHaLogTask, stagingHaLogTask);

        var haIssues = HaInstanceDiagnostics.EnrichIssuesFromLogs(
            rawHaIssues,
            prodHaLogTask.Result,
            stagingHaLogTask.Result);

        var subsystems = new List<SubsystemStatus>
        {
            new(
                "Config sync",
                syncRunning ? "pass" : "fail",
                syncRunning ? "Sync loop running" : $"Sync loop not running — see {paths.SyncLogLocation}"),
            await dashboard.CheckHaAsync("Production HA", prodUrl, ct),
            BuildStagingSubsystem(stagingTargetInfo),
        };

        var mirrorRunning = await sidecar.IsMirrorRunningAsync(ct);
        var mirrorStatus = GetMirrorRuntime(env) with { Running = mirrorRunning };
        if (mirrorStatus.Configured)
        {
            subsystems.Add(new SubsystemStatus(
                "MQTT mirror",
                mirrorRunning ? "pass" : "warn",
                mirrorRunning ? $"Running — {mirrorStatus.Mode}" : "Configured but mosquitto not running"));
        }
        else
        {
            subsystems.Add(new SubsystemStatus("MQTT mirror", "skip", "Not configured"));
        }

        var personSync = dashboard.ParsePersonSync(syncLogs);
        var syncActivity = dashboard.ParseSyncActivity(syncLogs, personSync);
        var pollHistory = dashboard.ParsePollHistory(syncLogs);
        var issues = CollectIssues(subsystems, syncLogs, env, personSync);

        var syncLogLines = syncLogs
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .TakeLast(300)
            .ToList();

        var mirrorData = env.GetValueOrDefault("MIRROR_DATA", "");
        var mqttLogPath = string.IsNullOrWhiteSpace(mirrorData)
            ? null
            : Path.Combine(mirrorData, "log", "mosquitto.log");
        var mqttLogLines = new List<string>();
        if (!string.IsNullOrWhiteSpace(mqttLogPath) && File.Exists(mqttLogPath))
        {
            try
            {
                mqttLogLines = File.ReadAllLines(mqttLogPath).TakeLast(200).ToList();
            }
            catch
            {
                /* best effort */
            }
        }

        return new DiagnosticsStatus(
            subsystems,
            issues,
            haIssues,
            pollHistory,
            syncActivity,
            syncLogLines,
            mqttLogLines,
            prodHaLogTask.Result,
            stagingHaLogTask.Result,
            mirrorStatus.Configured,
            paths.SyncLogLocation,
            mqttLogPath,
            DateTimeOffset.Now,
            opLog ?? [],
            stagingUrl,
            prodUrl);
    }

    static SubsystemStatus BuildStagingSubsystem(StagingTargetSnapshot target)
    {
        if (string.IsNullOrWhiteSpace(target.Url))
            return new SubsystemStatus("Staging HA", "warn", "URL not configured");

        if (!target.ApiReachable)
        {
            return new SubsystemStatus(
                "Staging HA",
                "warn",
                "API not reachable — check URL and staging write token");
        }

        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(target.Version))
            parts.Add(target.Version);
        parts.Add(target.InstallLabel);
        if (!target.AddonsAvailable)
            parts.Add("no add-on store");
        if (!string.IsNullOrWhiteSpace(target.ContainerName))
            parts.Add(target.ContainerRunning ? $"{target.ContainerName} running" : $"{target.ContainerName} stopped");

        var status = target.ContainerRunning || target.InstallType == "ha_os" ? "pass" : "warn";
        return new SubsystemStatus("Staging HA", status, string.Join(" · ", parts));
    }

    List<ComponentIssue> CollectIssues(
        IReadOnlyList<SubsystemStatus> subsystems,
        string syncLogs,
        Dictionary<string, string> env,
        PersonSyncSnapshot? personSync = null)
    {
        var issues = new List<ComponentIssue>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var activePersonPollFailures = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var activePersonPollPushFailures = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var disableEntryFailures = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var lastStoragePatchSuccess = ParseLastStoragePatchSuccess(syncLogs);

        void Add(string source, string level, string message)
        {
            var key = $"{source}|{message}";
            if (!seen.Add(key))
                return;
            issues.Add(new ComponentIssue(source, level, message));
        }

        foreach (var s in subsystems)
        {
            if (s.Status is "fail" or "warn")
                Add(s.Name, s.Status == "fail" ? "error" : "warn", s.Detail);
        }

        foreach (var line in ExtractLogIssues(syncLogs))
        {
            if (IsPersonPollFetchFailure(line.Message))
            {
                // Log tail truncation can leave a partial first line with no timestamp.
                if (line.At is null)
                    continue;

                if (IsRecoveredPersonPollFailure(line.At, personSync))
                    continue;

                var entity = ExtractPersonPollEntity(line.Message);
                if (!string.IsNullOrWhiteSpace(entity))
                    activePersonPollFailures.Add(entity);
                continue;
            }

            if (IsPersonPollStagingPushFailure(line.Message))
            {
                // Log tail truncation can leave a partial first line with no timestamp.
                if (line.At is null)
                    continue;

                if (IsRecoveredPersonPollFailure(line.At, personSync))
                    continue;

                var entity = ExtractPersonPollStagingPushEntity(line.Message);
                if (!string.IsNullOrWhiteSpace(entity))
                    activePersonPollPushFailures.Add(entity);
                continue;
            }

            if (TryParseDisableEntryFailure(line.Message, out var domain))
            {
                disableEntryFailures[domain] = disableEntryFailures.GetValueOrDefault(domain) + 1;
                continue;
            }

            if (IsStoragePatchFailure(line.Message))
            {
                if (line.At is null)
                    continue;

                if (IsRecoveredStoragePatchFailure(line.At, lastStoragePatchSuccess))
                    continue;
            }

            Add("Config sync", line.Level, line.Message);
        }

        if (activePersonPollFailures.Count > 0)
        {
            var count = activePersonPollFailures.Count;
            Add(
                "Config sync",
                "warn",
                count == 1
                    ? $"Person poll failed to fetch prod state for {activePersonPollFailures.First()}"
                    : $"Person poll failed to fetch {count} prod states — staging presence may be stale");
        }

        if (activePersonPollPushFailures.Count > 0)
        {
            var count = activePersonPollPushFailures.Count;
            Add(
                "Config sync",
                "warn",
                count == 1
                    ? $"Person poll could not push {activePersonPollPushFailures.First()} to staging — check staging write token"
                    : $"Person poll could not push {count} person/tracker states to staging — check staging write token");
        }

        if (disableEntryFailures.Count > 0)
        {
            var total = disableEntryFailures.Values.Sum();
            var domains = string.Join(", ", disableEntryFailures.Keys.OrderBy(d => d));
            Add(
                "Config sync",
                "warn",
                total == 1
                    ? $"Staging could not disable 1 LAN integration config entry ({domains}) — YAML guards still apply"
                    : $"Staging could not disable {total} LAN integration config entries ({domains}) — YAML guards still apply");
        }

        var mirrorData = env.GetValueOrDefault("MIRROR_DATA", "");
        if (!string.IsNullOrWhiteSpace(mirrorData))
        {
            var mosquittoLog = Path.Combine(mirrorData, "log", "mosquitto.log");
            if (File.Exists(mosquittoLog))
            {
                try
                {
                    var tail = TailFile(mosquittoLog, 80);
                    foreach (var line in ExtractLogIssues(tail))
                        Add("MQTT mirror", line.Level, line.Message);
                }
                catch
                {
                    /* best effort */
                }
            }
        }

        return issues.TakeLast(12).ToList();
    }

    static IReadOnlyList<ComponentIssue> MergeHaIssues(
        HaInstanceDiagnosticsSnapshot prod,
        HaInstanceDiagnosticsSnapshot staging) =>
        prod.Issues.Concat(staging.Issues).ToList();

    static IReadOnlyList<ComponentIssue> MergeIssues(
        IReadOnlyList<ComponentIssue> kitIssues,
        IReadOnlyList<ComponentIssue> haIssues) =>
        kitIssues.Concat(haIssues).ToList();

    static string? FirstNonEmptyPath(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
                return value.Trim();
        }

        return null;
    }

    static bool IsIntegrationDomain(string? domain) =>
        !string.IsNullOrWhiteSpace(domain)
        && !string.Equals(domain, "_kit", StringComparison.OrdinalIgnoreCase);

    static IEnumerable<(string Level, string Message, DateTimeOffset? At)> ExtractLogIssues(string logs)
    {
        foreach (var raw in logs.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0)
                continue;

            var level = ClassifyLogLine(line);
            if (level is null)
                continue;

            var msg = line;
            const string syncPrefix = "ha-staging-kit-sync: ";
            if (msg.StartsWith(syncPrefix, StringComparison.Ordinal))
                msg = msg[syncPrefix.Length..];

            yield return (level, msg, ParseLogTimestamp(line));
        }
    }

    static string? ClassifyLogLine(string line)
    {
        // Explicit WARN must win over "failed" in the message body.
        if (WarnLogPattern().IsMatch(line))
            return "warn";
        if (ErrorLogPattern().IsMatch(line))
            return "error";
        return null;
    }

    static bool IsPersonPollFetchFailure(string message) =>
        message.Contains("failed prod fetch for", StringComparison.OrdinalIgnoreCase);

    static bool IsPersonPollStagingPushFailure(string message) =>
        message.Contains("failed staging push for", StringComparison.OrdinalIgnoreCase);

    static bool IsRecoveredPersonPollFailure(DateTimeOffset? at, PersonSyncSnapshot? personSync) =>
        personSync?.LastAt is not null
        && at is not null
        && at < personSync.LastAt;

    static bool IsStoragePatchFailure(string message) =>
        message.Contains("staging storage patch failed", StringComparison.OrdinalIgnoreCase);

    static bool IsRecoveredStoragePatchFailure(DateTimeOffset? at, DateTimeOffset? lastPatchSuccess) =>
        lastPatchSuccess is not null
        && at is not null
        && at < lastPatchSuccess;

    static DateTimeOffset? ParseLastStoragePatchSuccess(string logs)
    {
        DateTimeOffset? last = null;
        foreach (var raw in logs.Split('\n'))
        {
            if (!raw.Contains("Patched staging MQTT broker", StringComparison.OrdinalIgnoreCase))
                continue;

            var at = ParseLogTimestamp(raw);
            if (at is not null)
                last = at;
        }

        return last;
    }

    static string? ExtractPersonPollEntity(string message)
    {
        const string marker = "failed prod fetch for ";
        var idx = message.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (idx < 0)
            return null;
        return message[(idx + marker.Length)..].Trim();
    }

    static string? ExtractPersonPollStagingPushEntity(string message)
    {
        const string marker = "failed staging push for ";
        var idx = message.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (idx < 0)
            return null;
        return message[(idx + marker.Length)..].Trim();
    }

    static bool TryParseDisableEntryFailure(string message, out string domain)
    {
        domain = "";
        const string marker = "failed to disable config entry ";
        var idx = message.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (idx < 0)
            return false;

        var tail = message[(idx + marker.Length)..];
        var paren = tail.LastIndexOf('(');
        if (paren < 0 || !tail.EndsWith(')'))
            return false;

        domain = tail[(paren + 1)..^1].Trim();
        return domain.Length > 0;
    }

    static DateTimeOffset? ParseLogTimestamp(string line)
    {
        var match = LogTimestampPattern().Match(line);
        if (!match.Success)
            return null;

        return DateTimeOffset.TryParseExact(
            match.Groups["at"].Value,
            "yyyy-MM-dd HH:mm:ss",
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeLocal,
            out var parsed)
            ? parsed
            : null;
    }

    static string TailFile(string path, int lines)
    {
        var all = File.ReadAllLines(path);
        if (all.Length <= lines)
            return string.Join('\n', all);
        return string.Join('\n', all[^lines..]);
    }

    MirrorRuntimeStatus GetMirrorRuntime(Dictionary<string, string> env)
    {
        var mirrorData = env.GetValueOrDefault("MIRROR_DATA", "");
        var host = env.GetValueOrDefault("PROD_MQTT_HOST", "");
        var port = int.TryParse(env.GetValueOrDefault("PROD_MQTT_PORT", "1883"), out var p) ? p : 1883;
        var configured = !string.IsNullOrWhiteSpace(mirrorData)
            && Directory.Exists(Path.Combine(mirrorData, "config"));

        var mode = "read-only";
        var stateFile = string.IsNullOrWhiteSpace(mirrorData) ? "" : Path.Combine(mirrorData, "control-mode");
        if (File.Exists(stateFile))
        {
            var text = File.ReadAllText(stateFile).Trim();
            if (!string.IsNullOrWhiteSpace(text))
                mode = text;
        }

        return new MirrorRuntimeStatus(false, configured, mode, host, port);
    }

    static string? FormatPersonSyncLine(string? line, bool raw = false)
    {
        if (string.IsNullOrWhiteSpace(line))
            return null;

        if (!raw)
        {
            var match = PersonCountPattern().Match(line);
            if (match.Success)
            {
                var count = match.Groups[1].Value;
                return $"Last poll synced {count} person/tracker state(s) from production";
            }
        }

        var trimmed = line.Trim();
        const string prefix = "ha-staging-kit-sync: ";
        return trimmed.StartsWith(prefix, StringComparison.Ordinal) ? trimmed[prefix.Length..] : trimmed;
    }

    static string? FindLastLine(string logs, Regex pattern)
    {
        string? last = null;
        foreach (var line in logs.Split('\n'))
        {
            if (pattern.IsMatch(line))
                last = line.Trim();
        }
        return last;
    }

    [GeneratedRegex(@"\[(?<at>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]")]
    private static partial Regex LogTimestampPattern();

    [GeneratedRegex(@"\b(ERROR|Error:|fatal|failed)\b", RegexOptions.IgnoreCase)]
    private static partial Regex ErrorLogPattern();

    [GeneratedRegex(@"\b(WARN|Warning:)\b", RegexOptions.IgnoreCase)]
    private static partial Regex WarnLogPattern();

    [GeneratedRegex(@"Synced (\d+) person/tracker", RegexOptions.IgnoreCase)]
    private static partial Regex PersonCountPattern();

    [GeneratedRegex("Synced|person-poller", RegexOptions.IgnoreCase)]
    private static partial Regex PersonSyncPattern();

    [GeneratedRegex("apply-config|Applied|git pull", RegexOptions.IgnoreCase)]
    private static partial Regex ApplyPattern();

    [GeneratedRegex("sync-storage|Storage sync", RegexOptions.IgnoreCase)]
    private static partial Regex StoragePattern();
}
