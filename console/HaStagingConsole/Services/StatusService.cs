using System.Text.RegularExpressions;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed partial class StatusService(
    KitPaths paths,
    SidecarRunner sidecar,
    OnboardingStore store,
    OnboardingBootstrap bootstrap,
    DashboardBuilder dashboard,
    StagingTargetBuilder stagingTarget)
{
    public async Task<DashboardStatus> GetDashboardAsync(CancellationToken ct)
    {
        var env = EnvFile.Read(paths.EnvFile);
        var state = bootstrap.LoadOrBootstrap();
        var onboarding = store.ToStatus(state);
        var stagingUrl = env.GetValueOrDefault("STAGING_HA_URL", state.Staging.Url);
        var prodUrl = env.GetValueOrDefault("PROD_HA_URL", state.Prod.Url);
        var stagingTargetInfo = await stagingTarget.BuildAsync(state, env, ct);

        var syncRunning = await sidecar.IsSyncLoopRunningAsync(ct);
        var syncLogs = await sidecar.SyncLogTailAsync(400, ct);

        var subsystems = new List<SubsystemStatus>
        {
            new(
                "Config sync",
                syncRunning ? "pass" : "fail",
                syncRunning ? "Sync loop running" : $"Sync loop not running — see kit data sync.log ({paths.SyncLogLocation})"),
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

        var git = await dashboard.GetGitSnapshotAsync(env, ct);
        var personSync = dashboard.ParsePersonSync(syncLogs);
        var pollHistory = dashboard.ParsePollHistory(syncLogs);
        var syncLogTail = dashboard.TailSyncLog(syncLogs);
        var drift = dashboard.GetConfigDrift(git);
        var presence = await dashboard.GetPresenceSummaryAsync(ct);
        var readiness = dashboard.BuildReadiness(onboarding, syncRunning, git);
        var issues = CollectIssues(subsystems, syncLogs, env);
        var suggested = dashboard.BuildSuggestedAction(issues, subsystems, drift, mirrorStatus.Configured ? mirrorStatus : null, readiness);

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
            syncLogTail,
            pollHistory,
            issues,
            DateTimeOffset.Now);
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
        Dictionary<string, string> env)
    {
        var issues = new List<ComponentIssue>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

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
            Add("Config sync", line.Level, line.Message);

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

    static IEnumerable<(string Level, string Message)> ExtractLogIssues(string logs)
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

            yield return (level, msg);
        }
    }

    static string? ClassifyLogLine(string line)
    {
        if (ErrorLogPattern().IsMatch(line))
            return "error";
        if (WarnLogPattern().IsMatch(line))
            return "warn";
        return null;
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
