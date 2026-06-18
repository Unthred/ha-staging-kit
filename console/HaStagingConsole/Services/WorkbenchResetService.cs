using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

/// <summary>
/// One-shot workbench reset: git matches GitHub staging branch, kit parity sidecar state cleared,
/// staging HA re-applied from git with prod .storage sync. Git Lovelace stays authoritative for deploy scan.
/// </summary>
public sealed class WorkbenchResetService(
    KitPaths paths,
    GitSshConfigurator gitSsh,
    LovelaceParityDeferStore deferStore,
    LovelaceParityUndoStore undoStore,
    LovelaceParityFixActionStore fixActionStore,
    EntityDeployScanStore scanStore,
    SidecarRunner sidecar,
    DockerRunner docker)
{
    static readonly string[] LovelaceRepoRelativePaths =
    [
        ".storage/lovelace.lovelace",
        ".storage/lovelace.map",
        ".storage/lovelace_dashboards",
        ".storage/lovelace_resources",
    ];

    public async Task<OperationResult> ResetAsync(CancellationToken ct)
    {
        if (!Directory.Exists("/repo/.git"))
        {
            return new OperationResult(
                false,
                "Git repo not configured — set the HA config repo path in Settings",
                null);
        }

        if (!await sidecar.IsSyncLoopRunningAsync(ct))
        {
            return new OperationResult(
                false,
                $"Config sync loop is not running — check {paths.SyncLogLocation}",
                null);
        }

        var logs = new List<string>();
        var branch = EnvFile.Get(paths.EnvFile, "HA_BRANCH") ?? "staging";
        var remoteRef = $"origin/{branch}";

        var (fetchOk, _, fetchErr) = await RunGitBashAsync("git -C /repo fetch origin", ct);
        if (!fetchOk)
            return new OperationResult(false, "git fetch failed before workbench reset", fetchErr);

        var localCommitsDiscarded = await GitRevCountAsync($"origin/{branch}..HEAD", ct);
        if (localCommitsDiscarded > 0)
        {
            logs.Add(
                $"Discarded {localCommitsDiscarded} local commit(s) not on GitHub {branch} — reset matches origin/{branch}.");
        }

        var (resetOk, resetOut, resetErr) = await RunGitBashAsync(
            $"git -C /repo reset --hard {ShellQuote(remoteRef)}",
            ct);
        if (!resetOk)
            return Fail(logs, resetErr);

        if (!string.IsNullOrWhiteSpace(resetOut))
            logs.Add(resetOut.Trim());

        var (cleanOk, cleanOut, cleanErr) = await RunGitBashAsync(
            "git -C /repo clean -fd -- .storage/",
            ct);
        if (!cleanOk)
            logs.Add($"WARN: git clean .storage failed: {cleanErr}");
        else if (!string.IsNullOrWhiteSpace(cleanOut))
            logs.Add(cleanOut.Trim());

        deferStore.Clear();
        undoStore.Clear();
        fixActionStore.Clear();
        scanStore.ClearLastScan();
        logs.Add("Cleared entity deploy scan defer/undo/recheck sidecar state.");

        StampRepoLovelaceFresh();
        logs.Add("Marked git Lovelace as authoritative — staging UI capture will not overwrite after prod storage sync.");

        var (applyOk, applyMsg) = await sidecar.RunScriptAsync("/sidecar/sbin/apply-config.sh", ct);
        logs.Add(applyMsg);
        if (!applyOk)
            return Fail(logs, applyMsg);

        var container = EnvFile.Get(paths.EnvFile, "STAGING_HA_CONTAINER");
        if (string.IsNullOrWhiteSpace(container))
            return Fail(logs, "STAGING_HA_CONTAINER not set in .env");

        var (restartOk, restartMsg) = await docker.RestartContainerAsync(container, ct);
        logs.Add(restartMsg);
        if (!restartOk)
            return Fail(logs, restartMsg);

        logs.Add($"Restarted {container}.");
        return new OperationResult(
            true,
            "Workbench reset — git matches GitHub, staging HA re-applied with prod .storage sync",
            JoinLogs(logs));
    }

    void StampRepoLovelaceFresh()
    {
        var stamp = DateTime.UtcNow.AddMinutes(5);
        foreach (var relativePath in LovelaceRepoRelativePaths)
        {
            var path = Path.Combine("/repo", relativePath);
            if (!File.Exists(path))
                continue;

            File.SetLastWriteTimeUtc(path, stamp);
        }
    }

    async Task<int> GitRevCountAsync(string range, CancellationToken ct)
    {
        var (ok, stdout, _) = await RunGitBashAsync(
            $"git -C /repo rev-list --count {range} 2>/dev/null",
            ct);
        if (!ok || !int.TryParse(stdout.Trim(), out var count))
            return 0;
        return count;
    }

    static OperationResult Fail(IReadOnlyList<string> logs, string? tail) =>
        new(false, "Workbench reset failed", JoinLogs(logs, tail));

    static string JoinLogs(IReadOnlyList<string> logs, string? tail = null)
    {
        var parts = logs.Where(l => !string.IsNullOrWhiteSpace(l)).ToList();
        if (!string.IsNullOrWhiteSpace(tail))
            parts.Add(tail.Trim());
        return parts.Count == 0 ? null! : string.Join("\n", parts);
    }

    static string ShellQuote(string value) => "'" + value.Replace("'", "'\\''") + "'";

    async Task<(bool Ok, string Stdout, string Stderr)> RunGitBashAsync(string script, CancellationToken ct)
    {
        var psi = new System.Diagnostics.ProcessStartInfo("bash")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        psi.ArgumentList.Add("-c");
        psi.ArgumentList.Add(script);
        gitSsh.Apply(psi);
        using var proc = System.Diagnostics.Process.Start(psi)
            ?? throw new InvalidOperationException("Failed to start bash");
        var stdoutTask = proc.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        return (proc.ExitCode == 0, (await stdoutTask).Trim(), (await stderrTask).Trim());
    }
}
