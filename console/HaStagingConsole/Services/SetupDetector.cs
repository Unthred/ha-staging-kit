using System.Net.Http.Headers;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class SetupDetector(
    KitPaths paths,
    DockerRunner docker,
    IHttpClientFactory httpClientFactory,
    MirrorEndpointResolver mirrorEndpoints,
    ILogger<SetupDetector> logger)
{
    static readonly string[] SupervisorPaths = ["/api/supervisor/info", "/api/hassio/info"];
    static readonly TimeSpan DetectionCacheTtl = TimeSpan.FromMinutes(5);

    bool? _supervisorCacheProd;
    bool? _supervisorCacheStaging;
    DetectedSetupSnapshot? _detectionCache;
    DateTimeOffset _detectionCacheAt;

    public void InvalidateCache()
    {
        _detectionCache = null;
        logger.LogInformation("Setup detection cache invalidated");
    }

    public async Task<(DetectedSetupSnapshot Detected, bool StateChanged)> DetectAndMergeAsync(
        OnboardingState state,
        CancellationToken ct,
        bool forceRefresh = false)
    {
        DetectedSetupSnapshot detected;
        if (!forceRefresh && TryGetCachedDetection(out var cached))
        {
            logger.LogDebug(
                "Setup detection cache hit (age {AgeSeconds:F0}s)",
                (DateTimeOffset.UtcNow - _detectionCacheAt).TotalSeconds);
            detected = cached;
        }
        else
        {
            logger.LogInformation("Running full setup detection (forceRefresh={ForceRefresh})", forceRefresh);
            detected = await DetectAsync(state, ct);
            _detectionCache = detected;
            _detectionCacheAt = DateTimeOffset.UtcNow;
        }

        var changed = MergeIntoState(state, detected);
        if (mirrorEndpoints.ApplyIfEnabled(state))
            changed = true;
        return (detected, changed);
    }

    bool TryGetCachedDetection(out DetectedSetupSnapshot snapshot)
    {
        if (_detectionCache is not null
            && DateTimeOffset.UtcNow - _detectionCacheAt < DetectionCacheTtl)
        {
            snapshot = _detectionCache;
            return true;
        }

        snapshot = null!;
        return false;
    }

    public async Task<DetectedSetupSnapshot> DetectAsync(OnboardingState state, CancellationToken ct)
    {
        var env = EnvFile.Read(paths.EnvFile);
        var sidecar = EnvFile.Read(paths.ConfigEnvFile);
        var hostEnv = File.Exists(paths.HostEnvFile) ? EnvFile.Read(paths.HostEnvFile) : env;
        var sources = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var notes = new List<string>();

        var pathsDetected = DetectPaths(env, hostEnv, sidecar, sources, notes);
        var (prodUrl, stagingUrl) = DetectUrls(env, sidecar, sources);
        var sshTarget = DetectSshTarget(env, hostEnv, sources);
        var (prodHaType, stagingHaType) = await DetectInstallTypesAsync(prodUrl, stagingUrl, state, sources, notes, ct);
        var sameHost = DetectSameHostAsKit(stagingUrl, pathsDetected?.HaStagingConfig, sources, notes);
        var topology = prodHaType is not null || stagingHaType is not null || sameHost is not null
            ? new TopologySettings(
                prodHaType ?? state.Topology.ProdHaType,
                stagingHaType ?? state.Topology.StagingHaType,
                sameHost ?? state.Topology.SameHostAsKit)
            : null;

        var stagingContainer = await DetectStagingContainerAsync(
            pathsDetected?.HaStagingConfig ?? state.Paths.HaStagingConfig,
            sources,
            notes,
            ct);

        var scratch = ApplyDetectedToScratch(state, topology, pathsDetected, prodUrl, stagingUrl, sshTarget);
        var mirror = mirrorEndpoints.Resolve(scratch with { Mirror = scratch.Mirror with { Enabled = true } });

        if (sources.Count > 0)
            notes.Insert(0, "Kit mounts and environment were scanned for defaults.");

        return new DetectedSetupSnapshot(
            topology,
            pathsDetected,
            prodUrl,
            stagingUrl,
            sshTarget,
            string.IsNullOrWhiteSpace(mirror.ProdMqttHost) ? null : mirror.ProdMqttHost,
            mirror.ProdMqttPort,
            string.IsNullOrWhiteSpace(mirror.StagingMqttBrokerHost) ? null : mirror.StagingMqttBrokerHost,
            mirror.StagingMqttPort,
            stagingContainer,
            sources,
            notes,
            topology is not null,
            pathsDetected is not null);
    }

    public bool MergeIntoState(OnboardingState state, DetectedSetupSnapshot detected)
    {
        var changed = false;

        if (detected.Topology is not null && !state.CompletedSteps.Contains("topology"))
        {
            if (state.Topology != detected.Topology)
            {
                state.Topology = detected.Topology;
                changed = true;
            }
        }

        if (detected.Paths is not null && !state.CompletedSteps.Contains("paths"))
        {
            var merged = new PathSettings(
                Coalesce(state.Paths.HaConfigRepo, detected.Paths.HaConfigRepo),
                Coalesce(state.Paths.HaBranch, detected.Paths.HaBranch),
                Coalesce(state.Paths.HaStagingConfig, detected.Paths.HaStagingConfig),
                Coalesce(state.Paths.SidecarData, detected.Paths.SidecarData),
                Coalesce(state.Paths.MirrorData, detected.Paths.MirrorData));

            if (merged != state.Paths)
            {
                state.Paths = merged;
                changed = true;
            }
        }

        if (!string.IsNullOrWhiteSpace(detected.ProdUrl) && string.IsNullOrWhiteSpace(state.Prod.Url))
        {
            state.Prod = state.Prod with { Url = detected.ProdUrl.Trim() };
            changed = true;
        }

        if (!string.IsNullOrWhiteSpace(detected.StagingUrl) && string.IsNullOrWhiteSpace(state.Staging.Url))
        {
            state.Staging = state.Staging with { Url = detected.StagingUrl.Trim() };
            changed = true;
        }

        if (!string.IsNullOrWhiteSpace(detected.SshTarget) && string.IsNullOrWhiteSpace(state.Prod.SshTarget))
        {
            state.Prod = state.Prod with { SshTarget = detected.SshTarget.Trim() };
            changed = true;
        }

        return changed;
    }

    static OnboardingState ApplyDetectedToScratch(
        OnboardingState state,
        TopologySettings? topology,
        PathSettings? pathsDetected,
        string? prodUrl,
        string? stagingUrl,
        string? sshTarget)
    {
        var scratch = state;
        if (topology is not null)
            scratch.Topology = topology;
        if (pathsDetected is not null)
            scratch.Paths = pathsDetected;
        if (!string.IsNullOrWhiteSpace(prodUrl))
            scratch.Prod = scratch.Prod with { Url = prodUrl.Trim() };
        if (!string.IsNullOrWhiteSpace(stagingUrl))
            scratch.Staging = scratch.Staging with { Url = stagingUrl.Trim() };
        if (!string.IsNullOrWhiteSpace(sshTarget))
            scratch.Prod = scratch.Prod with { SshTarget = sshTarget.Trim() };
        return scratch;
    }

    public void PersistMergedEnv(OnboardingState state, DetectedSetupSnapshot detected, EnvWriter envWriter)
    {
        var kit = EnvFile.Read(paths.EnvFile);
        var container = FirstNonEmpty(
            kit.GetValueOrDefault("STAGING_HA_CONTAINER"),
            detected.StagingHaContainer);

        envWriter.WriteKitEnv(state, container);
        envWriter.WriteSidecarConfig(state);
    }

    static PathSettings? DetectPaths(
        Dictionary<string, string> env,
        Dictionary<string, string> hostEnv,
        Dictionary<string, string> sidecar,
        Dictionary<string, string> sources,
        List<string> notes)
    {
        var repo = FirstNonEmpty(env.GetValueOrDefault("HA_CONFIG_REPO"), hostEnv.GetValueOrDefault("HA_CONFIG_REPO"));
        var stagingConfig = FirstNonEmpty(env.GetValueOrDefault("HA_STAGING_CONFIG"), hostEnv.GetValueOrDefault("HA_STAGING_CONFIG"));
        var sidecarData = FirstNonEmpty(env.GetValueOrDefault("SIDECAR_DATA"), hostEnv.GetValueOrDefault("SIDECAR_DATA"));
        var mirrorData = FirstNonEmpty(env.GetValueOrDefault("MIRROR_DATA"), hostEnv.GetValueOrDefault("MIRROR_DATA"));
        var branch = FirstNonEmpty(env.GetValueOrDefault("HA_BRANCH"), sidecar.GetValueOrDefault("HA_BRANCH"), hostEnv.GetValueOrDefault("HA_BRANCH"));

        if (string.IsNullOrWhiteSpace(repo) && Directory.Exists("/repo/.git"))
            notes.Add("Git repo is mounted at /repo — host path should be in HA_CONFIG_REPO.");

        branch ??= DetectGitBranch();

        sidecarData ??= "./data/sidecar";
        mirrorData ??= "./data/mirror";

        if (string.IsNullOrWhiteSpace(repo)
            && string.IsNullOrWhiteSpace(stagingConfig)
            && string.IsNullOrWhiteSpace(sidecarData)
            && string.IsNullOrWhiteSpace(mirrorData))
        {
            return null;
        }

        if (!string.IsNullOrWhiteSpace(repo))
            sources["paths.haConfigRepo"] = ".env HA_CONFIG_REPO";
        if (!string.IsNullOrWhiteSpace(stagingConfig))
            sources["paths.haStagingConfig"] = ".env HA_STAGING_CONFIG";
        if (!string.IsNullOrWhiteSpace(sidecarData))
            sources["paths.sidecarData"] = ".env SIDECAR_DATA";
        if (!string.IsNullOrWhiteSpace(mirrorData))
            sources["paths.mirrorData"] = ".env MIRROR_DATA";
        if (!string.IsNullOrWhiteSpace(branch))
            sources["paths.haBranch"] = branch == "staging" && Directory.Exists("/repo/.git") ? "git branch staging" : ".env HA_BRANCH";

        return new PathSettings(repo ?? "", branch ?? "staging", stagingConfig ?? "", sidecarData, mirrorData);
    }

    static string? DetectGitBranch()
    {
        if (!Directory.Exists("/repo/.git"))
            return null;

        if (RunGit(["rev-parse", "--verify", "refs/heads/staging"], out var verify) && verify == 0)
            return "staging";

        if (RunGit(["branch", "--show-current"], out var current, out var branchOut) && current == 0)
        {
            var branch = branchOut.Trim();
            return string.IsNullOrWhiteSpace(branch) ? "staging" : branch;
        }

        return "staging";
    }

    (string? ProdUrl, string? StagingUrl) DetectUrls(
        Dictionary<string, string> env,
        Dictionary<string, string> sidecar,
        Dictionary<string, string> sources)
    {
        var (prodTokenUrl, _) = TokenFile.Read(paths.ProdTokenFile);
        var (stagingTokenUrl, _) = TokenFile.Read(paths.StagingTokenFile);

        var prodUrl = FirstNonEmpty(prodTokenUrl, env.GetValueOrDefault("PROD_HA_URL"));
        var stagingUrl = FirstNonEmpty(stagingTokenUrl, env.GetValueOrDefault("STAGING_HA_URL"), sidecar.GetValueOrDefault("STAGING_HA_URL"));

        if (!string.IsNullOrWhiteSpace(prodUrl))
            sources["prod.url"] = !string.IsNullOrWhiteSpace(prodTokenUrl) ? "prod API token file" : ".env PROD_HA_URL";
        if (!string.IsNullOrWhiteSpace(stagingUrl))
            sources["staging.url"] = !string.IsNullOrWhiteSpace(stagingTokenUrl) ? "staging API token file" : ".env STAGING_HA_URL";

        return (prodUrl, stagingUrl);
    }

    static string? DetectSshTarget(
        Dictionary<string, string> env,
        Dictionary<string, string> hostEnv,
        Dictionary<string, string> sources)
    {
        var secrets = FirstNonEmpty(env.GetValueOrDefault("HA_SECRETS"), hostEnv.GetValueOrDefault("HA_SECRETS"));
        if (string.IsNullOrWhiteSpace(secrets))
            return null;

        var target = secrets.EndsWith("/secrets.yaml", StringComparison.OrdinalIgnoreCase)
            ? secrets[..^"/secrets.yaml".Length]
            : secrets.Replace("/secrets.yaml", "").Replace("secrets.yaml", "").TrimEnd('/');

        if (!string.IsNullOrWhiteSpace(target))
            sources["prod.sshTarget"] = ".env HA_SECRETS";

        return target;
    }

    async Task<(string? ProdHaType, string? StagingHaType)> DetectInstallTypesAsync(
        string? prodUrl,
        string? stagingUrl,
        OnboardingState state,
        Dictionary<string, string> sources,
        List<string> notes,
        CancellationToken ct)
    {
        string? prodType = null;
        string? stagingType = null;

        var sidecar = EnvFile.Read(paths.ConfigEnvFile);
        var env = EnvFile.Read(paths.EnvFile);
        var savedProd = FirstNonEmpty(sidecar.GetValueOrDefault("PROD_HA_TYPE"), env.GetValueOrDefault("PROD_HA_TYPE"));
        var savedStaging = FirstNonEmpty(sidecar.GetValueOrDefault("STAGING_HA_TYPE"), env.GetValueOrDefault("STAGING_HA_TYPE"));

        if (!string.IsNullOrWhiteSpace(savedProd))
        {
            prodType = savedProd;
            sources["topology.prodHaType"] = "saved sidecar config";
        }

        if (!string.IsNullOrWhiteSpace(savedStaging))
        {
            stagingType = savedStaging;
            sources["topology.stagingHaType"] = "saved sidecar config";
        }

        var resolvedProdUrl = FirstNonEmpty(prodUrl, state.Prod.Url);
        if (prodType is null && !string.IsNullOrWhiteSpace(resolvedProdUrl))
        {
            var (tokenUrl, token) = TokenFile.Read(paths.ProdTokenFile);
            var probeUrl = FirstNonEmpty(resolvedProdUrl, tokenUrl);
            if (!string.IsNullOrWhiteSpace(probeUrl) && !string.IsNullOrWhiteSpace(token))
            {
                prodType = await ProbeInstallTypeAsync(probeUrl, token, ct, isProd: true);
                if (prodType is not null)
                    sources["topology.prodHaType"] = "prod HA API (supervisor probe)";
            }
        }

        var resolvedStagingUrl = FirstNonEmpty(stagingUrl, state.Staging.Url);
        if (stagingType is null && !string.IsNullOrWhiteSpace(resolvedStagingUrl))
        {
            var (tokenUrl, token) = TokenFile.Read(paths.StagingTokenFile);
            var probeUrl = FirstNonEmpty(resolvedStagingUrl, tokenUrl);
            if (!string.IsNullOrWhiteSpace(probeUrl) && !string.IsNullOrWhiteSpace(token))
            {
                stagingType = await ProbeInstallTypeAsync(probeUrl, token, ct);
                if (stagingType is not null)
                    sources["topology.stagingHaType"] = "staging HA API (supervisor probe)";
            }
        }

        if (stagingType is null)
        {
            var container = env.GetValueOrDefault("STAGING_HA_CONTAINER");
            if (!string.IsNullOrWhiteSpace(container) && await docker.ContainerExistsAsync(container.Trim(), ct))
            {
                stagingType = "docker";
                sources["topology.stagingHaType"] = $"Docker container {container.Trim()}";
            }
        }

        if (stagingType is null && Directory.Exists("/ha-config") && File.Exists("/ha-config/configuration.yaml"))
            notes.Add("Staging config is bind-mounted at /ha-config — typical for Docker staging on the kit host.");

        return (prodType, stagingType);
    }

    static bool? DetectSameHostAsKit(
        string? stagingUrl,
        string? stagingConfigPath,
        Dictionary<string, string> sources,
        List<string> notes)
    {
        var configWritable = Directory.Exists("/ha-config") && HasWriteAccess("/ha-config");
        if (!configWritable)
        {
            sources["topology.sameHostAsKit"] = "staging config not writable on kit host";
            return false;
        }

        sources["topology.sameHostAsKit"] = "/ha-config bind mount is writable";

        if (!string.IsNullOrWhiteSpace(stagingUrl) && IsLocalHostUrl(stagingUrl))
            return true;

        if (!string.IsNullOrWhiteSpace(stagingConfigPath)
            && (stagingConfigPath.StartsWith("/mnt/", StringComparison.Ordinal)
                || stagingConfigPath.StartsWith("/ha-config", StringComparison.Ordinal)))
        {
            return true;
        }

        notes.Add("Staging config directory is on this host; confirm staging HA runs here too.");
        return true;
    }

    async Task<string?> DetectStagingContainerAsync(
        string? stagingConfigPath,
        Dictionary<string, string> sources,
        List<string> notes,
        CancellationToken ct)
    {
        var env = EnvFile.Read(paths.EnvFile);
        var configured = env.GetValueOrDefault("STAGING_HA_CONTAINER");
        if (!string.IsNullOrWhiteSpace(configured) && await docker.ContainerExistsAsync(configured.Trim(), ct))
        {
            sources["stagingHaContainer"] = ".env STAGING_HA_CONTAINER";
            return configured.Trim();
        }

        if (string.IsNullOrWhiteSpace(stagingConfigPath))
            return null;

        string normalizedConfig;
        try
        {
            normalizedConfig = Path.GetFullPath(stagingConfigPath.Trim());
        }
        catch
        {
            return null;
        }

        var names = await docker.ListHomeAssistantContainerNamesAsync(ct);
        foreach (var name in names)
        {
            var mounts = await docker.GetContainerMountSourcesAsync(name, ct);
            if (mounts.Any(m => PathsMatch(m, normalizedConfig)))
            {
                sources["stagingHaContainer"] = $"Docker mount match ({name})";
                notes.Add($"Matched staging container {name} by config directory mount.");
                return name;
            }
        }

        if (names.Count == 1)
        {
            sources["stagingHaContainer"] = $"only Home Assistant container ({names[0]})";
            return names[0];
        }

        var fallback = names.FirstOrDefault(n =>
            n.Contains("home-assistant", StringComparison.OrdinalIgnoreCase)
            || n.Contains("Home-Assistant", StringComparison.Ordinal));
        if (fallback is not null)
        {
            sources["stagingHaContainer"] = $"Home Assistant container name ({fallback})";
            return fallback;
        }

        return null;
    }

    async Task<string> ProbeInstallTypeAsync(string url, string token, CancellationToken ct, bool isProd = false)
    {
        if (isProd)
        {
            if (!_supervisorCacheProd.HasValue)
                _supervisorCacheProd = await ProbeSupervisorAsync(url, token, ct);
            return _supervisorCacheProd.Value ? "ha_os" : "docker";
        }
        if (!_supervisorCacheStaging.HasValue)
            _supervisorCacheStaging = await ProbeSupervisorAsync(url, token, ct);
        return _supervisorCacheStaging.Value ? "ha_os" : "docker";
    }

    async Task<bool> ProbeSupervisorAsync(string url, string token, CancellationToken ct)
    {
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(8);
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

    static bool PathsMatch(string mountSource, string stagingConfigPath)
    {
        try
        {
            var mount = Path.GetFullPath(mountSource);
            return mount.Equals(stagingConfigPath, StringComparison.Ordinal)
                || stagingConfigPath.StartsWith(mount + Path.DirectorySeparatorChar, StringComparison.Ordinal)
                || mount.StartsWith(stagingConfigPath + Path.DirectorySeparatorChar, StringComparison.Ordinal);
        }
        catch
        {
            return false;
        }
    }

    static bool RunGit(IReadOnlyList<string> args, out int exitCode) =>
        RunGit(args, out exitCode, out _);

    static bool RunGit(IReadOnlyList<string> args, out int exitCode, out string output)
    {
        output = "";
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo("git")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                WorkingDirectory = "/repo"
            };
            foreach (var part in args)
                psi.ArgumentList.Add(part);

            using var proc = System.Diagnostics.Process.Start(psi);
            if (proc is null)
            {
                exitCode = -1;
                return false;
            }

            output = proc.StandardOutput.ReadToEnd();
            proc.WaitForExit();
            exitCode = proc.ExitCode;
            return true;
        }
        catch
        {
            exitCode = -1;
            return false;
        }
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

    static bool IsLocalHostUrl(string url) => IsLocalHostHost(HostFromHttpUrl(url));

    static bool IsLocalHostHost(string? host) =>
        host is "127.0.0.1" or "localhost" or "::1";

    static string? HostFromHttpUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url))
            return null;
        return Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri) ? uri.Host : null;
    }

    static string Coalesce(string current, string detected) =>
        string.IsNullOrWhiteSpace(current) ? detected : current;

    static string? FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
                return value.Trim();
        }

        return null;
    }
}
