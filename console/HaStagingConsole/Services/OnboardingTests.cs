using System.Net.Http.Headers;
using System.Net.Sockets;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class OnboardingTests(KitPaths paths, IHttpClientFactory httpClientFactory)
{
    public async Task<TestResult> TestProdApiAsync(CancellationToken ct)
    {
        var (url, token) = ReadTokenFile(paths.ProdTokenFile);
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(token))
            return new TestResult(false, "Prod token not configured");

        return await TestHaApiAsync(url, token, ct);
    }

    public async Task<TestResult> TestStagingApiAsync(CancellationToken ct)
    {
        var (url, token) = ReadTokenFile(paths.StagingTokenFile);
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(token))
            return new TestResult(false, "Staging token not configured");

        return await TestHaApiAsync(url, token, ct);
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

    public Task<TestResult> TestSshAsync(OnboardingState state, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(state.Prod.SshTarget))
            return Task.FromResult(new TestResult(false, "SSH target not set"));

        if (!File.Exists(paths.SshKeyFile))
            return Task.FromResult(new TestResult(false, "SSH private key not uploaded"));

        var target = state.Prod.SshTarget.Split(':')[0];
        var userHost = target.Contains('@') ? target : $"root@{target}";

        return Task.Run(() =>
        {
            try
            {
                var psi = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "ssh",
                    ArgumentList =
                    {
                        "-i", paths.SshKeyFile,
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
        }, ct);
    }

    public Task<TestResult> TestMqttAsync(MirrorSettings mirror, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(mirror.ProdMqttHost))
            return Task.FromResult(new TestResult(false, "Prod MQTT host not set"));

        return Task.Run(() =>
        {
            try
            {
                using var client = new TcpClient();
                var task = client.ConnectAsync(mirror.ProdMqttHost, mirror.ProdMqttPort);
                if (!task.Wait(TimeSpan.FromSeconds(10)))
                    return new TestResult(false, "TCP connect timed out");
                return new TestResult(true, $"TCP {mirror.ProdMqttHost}:{mirror.ProdMqttPort} reachable");
            }
            catch (Exception ex)
            {
                return new TestResult(false, ex.Message);
            }
        }, ct);
    }

    public async Task<IReadOnlyList<HealthCheckResult>> RunHealthChecksAsync(OnboardingState state, CancellationToken ct)
    {
        var results = new List<HealthCheckResult>();

        results.Add(await CheckSidecarRunningAsync(ct));
        results.Add(await TestProdApiAsync(ct) is { Ok: true } p
            ? new HealthCheckResult("Prod API", "pass", p.Message)
            : new HealthCheckResult("Prod API", "fail", (await TestProdApiAsync(ct)).Message));
        results.Add(await TestStagingApiAsync(ct) is { Ok: true } s
            ? new HealthCheckResult("Staging API", "pass", s.Message)
            : new HealthCheckResult("Staging API", "fail", (await TestStagingApiAsync(ct)).Message));

        var person = await RunPersonPollAsync(ct);
        results.Add(person);

        if (state.Mirror.Enabled)
            results.Add(await CheckMirrorContainerAsync(ct));
        else
            results.Add(new HealthCheckResult("MQTT mirror", "skip", "Not enabled"));

        return results;
    }

    async Task<HealthCheckResult> CheckSidecarRunningAsync(CancellationToken ct)
    {
        var result = await RunDockerAsync(["ps", "--filter", $"name=^{paths.SidecarContainer}$", "--format", "{{.Names}}"], ct);
        if (result.Ok && result.Message.Contains(paths.SidecarContainer, StringComparison.Ordinal))
            return new HealthCheckResult("Sidecar container", "pass", "Running");
        return new HealthCheckResult("Sidecar container", "fail", result.Message);
    }

    async Task<HealthCheckResult> CheckMirrorContainerAsync(CancellationToken ct)
    {
        var result = await RunDockerAsync(["ps", "--filter", "name=^mosquitto-mirror$", "--format", "{{.Names}}"], ct);
        if (result.Ok && result.Message.Contains("mosquitto-mirror", StringComparison.Ordinal))
            return new HealthCheckResult("MQTT mirror", "pass", "Container running");
        return new HealthCheckResult("MQTT mirror", "fail", result.Message);
    }

    async Task<HealthCheckResult> RunPersonPollAsync(CancellationToken ct)
    {
        var result = await RunDockerAsync(["exec", paths.SidecarContainer, "/sidecar/sbin/person-poller.sh", "--once"], ct);
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

    static (string Url, string Token) ReadTokenFile(string path)
    {
        if (!File.Exists(path))
            return ("", "");
        var lines = File.ReadAllLines(path);
        return (lines.ElementAtOrDefault(0) ?? "", lines.ElementAtOrDefault(1) ?? "");
    }
}
