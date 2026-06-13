using System.Net.Http.Headers;
using System.Net.Sockets;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class OnboardingTests(KitPaths paths, SidecarRunner sidecar, DockerRunner docker, IHttpClientFactory httpClientFactory, OnboardingBootstrap bootstrap)
{
    public Task<TestResult> TestProdApiAsync(string? url, string? token, CancellationToken ct) =>
        TestApiWithFallbackAsync(url, token, paths.ProdTokenFile, "Prod", ct);

    public Task<TestResult> TestStagingApiAsync(string? url, string? token, CancellationToken ct) =>
        TestApiWithFallbackAsync(url, token, paths.StagingTokenFile, "Staging", ct);

    async Task<TestResult> TestApiWithFallbackAsync(
        string? url,
        string? token,
        string tokenFile,
        string label,
        CancellationToken ct)
    {
        var state = bootstrap.LoadOrBootstrap();
        var stateUrl = (label == "Prod" ? state.Prod.Url : state.Staging.Url)?.Trim();

        var resolvedUrl = string.IsNullOrWhiteSpace(url) ? null : url.Trim();
        var resolvedToken = string.IsNullOrWhiteSpace(token) ? null : token.Trim();

        var (savedUrl, savedToken) = ReadTokenFile(tokenFile);
        resolvedToken ??= string.IsNullOrWhiteSpace(savedToken) ? null : savedToken.Trim();

        resolvedUrl ??= string.IsNullOrWhiteSpace(stateUrl) ? null : stateUrl;
        resolvedUrl ??= string.IsNullOrWhiteSpace(savedUrl) ? null : savedUrl.Trim();

        if (string.IsNullOrWhiteSpace(resolvedUrl) || string.IsNullOrWhiteSpace(resolvedToken))
            return new TestResult(false, $"Enter {label} URL and token above, or save first.");

        return await TestHaApiAsync(resolvedUrl, resolvedToken, ct);
    }

    async Task<TestResult> TestHaApiAsync(string url, string token, CancellationToken ct)
    {
        try
        {
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(15);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            var response = await client.GetAsync($"{url.TrimEnd('/')}/api/", ct);
            if (response.IsSuccessStatusCode)
                return new TestResult(true, $"HTTP {(int)response.StatusCode} — API reachable");
            return new TestResult(false, $"HTTP {(int)response.StatusCode} {response.ReasonPhrase}");
        }
        catch (Exception ex)
        {
            return new TestResult(false, ex.Message);
        }
    }

    public Task<TestResult> TestSshAsync(string? sshTarget, string? sshPrivateKey, OnboardingState state, CancellationToken ct)
    {
        var target = (sshTarget ?? state.Prod.SshTarget)?.Trim();
        if (string.IsNullOrWhiteSpace(target))
            return Task.FromResult(new TestResult(false, "Enter SSH target above or save first."));

        var userHost = target.Contains('@') ? target.Split(':')[0] : $"root@{target.Split(':')[0]}";

        string? tempKey = null;
        string keyPath;
        if (!string.IsNullOrWhiteSpace(sshPrivateKey))
        {
            tempKey = Path.Combine(Path.GetTempPath(), $"ha-staging-ssh-test-{Guid.NewGuid():N}");
            File.WriteAllText(tempKey, sshPrivateKey.TrimEnd() + "\n");
            if (OperatingSystem.IsLinux() || OperatingSystem.IsMacOS())
                File.SetUnixFileMode(tempKey, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            keyPath = tempKey;
        }
        else if (File.Exists(paths.SshKeyFile))
        {
            keyPath = paths.SshKeyFile;
        }
        else
        {
            return Task.FromResult(new TestResult(false, "Paste SSH private key above or save first."));
        }

        return Task.Run(() =>
        {
            try
            {
                var psi = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "ssh",
                    ArgumentList =
                    {
                        "-i", keyPath,
                        "-o", "BatchMode=yes",
                        "-o", "StrictHostKeyChecking=accept-new",
                        "-o", "ConnectTimeout=10",
                        userHost,
                        "echo ok"
                    },
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false
                };
                using var proc = System.Diagnostics.Process.Start(psi);
                if (proc is null)
                    return new TestResult(false, "Failed to start ssh");
                proc.WaitForExit(TimeSpan.FromSeconds(20));
                var err = proc.StandardError.ReadToEnd().Trim();
                if (proc.ExitCode == 0)
                    return new TestResult(true, "SSH connection OK");
                return new TestResult(false, string.IsNullOrWhiteSpace(err) ? $"ssh exit {proc.ExitCode}" : err);
            }
            catch (Exception ex)
            {
                return new TestResult(false, ex.Message);
            }
            finally
            {
                if (tempKey is not null)
                {
                    try { File.Delete(tempKey); } catch { /* best effort */ }
                }
            }
        }, ct);
    }

    public Task<TestResult> TestMqttAsync(MirrorSettings saved, MqttTestRequest? req, CancellationToken ct)
    {
        var host = string.IsNullOrWhiteSpace(req?.ProdMqttHost) ? saved.ProdMqttHost : req.ProdMqttHost.Trim();
        var port = req?.ProdMqttPort ?? saved.ProdMqttPort;

        if (string.IsNullOrWhiteSpace(host))
            return Task.FromResult(new TestResult(false, "Enter prod MQTT host above or save first."));

        return Task.Run(() =>
        {
            try
            {
                using var client = new TcpClient();
                var task = client.ConnectAsync(host, port);
                if (!task.Wait(TimeSpan.FromSeconds(10)))
                    return new TestResult(false, "TCP connect timed out");
                return new TestResult(true, $"TCP {host}:{port} reachable");
            }
            catch (Exception ex)
            {
                return new TestResult(false, ex.Message);
            }
        }, ct);
    }

    public async Task<TestResult> TestStagingConfigPathAsync(string? path, OnboardingState state, SidecarRunner sidecarRunner, CancellationToken ct)
    {
        var dir = (path ?? state.Paths.HaStagingConfig)?.Trim();
        if (string.IsNullOrWhiteSpace(dir))
            return new TestResult(false, "Enter staging config path above or save first.");

        if (!Directory.Exists(dir))
            return new TestResult(false,
                $"Directory not found: {dir}. Ensure the path exists and is mounted in ha-staging-kit.");

        try
        {
            _ = Directory.EnumerateFileSystemEntries(dir).Take(1).ToList();
        }
        catch (Exception ex)
        {
            return new TestResult(false, $"Directory not readable: {ex.Message}");
        }

        var configYaml = Path.Combine(dir, "configuration.yaml");
        var hasConfig = File.Exists(configYaml);

        if (await sidecarRunner.IsSyncLoopRunningAsync(ct))
        {
            var (ok, msg) = await sidecarRunner.RunScriptAsync(
                "test -w /ha-config && touch /ha-config/.ha-staging-write-test && rm -f /ha-config/.ha-staging-write-test && echo writable",
                ct);
            if (ok && msg.Contains("writable", StringComparison.OrdinalIgnoreCase))
            {
                return hasConfig
                    ? new TestResult(true, "Staging config readable/writable at /ha-config; configuration.yaml present")
                    : new TestResult(true, "Staging config writable at /ha-config (configuration.yaml not found yet)");
            }

            return new TestResult(false, $"/ha-config not writable: {msg}");
        }

        if (hasConfig)
            return new TestResult(true, "Directory readable; configuration.yaml present. Sync loop will start with the kit.");

        return new TestResult(true, "Directory readable. Sync loop starts automatically in the kit container.");
    }

    public Task<TestResult> TestGitRepoPathAsync(string? path, OnboardingState state, CancellationToken ct) =>
        Task.Run(() =>
        {
            var dir = (path ?? state.Paths.HaConfigRepo)?.Trim();
            if (string.IsNullOrWhiteSpace(dir))
                return new TestResult(false, "Enter HA config repo path above or save first.");

            if (!Directory.Exists(dir))
                return new TestResult(false,
                    $"Directory not found: {dir}. Ensure HA_CONFIG_REPO is mounted in ha-staging-kit.");

            var gitDir = Path.Combine(dir, ".git");
            if (!Directory.Exists(gitDir))
                return new TestResult(false, "Not a git repository (.git missing)");

            var branchFile = Path.Combine(gitDir, "HEAD");
            if (!File.Exists(branchFile))
                return new TestResult(false, "Git HEAD missing — repo may be corrupt");

            var hasConfig = File.Exists(Path.Combine(dir, "configuration.yaml"));
            var detail = hasConfig ? "Git repo with configuration.yaml" : "Git repo (no configuration.yaml at root)";
            return new TestResult(true, detail);
        }, ct);

    public IReadOnlyList<HealthCheckPlanItem> GetHealthCheckPlan(OnboardingState state) =>
    [
        new("sync", "Config sync loop"),
        new("prod", "Prod API"),
        new("staging", "Staging API"),
        new("person", "Person sync"),
        new("mirror", "MQTT mirror"),
    ];

    public Task<HealthCheckResult> RunHealthCheckAsync(OnboardingState state, string checkId, CancellationToken ct) =>
        checkId switch
        {
            "sync" => CheckSidecarRunningAsync(ct),
            "prod" => RunProdHealthAsync(ct),
            "staging" => RunStagingHealthAsync(ct),
            "person" => RunPersonPollAsync(ct),
            "mirror" => state.Mirror.Enabled
                ? CheckMirrorContainerAsync(ct)
                : Task.FromResult(new HealthCheckResult("MQTT mirror", "skip", "Not enabled")),
            _ => Task.FromResult(new HealthCheckResult(checkId, "fail", "Unknown check")),
        };

    async Task<HealthCheckResult> RunProdHealthAsync(CancellationToken ct)
    {
        var prod = await TestProdApiAsync(null, null, ct);
        return prod.Ok
            ? new HealthCheckResult("Prod API", "pass", prod.Message)
            : new HealthCheckResult("Prod API", "fail", prod.Message);
    }

    async Task<HealthCheckResult> RunStagingHealthAsync(CancellationToken ct)
    {
        var staging = await TestStagingApiAsync(null, null, ct);
        return staging.Ok
            ? new HealthCheckResult("Staging API", "pass", staging.Message)
            : new HealthCheckResult("Staging API", "fail", staging.Message);
    }

    public async Task<IReadOnlyList<HealthCheckResult>> RunHealthChecksAsync(OnboardingState state, CancellationToken ct)
    {
        var results = new List<HealthCheckResult>();
        foreach (var item in GetHealthCheckPlan(state))
            results.Add(await RunHealthCheckAsync(state, item.Id, ct));
        return results;
    }

    async Task<HealthCheckResult> CheckSidecarRunningAsync(CancellationToken ct)
    {
        if (await sidecar.IsSyncLoopRunningAsync(ct))
            return new HealthCheckResult("Config sync loop", "pass", "Running");

        var log = await sidecar.SyncLogTailAsync(8, ct);
        if (log.Contains("ha-staging-kit-sync", StringComparison.Ordinal))
            return new HealthCheckResult("Config sync loop", "pass", "Sync log active");

        return new HealthCheckResult("Config sync loop", "fail", $"Not running — see {paths.SyncLogLocation}");
    }

    async Task<HealthCheckResult> CheckMirrorContainerAsync(CancellationToken ct)
    {
        if (await sidecar.IsMirrorRunningAsync(ct))
            return new HealthCheckResult("MQTT mirror", "pass", "mosquitto running");

        if (await IsLocalPortOpenAsync(1883, ct))
            return new HealthCheckResult("MQTT mirror", "pass", "Broker listening on port 1883");

        return new HealthCheckResult("MQTT mirror", "fail", "mosquitto not running");
    }

    static async Task<bool> IsLocalPortOpenAsync(int port, CancellationToken ct)
    {
        try
        {
            using var client = new TcpClient();
            var connect = client.ConnectAsync("127.0.0.1", port);
            await connect.WaitAsync(TimeSpan.FromSeconds(3), ct);
            return client.Connected;
        }
        catch
        {
            return false;
        }
    }

    async Task<HealthCheckResult> RunPersonPollAsync(CancellationToken ct)
    {
        var result = await sidecar.RunScriptAsync("/sidecar/sbin/person-poller.sh --once", ct);
        if (result.Ok && result.Message.Contains("Synced", StringComparison.OrdinalIgnoreCase))
            return new HealthCheckResult("Person sync", "pass", result.Message.Trim());
        if (result.Ok)
            return new HealthCheckResult("Person sync", "warn", result.Message.Trim());
        return new HealthCheckResult("Person sync", "fail", result.Message);
    }

    async Task<(bool Ok, string Message)> RunDockerAsync(string[] args, CancellationToken ct)
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo("docker")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            };
            foreach (var arg in args)
                psi.ArgumentList.Add(arg);

            using var proc = System.Diagnostics.Process.Start(psi);
            if (proc is null)
                return (false, "Failed to start docker");
            var stdout = await proc.StandardOutput.ReadToEndAsync(ct);
            var stderr = await proc.StandardError.ReadToEndAsync(ct);
            await proc.WaitForExitAsync(ct);
            var msg = string.IsNullOrWhiteSpace(stdout) ? stderr : stdout;
            return (proc.ExitCode == 0, msg.Trim());
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    static (string Url, string Token) ReadTokenFile(string path) => TokenFile.Read(path);
}
