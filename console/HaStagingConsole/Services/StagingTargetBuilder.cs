using System.Net.Http.Headers;
using System.Text.Json;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class StagingTargetBuilder(
    KitPaths paths,
    IHttpClientFactory httpClientFactory,
    DockerRunner docker,
    StartupGuard startup)
{
    static readonly string[] SupervisorPaths = ["/api/supervisor/info", "/api/hassio/info"];

    // Supervisor availability doesn't change during a session — cache indefinitely once known.
    bool? _supervisorAvailableCache;
    string? _supervisorCacheUrl;

    // Config probe (version, locationName, configDir) rarely changes — cache for 60 seconds.
    ConfigProbeResult? _configProbeCache;
    string? _configProbeCacheUrl;
    DateTimeOffset _configProbeCacheExpiry;

    public async Task<StagingTargetSnapshot> BuildAsync(
        OnboardingState state,
        IReadOnlyDictionary<string, string> env,
        CancellationToken ct)
    {
        var url = FirstNonEmpty(env.GetValueOrDefault("STAGING_HA_URL"), state.Staging.Url);
        var configPath = FirstNonEmpty(state.Paths.HaStagingConfig, env.GetValueOrDefault("HA_STAGING_CONFIG"));
        var gitRepo = FirstNonEmpty(state.Paths.HaConfigRepo, env.GetValueOrDefault("HA_CONFIG_REPO"));
        var branch = FirstNonEmpty(state.Paths.HaBranch, env.GetValueOrDefault("HA_BRANCH"), "staging");
        var container = env.GetValueOrDefault("STAGING_HA_CONTAINER", "Home-Assistant-Container").Trim();

        string? version = null;
        string? locationName = null;
        string? configDir = null;
        var apiReachable = false;
        var supervisorAvailable = false;

        var (tokenUrl, token) = TokenFile.Read(paths.StagingTokenFile);
        var probeUrl = FirstNonEmpty(url, tokenUrl);
        if (!string.IsNullOrWhiteSpace(probeUrl) && !string.IsNullOrWhiteSpace(token))
        {
            var configProbe = await GetCachedConfigProbeAsync(probeUrl, token, ct);
            apiReachable = configProbe.Reachable;
            version = configProbe.Version;
            locationName = configProbe.LocationName;
            configDir = configProbe.ConfigDir;
            supervisorAvailable = await GetSupervisorAvailableAsync(probeUrl, token, ct);
        }

        var containerRunning = false;
        if (!string.IsNullOrWhiteSpace(container) && !startup.IsWarmingUp)
            containerRunning = await docker.IsContainerRunningAsync(container, ct);

        var installType = ResolveInstallType(supervisorAvailable, state.Topology.StagingHaType, container);
        var installLabel = LabelInstallType(installType);
        var addonsAvailable = supervisorAvailable;
        var configWritable = !string.IsNullOrWhiteSpace(configPath) && Directory.Exists(configPath)
            && HasWriteAccess(configPath);
        var stagingHaType = FirstNonEmpty(env.GetValueOrDefault("STAGING_HA_TYPE"), state.Topology.StagingHaType) ?? "docker";
        var prodHaType = FirstNonEmpty(env.GetValueOrDefault("PROD_HA_TYPE"), state.Topology.ProdHaType) ?? "ha_os";
        var stagingMqttBroker = FirstNonEmpty(env.GetValueOrDefault("STAGING_MQTT_BROKER"), state.Mirror.StagingMqttBrokerHost);
        var stagingMqttPort = int.TryParse(
            FirstNonEmpty(env.GetValueOrDefault("STAGING_MQTT_PORT"), state.Mirror.StagingMqttPort.ToString()),
            out var mp)
            ? mp
            : 1883;

        return new StagingTargetSnapshot(
            string.IsNullOrWhiteSpace(probeUrl) ? null : probeUrl.Trim(),
            string.IsNullOrWhiteSpace(configPath) ? null : configPath.Trim(),
            string.IsNullOrWhiteSpace(gitRepo) ? null : gitRepo.Trim(),
            string.IsNullOrWhiteSpace(branch) ? null : branch.Trim(),
            string.IsNullOrWhiteSpace(container) ? null : container,
            containerRunning,
            installType,
            installLabel,
            addonsAvailable,
            apiReachable,
            version,
            locationName,
            configDir,
            configWritable,
            stagingHaType,
            prodHaType,
            stagingMqttBroker,
            stagingMqttPort,
            BuildNotes(installType, addonsAvailable));
    }

    static string ResolveInstallType(bool supervisorAvailable, string topologyType, string? container)
    {
        if (supervisorAvailable)
            return "ha_os";

        if (string.Equals(topologyType, "docker", StringComparison.OrdinalIgnoreCase)
            || string.Equals(topologyType, "container", StringComparison.OrdinalIgnoreCase)
            || !string.IsNullOrWhiteSpace(container))
        {
            return "docker";
        }

        return string.IsNullOrWhiteSpace(topologyType) ? "unknown" : topologyType;
    }

    static string LabelInstallType(string installType) => installType switch
    {
        "ha_os" => "Home Assistant OS",
        "docker" => "Docker container",
        "vm" => "Virtual machine",
        "remote" => "Remote host",
        _ => "Other / unknown",
    };

    static string? BuildNotes(string installType, bool addonsAvailable)
    {
        if (addonsAvailable)
            return null;

        if (installType is "docker" or "unknown" or "vm" or "remote")
        {
            return "Settings → Apps / Add-ons store requires Home Assistant OS. "
                + "Staging is not HA OS — use this kit console for sync and testing, not HA add-ons.";
        }

        return null;
    }

    sealed record ConfigProbeResult(bool Reachable, string? Version, string? LocationName, string? ConfigDir);

    async Task<ConfigProbeResult> GetCachedConfigProbeAsync(string url, string token, CancellationToken ct)
    {
        if (_configProbeCacheUrl == url
            && _configProbeCache is not null
            && DateTimeOffset.UtcNow < _configProbeCacheExpiry)
        {
            return _configProbeCache;
        }
        var result = await ProbeConfigAsync(url, token, ct);
        _configProbeCache = result;
        _configProbeCacheUrl = url;
        _configProbeCacheExpiry = DateTimeOffset.UtcNow.AddSeconds(60);
        return result;
    }

    async Task<ConfigProbeResult> ProbeConfigAsync(string url, string token, CancellationToken ct)
    {
        try
        {
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(5);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await client.GetAsync($"{url.TrimEnd('/')}/api/config", ct);
            if (!response.IsSuccessStatusCode)
                return new ConfigProbeResult(false, null, null, null);

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var root = doc.RootElement;
            string? version = null;
            string? locationName = null;
            string? configDir = null;
            if (root.TryGetProperty("version", out var versionProp))
                version = versionProp.GetString();
            if (root.TryGetProperty("location_name", out var nameProp))
                locationName = nameProp.GetString();
            if (root.TryGetProperty("config_dir", out var dirProp))
                configDir = dirProp.GetString();
            return new ConfigProbeResult(true, version, locationName, configDir);
        }
        catch
        {
            return new ConfigProbeResult(false, null, null, null);
        }
    }

    async Task<bool> GetSupervisorAvailableAsync(string url, string token, CancellationToken ct)
    {
        if (_supervisorCacheUrl == url && _supervisorAvailableCache.HasValue)
            return _supervisorAvailableCache.Value;
        var result = await ProbeSupervisorAsync(url, token, ct);
        _supervisorAvailableCache = result;
        _supervisorCacheUrl = url;
        return result;
    }

    async Task<bool> ProbeSupervisorAsync(string url, string token, CancellationToken ct)
    {
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(5);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        foreach (var path in SupervisorPaths)
        {
            try
            {
                using var response = await client.GetAsync($"{url.TrimEnd('/')}{path}", ct);
                if (response.IsSuccessStatusCode)
                    return true;
            }
            catch
            {
                /* try next */
            }
        }

        return false;
    }

    static bool HasWriteAccess(string path)
    {
        try
        {
            var test = Path.Combine(path, $".ha-staging-write-test-{Guid.NewGuid():N}");
            File.WriteAllText(test, "ok");
            File.Delete(test);
            return true;
        }
        catch
        {
            return false;
        }
    }

    static string? FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
                return value;
        }

        return null;
    }
}
