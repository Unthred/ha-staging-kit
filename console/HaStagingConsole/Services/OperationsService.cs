using System.Diagnostics;
using System.Net.Http.Headers;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class OperationsService(
    KitPaths paths,
    SidecarRunner sidecar,
    DockerRunner docker,
    DashboardBuilder dashboard,
    IHttpClientFactory httpClientFactory)
{
    public Task<OperationResult> ApplyConfigAsync(CancellationToken ct)
    {
        if (!Directory.Exists("/repo/.git"))
            return Task.FromResult(new OperationResult(
                false,
                "Git repo not configured — set the HA config repo path in Settings and complete the setup wizard paths step",
                null));

        return RunSidecarScript("/sidecar/sbin/apply-config.sh", "Apply config", ct);
    }

    public Task<OperationResult> PersonPollAsync(CancellationToken ct) =>
        RunSidecarScript("/sidecar/sbin/person-poller.sh --once", "Person poll", ct);

    public Task<OperationResult> StorageSyncAsync(CancellationToken ct) =>
        RunSidecarScript("/sidecar/sbin/sync-storage.sh", "Storage sync", ct);

    public async Task<OperationResult> ShipToStagingAsync(CancellationToken ct)
    {
        var logs = new List<string>();
        var branch = EnvFile.Get(paths.EnvFile, "HA_BRANCH") ?? "staging";

        var push = await dashboard.PushBranchAsync(branch, ct);
        logs.Add(push.Message);
        if (!push.Ok)
            return Fail(logs, push.LogTail);

        if (!string.IsNullOrWhiteSpace(push.LogTail))
            logs.Add(push.LogTail!);

        var apply = await ApplyConfigAsync(ct);
        logs.Add(apply.Message);
        if (!apply.Ok)
            return Fail(logs, apply.LogTail);

        if (!string.IsNullOrWhiteSpace(apply.LogTail))
            logs.Add(apply.LogTail!);

        var restart = await RestartStagingHaAsync(ct);
        logs.Add(restart.Message);
        if (!restart.Ok)
            return Fail(logs, restart.LogTail);

        return new OperationResult(
            true,
            "Shipped to staging — pushed git, applied config, restarted staging HA",
            JoinLogs(logs, restart.LogTail));
    }

    public async Task<OperationResult> DeployToProdAsync(CancellationToken ct)
    {
        var promote = await dashboard.PromoteStagingToMainAsync(ct);
        if (!promote.Ok)
            return promote;

        var logs = new List<string> { promote.Message };

        var pull = await SshGitPullAsync(ct);
        logs.Add(pull.Message);
        if (!pull.Ok)
            return Fail(logs, pull.LogTail);
        if (!string.IsNullOrWhiteSpace(pull.LogTail))
            logs.Add(pull.LogTail!);

        var reload = await ReloadProdHaAsync(ct);
        logs.Add(reload.Message);
        if (!reload.Ok)
            return Fail(logs, reload.LogTail);

        return new OperationResult(
            true,
            "Deployed to prod — pushed to GitHub, pulled on prod HA, reloaded config",
            JoinLogs(logs, reload.LogTail));
    }

    // Deploy: bundle the local main and pipe it to prod via SSH — prod HA never needs GitHub credentials.
    async Task<OperationResult> SshGitPullAsync(CancellationToken ct)
    {
        var target = ParseProdTarget();
        if (target is null)
            return new OperationResult(false, "Prod SSH not configured — set SSH target in Settings", null);
        if (!File.Exists(paths.SshKeyFile))
            return new OperationResult(false, "SSH key not found — add id_ed25519 to the kit secrets directory", null);

        var (userHost, configPath) = target.Value;
        var sshBase = SshBase();
        var g = $"sudo git -C {ShQ(configPath)}";
        var remoteCmd = ShQ(
            $"cat > /tmp/ha-kit-deploy.bundle && " +
            $"{g} fetch /tmp/ha-kit-deploy.bundle main && " +
            $"{g} reset --hard FETCH_HEAD && " +
            $"rm -f /tmp/ha-kit-deploy.bundle");

        var script = $"git -C /repo bundle create - main | nice -n 15 ssh {sshBase} {ShQ(userHost)} {remoteCmd}";
        var (ok, stdout, stderr) = await RunBashAsync(script, ct);

        if (ok)
            return new OperationResult(true, $"Config bundled and applied on prod HA ({userHost})", stdout);

        var hint = stderr.Contains("not a git repository", StringComparison.OrdinalIgnoreCase)
            ? " — prod HA config dir is not a git repo; run the prod HA git init step in the setup wizard"
            : "";
        return new OperationResult(false, $"Prod HA deploy failed{hint}", string.IsNullOrWhiteSpace(stderr) ? stdout : stderr);
    }

    // Onboarding: initialise prod HA config dir as a git repo — non-destructive, zero file changes.
    public async Task<OperationResult> ProdGitInitAsync(CancellationToken ct)
    {
        var target = ParseProdTarget();
        if (target is null)
            return new OperationResult(false, "Prod SSH not configured — set SSH target in Settings", null);
        if (!File.Exists(paths.SshKeyFile))
            return new OperationResult(false, "SSH key not found — add id_ed25519 to the kit secrets directory", null);

        var (userHost, configPath) = target.Value;
        var sshBase = SshBase();

        // Get the remote URL the kit itself uses so prod HA remote matches
        var (remoteOk, remoteOut, _) = await RunBashAsync("git -C /repo remote get-url origin", ct);
        var remoteUrl = remoteOk ? remoteOut.Trim() : "";

        // Check if already a git repo (sudo needed: /homeassistant is root-owned on HA OS)
        var g = $"sudo git -C {ShQ(configPath)}";
        var checkCmd = $"{g} rev-parse --git-dir >/dev/null 2>&1 && echo yes || echo no";
        var (checkOk, checkOut, _) = await RunBashAsync(
            $"ssh {sshBase} {ShQ(userHost)} {ShQ(checkCmd)}", ct);

        if (checkOk && checkOut.Trim() == "yes")
        {
            var existingRemote = "";
            if (!string.IsNullOrWhiteSpace(remoteUrl))
            {
                // Update remote to match kit (idempotent)
                var setRemoteCmd = $"{g} remote set-url origin {ShQ(remoteUrl)} 2>/dev/null || {g} remote add origin {ShQ(remoteUrl)}";
                await RunBashAsync($"ssh {sshBase} {ShQ(userHost)} {ShQ(setRemoteCmd)}", ct);
                existingRemote = $" (remote updated to {remoteUrl})";
            }
            return new OperationResult(true, $"Prod HA config dir is already a git repo{existingRemote}", null);
        }

        // Not initialised — set up git structure without touching any files
        var initSteps = new List<string>
        {
            $"{g} init",
            $"{g} symbolic-ref HEAD refs/heads/main",
        };
        if (!string.IsNullOrWhiteSpace(remoteUrl))
            initSteps.Add($"{g} remote add origin {ShQ(remoteUrl)}");

        var initCmd = string.Join(" && ", initSteps) + " && echo initialized";
        var (initOk, initOut, initErr) = await RunBashAsync(
            $"ssh {sshBase} {ShQ(userHost)} {ShQ(initCmd)}", ct);

        if (!initOk)
            return new OperationResult(false, $"git init on prod HA failed: {initErr}", initErr);

        var remoteNote = string.IsNullOrWhiteSpace(remoteUrl) ? " (remote not set — configure manually)" : $" with remote {remoteUrl}";
        return new OperationResult(
            true,
            $"Prod HA config dir initialised{remoteNote}. No files changed — next deploy will apply config.",
            initOut);
    }

    async Task<OperationResult> ReloadProdHaAsync(CancellationToken ct)
    {
        var (prodUrl, prodToken) = TokenFile.Read(paths.ProdTokenFile);
        if (string.IsNullOrWhiteSpace(prodUrl) || string.IsNullOrWhiteSpace(prodToken))
            return new OperationResult(false, "Prod HA token not configured — add prod.token to kit secrets", null);

        try
        {
            using var http = httpClientFactory.CreateClient();
            using var req = new HttpRequestMessage(
                HttpMethod.Post,
                $"{prodUrl.TrimEnd('/')}/api/services/homeassistant/reload_all");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", prodToken);
            req.Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
            using var resp = await http.SendAsync(req, ct);
            if (resp.IsSuccessStatusCode)
                return new OperationResult(true, "Prod HA config reloaded", null);
            return new OperationResult(false, $"HA reload returned HTTP {(int)resp.StatusCode}", null);
        }
        catch (Exception ex)
        {
            return new OperationResult(false, $"HA reload request failed: {ex.Message}", null);
        }
    }

    public async Task<OperationResult> SetMirrorModeAsync(bool controlMode, CancellationToken ct)
    {
        var arg = controlMode ? "on" : "off";
        var (ok, msg) = await docker.RunScriptAsync(paths.MirrorControlScript, arg, ct);
        var label = controlMode ? "Control mode enabled" : "Read-only mode enabled";
        return new OperationResult(ok, ok ? label : "Mirror mode change failed", msg);
    }

    public async Task<OperationResult> DeployMirrorAsync(CancellationToken ct)
    {
        var (ok, msg) = await docker.RunScriptAsync(paths.DeployMirrorScript, "", ct);
        return new OperationResult(ok, ok ? "Mirror deployed" : "Mirror deploy failed", msg);
    }

    public async Task<OperationResult> RestartStagingHaAsync(CancellationToken ct)
    {
        var container = EnvFile.Get(paths.EnvFile, "STAGING_HA_CONTAINER");
        if (string.IsNullOrWhiteSpace(container))
            return new OperationResult(false, "STAGING_HA_CONTAINER not set in .env", null);

        var (ok, msg) = await docker.RestartContainerAsync(container, ct);
        return new OperationResult(ok, ok ? $"Restarted {container}" : "Restart failed", msg);
    }

    async Task<OperationResult> RunSidecarScript(string script, string label, CancellationToken ct)
    {
        if (!await sidecar.IsSyncLoopRunningAsync(ct))
            return new OperationResult(false, $"Config sync loop is not running — check {paths.SyncLogLocation}", null);

        var (ok, msg) = await sidecar.RunScriptAsync(script, ct);
        return new OperationResult(ok, ok ? $"{label} completed" : $"{label} failed", msg);
    }

    // Parse HA_SECRETS env var ("user@host:/path/secrets.yaml") into (userHost, configPath)
    (string UserHost, string ConfigPath)? ParseProdTarget()
    {
        var haSecrets = EnvFile.Get(paths.EnvFile, "HA_SECRETS") ?? "";
        if (string.IsNullOrWhiteSpace(haSecrets)) return null;

        var colonIdx = haSecrets.IndexOf(':');
        var userHost = colonIdx > 0 ? haSecrets[..colonIdx] : haSecrets;
        var remotePath = colonIdx > 0 ? haSecrets[(colonIdx + 1)..] : "";
        var configPath = remotePath.EndsWith("/secrets.yaml", StringComparison.OrdinalIgnoreCase)
            ? remotePath[..^"/secrets.yaml".Length]
            : remotePath.TrimEnd('/');

        if (string.IsNullOrWhiteSpace(configPath)) configPath = "/config";
        if (!userHost.Contains('@')) userHost = $"root@{userHost}";
        return (userHost, configPath);
    }

    string SshBase() =>
        $"-i {ShQ(paths.SshKeyFile)} -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30";

    static string ShQ(string s) => "'" + s.Replace("'", "'\\''") + "'";

    static async Task<(bool Ok, string Stdout, string Stderr)> RunBashAsync(string script, CancellationToken ct)
    {
        var psi = new ProcessStartInfo("bash")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        psi.ArgumentList.Add("-c");
        psi.ArgumentList.Add(script);
        using var proc = Process.Start(psi);
        if (proc is null) return (false, "", "Failed to start bash");
        var stdoutTask = proc.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        return (proc.ExitCode == 0, (await stdoutTask).Trim(), (await stderrTask).Trim());
    }

    static OperationResult Fail(IReadOnlyList<string> logs, string? tail) =>
        new(false, logs[^1], JoinLogs(logs, tail));

    static string JoinLogs(IReadOnlyList<string> logs, string? tail)
    {
        var combined = string.Join(Environment.NewLine, logs.Where(l => !string.IsNullOrWhiteSpace(l)));
        if (string.IsNullOrWhiteSpace(tail))
            return combined;
        return string.IsNullOrWhiteSpace(combined) ? tail : combined + Environment.NewLine + tail;
    }
}
