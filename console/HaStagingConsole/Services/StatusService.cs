using System.Net.Http.Headers;
using System.Text.RegularExpressions;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed partial class StatusService(
    KitPaths paths,
    DockerRunner docker,
    OnboardingStore store,
    OnboardingBootstrap bootstrap,
    IHttpClientFactory httpClientFactory)
{
    public async Task<DashboardStatus> GetDashboardAsync(CancellationToken ct)
    {
        var env = EnvFile.Read(paths.EnvFile);
        var state = bootstrap.LoadOrBootstrap();
        var onboarding = store.ToStatus(state);
        var stagingUrl = env.GetValueOrDefault("STAGING_HA_URL", state.Staging.Url);

        var subsystems = new List<SubsystemStatus>();

        var sidecarRunning = await docker.IsContainerRunningAsync(paths.SidecarContainer, ct);
        subsystems.Add(new SubsystemStatus(
            "Sidecar",
            sidecarRunning ? "pass" : "fail",
            sidecarRunning ? "Container running" : "Container not running"));

        var stagingCheck = await CheckStagingHaAsync(stagingUrl, ct);
        subsystems.Add(stagingCheck);

        var mirrorRunning = await docker.IsContainerRunningAsync(paths.MirrorContainer, ct);
        var mirrorStatus = GetMirrorRuntime(env);
        mirrorStatus = mirrorStatus with { Running = mirrorRunning };
        if (mirrorStatus.Configured)
        {
            subsystems.Add(new SubsystemStatus(
                "MQTT mirror",
                mirrorRunning ? "pass" : "warn",
                mirrorRunning ? $"Running — {mirrorStatus.Mode}" : "Configured but container not running"));
        }
        else
        {
            subsystems.Add(new SubsystemStatus("MQTT mirror", "skip", "Not configured"));
        }

        SidecarRuntimeStatus? sidecarRuntime = null;
        if (sidecarRunning)
        {
            var logs = await docker.ContainerLogsTailAsync(paths.SidecarContainer, 80, ct);
            sidecarRuntime = new SidecarRuntimeStatus(
                true,
                FindLastLine(logs, PersonSyncPattern()),
                FindLastLine(logs, ApplyPattern()),
                FindLastLine(logs, StoragePattern()),
                EnvFile.GetInt(paths.ConfigEnvFile, "PERSON_POLL_INTERVAL", 60),
                EnvFile.GetInt(paths.ConfigEnvFile, "STORAGE_SYNC_INTERVAL", 86400));
        }

        return new DashboardStatus(
            onboarding.IsComplete,
            subsystems,
            sidecarRuntime,
            mirrorStatus.Configured ? mirrorStatus : null,
            string.IsNullOrWhiteSpace(stagingUrl) ? null : stagingUrl);
    }

    async Task<SubsystemStatus> CheckStagingHaAsync(string url, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(url))
            return new SubsystemStatus("Staging HA", "warn", "URL not configured");

        try
        {
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(10);
            var response = await client.GetAsync($"{url.TrimEnd('/')}/", ct);
            return response.IsSuccessStatusCode
                ? new SubsystemStatus("Staging HA", "pass", $"HTTP {(int)response.StatusCode}")
                : new SubsystemStatus("Staging HA", "warn", $"HTTP {(int)response.StatusCode}");
        }
        catch (Exception ex)
        {
            return new SubsystemStatus("Staging HA", "fail", ex.Message);
        }
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

    [GeneratedRegex("Synced|person-poller", RegexOptions.IgnoreCase)]
    private static partial Regex PersonSyncPattern();

    [GeneratedRegex("apply-config|Applied|git pull", RegexOptions.IgnoreCase)]
    private static partial Regex ApplyPattern();

    [GeneratedRegex("sync-storage|Storage sync", RegexOptions.IgnoreCase)]
    private static partial Regex StoragePattern();
}
