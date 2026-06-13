using System.Diagnostics;
using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed partial class DashboardBuilder(
    KitPaths paths,
    IHttpClientFactory httpClientFactory)
{
    public async Task<GitSnapshotStatus> GetGitSnapshotAsync(Dictionary<string, string> env, CancellationToken ct)
    {
        if (!Directory.Exists("/repo/.git"))
            return new GitSnapshotStatus(false, null, null, null, null, false);

        var branch = env.GetValueOrDefault("HA_BRANCH", "staging");
        var head = await RunGitAsync("/repo", "rev-parse", "--short", "HEAD");
        var subject = await RunGitAsync("/repo", "log", "-1", "--format=%s");
        var dateRaw = await RunGitAsync("/repo", "log", "-1", "--format=%cI");
        var status = await RunGitAsync("/repo", "status", "--porcelain");
        var currentBranch = await RunGitAsync("/repo", "rev-parse", "--abbrev-ref", "HEAD");

        DateTimeOffset? commitDate = null;
        if (DateTimeOffset.TryParse(dateRaw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed))
            commitDate = parsed;

        return new GitSnapshotStatus(
            true,
            string.IsNullOrWhiteSpace(currentBranch) ? branch : currentBranch,
            string.IsNullOrWhiteSpace(head) ? null : head,
            string.IsNullOrWhiteSpace(subject) ? null : subject,
            commitDate,
            !string.IsNullOrWhiteSpace(status));
    }

    public ConfigDriftStatus GetConfigDrift(GitSnapshotStatus? git)
    {
        if (git is not { Configured: true } || string.IsNullOrWhiteSpace(git.CommitHash))
            return new ConfigDriftStatus(false, null, null, "Git repo not available");

        var marker = Path.Combine(paths.SidecarData, "last-applied-commit");
        if (!File.Exists(marker))
            return new ConfigDriftStatus(
                true,
                git.CommitHash,
                null,
                "Config has not been applied since tracking started — run Apply staging config");

        var applied = File.ReadAllText(marker).Trim();
        var appliedShort = applied.Length > 7 ? applied[..7] : applied;
        if (applied.StartsWith(git.CommitHash, StringComparison.OrdinalIgnoreCase)
            || git.CommitHash.StartsWith(appliedShort, StringComparison.OrdinalIgnoreCase))
        {
            return new ConfigDriftStatus(false, git.CommitHash, appliedShort, "Staging matches latest git commit");
        }

        return new ConfigDriftStatus(
            true,
            git.CommitHash,
            appliedShort,
            $"Git is at {git.CommitHash} but last apply was {appliedShort}");
    }

    public PersonSyncSnapshot ParsePersonSync(string logs)
    {
        Match? last = null;
        foreach (Match match in PersonSyncLinePattern().Matches(logs))
            last = match;

        if (last is null)
            return new PersonSyncSnapshot(null, null, null);

        var count = int.TryParse(last.Groups["count"].Value, out var n) ? n : (int?)null;
        DateTimeOffset? at = null;
        if (DateTimeOffset.TryParseExact(
                last.Groups["at"].Value,
                "yyyy-MM-dd HH:mm:ss",
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal,
                out var parsed))
        {
            at = parsed;
        }

        return new PersonSyncSnapshot(count, at, at is null ? null : FormatRelative(at.Value));
    }

    public IReadOnlyList<PollHistoryPoint> ParsePollHistory(string logs)
    {
        var points = new List<PollHistoryPoint>();
        foreach (Match match in PersonSyncLinePattern().Matches(logs))
        {
            if (!DateTimeOffset.TryParseExact(
                    match.Groups["at"].Value,
                    "yyyy-MM-dd HH:mm:ss",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeLocal,
                    out var at))
            {
                continue;
            }

            if (!int.TryParse(match.Groups["count"].Value, out var count))
                continue;

            points.Add(new PollHistoryPoint(at, count, count > 0));
        }

        return points.TakeLast(24).ToList();
    }

    public IReadOnlyList<string> TailSyncLog(string logs, int lines = 12) =>
        logs.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .TakeLast(lines)
            .ToList();

    public async Task<PresenceSummary?> GetPresenceSummaryAsync(CancellationToken ct)
    {
        var (prodUrl, prodToken) = TokenFile.Read(paths.ProdTokenFile);
        var (stagingUrl, stagingToken) = TokenFile.Read(paths.StagingTokenFile);
        if (string.IsNullOrWhiteSpace(prodUrl) || string.IsNullOrWhiteSpace(prodToken)
            || string.IsNullOrWhiteSpace(stagingUrl) || string.IsNullOrWhiteSpace(stagingToken))
        {
            return null;
        }

        var prodStates = await FetchPersonStatesAsync(prodUrl, prodToken, ct);
        var stagingStates = await FetchPersonStatesAsync(stagingUrl, stagingToken, ct);
        if (prodStates is null || stagingStates is null)
            return null;

        var matched = 0;
        foreach (var (entityId, prodState) in prodStates)
        {
            if (stagingStates.TryGetValue(entityId, out var stagingState)
                && string.Equals(prodState, stagingState, StringComparison.OrdinalIgnoreCase))
            {
                matched++;
            }
        }

        var detail = matched == prodStates.Count && prodStates.Count == stagingStates.Count
            ? "All person states match production"
            : $"{matched} of {prodStates.Count} prod persons match staging";

        return new PresenceSummary(prodStates.Count, stagingStates.Count, matched, detail);
    }

    public IReadOnlyList<ReadinessItem> BuildReadiness(
        OnboardingStatus onboarding,
        bool syncRunning,
        GitSnapshotStatus? git)
    {
        var items = new List<ReadinessItem>
        {
            new("onboarding", "Setup complete", onboarding.IsComplete, onboarding.IsComplete ? null : "Resume wizard"),
            new("prod-token", "Prod token", onboarding.Prod.HasToken, null),
            new("staging-token", "Staging token", onboarding.Staging.HasToken, null),
            new("ssh", "Prod SSH", onboarding.Prod.HasSshKey, null),
            new("git", "Git repo mounted", git?.Configured ?? onboarding.GitConfigured, null),
            new("sync", "Sync loop", syncRunning, syncRunning ? null : "See sync log"),
        };

        if (onboarding.Mirror.Enabled)
        {
            items.Add(new ReadinessItem(
                "mirror",
                "MQTT mirror",
                onboarding.MirrorConfigured,
                onboarding.MirrorConfigured ? null : "Deploy mirror"));
        }

        return items;
    }

    public SuggestedAction? BuildSuggestedAction(
        IReadOnlyList<ComponentIssue> issues,
        IReadOnlyList<SubsystemStatus> subsystems,
        ConfigDriftStatus? drift,
        MirrorRuntimeStatus? mirror,
        IReadOnlyList<ReadinessItem> readiness)
    {
        if (mirror is { Configured: true } && string.Equals(mirror.Mode, "control", StringComparison.OrdinalIgnoreCase))
        {
            return new SuggestedAction(
                "Turn off control mode",
                "Staging can actuate production Zigbee devices while control mode is on.",
                "/operations",
                "Toggle in Operations");
        }

        foreach (var issue in issues)
        {
            var msg = issue.Message;
            if (msg.Contains("conf.d", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("include_dir", StringComparison.OrdinalIgnoreCase))
            {
                return new SuggestedAction(
                    "Fix MQTT mirror config",
                    "Mosquitto cannot read its config directory — redeploy the mirror.",
                    "/operations",
                    "Deploy mirror");
            }

            if (msg.Contains("git fetch", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("git pull", StringComparison.OrdinalIgnoreCase))
            {
                return new SuggestedAction(
                    "Check git repo mount",
                    "The kit could not update the HA config repo — verify Settings → Paths & git.",
                    "/settings",
                    "Open Settings");
            }

            if (msg.Contains("Sync loop not running", StringComparison.OrdinalIgnoreCase))
            {
                return new SuggestedAction(
                    "Restart the sync loop",
                    "Config sync is not running — inspect sync.log and restart the kit container if needed.",
                    "/operations",
                    "Open Operations");
            }
        }

        if (drift is { HasDrift: true })
        {
            return new SuggestedAction(
                "Apply staging config",
                drift.Detail,
                "/operations",
                "Apply config");
        }

        var staging = subsystems.FirstOrDefault(s => s.Name == "Staging HA");
        if (staging?.Status is "fail" or "warn")
        {
            return new SuggestedAction(
                "Fix staging HA connection",
                staging.Detail,
                "/settings",
                "Staging connection");
        }

        var prod = subsystems.FirstOrDefault(s => s.Name == "Production HA");
        if (prod?.Status is "fail" or "warn")
        {
            return new SuggestedAction(
                "Fix production HA connection",
                prod.Detail,
                "/settings",
                "Production connection");
        }

        var notReady = readiness.FirstOrDefault(r => !r.Ok);
        if (notReady is not null)
        {
            return new SuggestedAction(
                $"Complete setup: {notReady.Label}",
                notReady.Detail ?? "Finish configuration before relying on staging sync.",
                notReady.Id == "onboarding" ? "/onboarding" : "/settings",
                notReady.Id == "onboarding" ? "Resume wizard" : "Open Settings");
        }

        if (issues.Count > 0)
        {
            return new SuggestedAction(
                "Review active issues",
                "One or more components reported warnings or errors.",
                "/operations",
                "Open Operations");
        }

        return null;
    }

    public async Task<SubsystemStatus> CheckHaAsync(string name, string url, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(url))
            return new SubsystemStatus(name, "warn", "URL not configured");

        try
        {
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(10);
            var response = await client.GetAsync($"{url.TrimEnd('/')}/", ct);
            return response.IsSuccessStatusCode
                ? new SubsystemStatus(name, "pass", $"HTTP {(int)response.StatusCode}")
                : new SubsystemStatus(name, "warn", $"HTTP {(int)response.StatusCode}");
        }
        catch (Exception ex)
        {
            return new SubsystemStatus(name, "fail", ex.Message);
        }
    }

    async Task<Dictionary<string, string>?> FetchPersonStatesAsync(string url, string token, CancellationToken ct)
    {
        try
        {
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(15);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await client.GetAsync($"{url.TrimEnd('/')}/api/states", ct);
            if (!response.IsSuccessStatusCode)
                return null;

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                return null;

            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (!item.TryGetProperty("entity_id", out var idProp))
                    continue;
                var id = idProp.GetString();
                if (string.IsNullOrWhiteSpace(id) || !id.StartsWith("person.", StringComparison.Ordinal))
                    continue;
                var state = item.TryGetProperty("state", out var stateProp) ? stateProp.GetString() ?? "" : "";
                map[id] = state;
            }

            return map;
        }
        catch
        {
            return null;
        }
    }

    static async Task<string> RunGitAsync(string workDir, params string[] args)
    {
        var psi = new ProcessStartInfo("git")
        {
            WorkingDirectory = workDir,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var arg in args)
            psi.ArgumentList.Add(arg);

        using var process = Process.Start(psi);
        if (process is null)
            return "";

        var output = await process.StandardOutput.ReadToEndAsync();
        await process.WaitForExitAsync();
        return output.Trim();
    }

    static string FormatRelative(DateTimeOffset at)
    {
        var delta = DateTimeOffset.Now - at;
        if (delta.TotalSeconds < 60)
            return "just now";
        if (delta.TotalMinutes < 60)
            return $"{(int)delta.TotalMinutes}m ago";
        if (delta.TotalHours < 48)
            return $"{(int)delta.TotalHours}h ago";
        return $"{(int)delta.TotalDays}d ago";
    }

    [GeneratedRegex(@"\[(?<at>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\].*Synced (?<count>\d+) person/tracker", RegexOptions.IgnoreCase)]
    private static partial Regex PersonSyncLinePattern();
}
