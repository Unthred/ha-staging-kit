using HaStagingConsole.Models;
using HaStagingConsole.Services.Release;

namespace HaStagingConsole.Services;

/// <summary>
/// One-shot clean baseline: export live prod → git (YAML + Lovelace/helpers), align main with staging,
/// push GitHub, reset kit bookkeeping, rebuild staging from that snapshot.
/// </summary>
public sealed class BaselineFromProdService(
    KitPaths paths,
    GitSshConfigurator gitSsh,
    LovelaceParityDeferStore deferStore,
    LovelaceParityUndoStore undoStore,
    LovelaceParityFixActionStore fixActionStore,
    EntityDeployScanStore scanStore,
    ReleaseHistoryStore releaseHistory,
    SidecarRunner sidecar,
    DockerRunner docker,
    StagingQuiesceService stagingQuiesce,
    ProdAutomationExportService prodAutomationExport)
{
    static readonly TimeSpan LongScriptTimeout = TimeSpan.FromMinutes(12);

    static readonly string[] LovelaceRepoRelativePaths =
    [
        ".storage/lovelace.lovelace",
        ".storage/lovelace.map",
        ".storage/lovelace_dashboards",
        ".storage/lovelace_resources",
    ];

    public async Task<OperationResult> RunAsync(BaselineFromProdRequest request, CancellationToken ct)
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

        logs.Add("Step 1/7 — export live prod into git (YAML + Lovelace/helpers .storage)");
        var (exportOk, exportMsg) = await sidecar.RunScriptAsync(
            "BASELINE_SKIP_COMMIT=1 /sidecar/sbin/baseline-from-prod.sh",
            LongScriptTimeout,
            ct);
        logs.Add(exportMsg);
        if (!exportOk)
            return Fail(logs, "Prod → git export failed");

        logs.Add("Step 1b — export prod HA automations into git (includes UI-only automations)");
        var (autoOk, autoMsg) = await prodAutomationExport.ExportToRepoAsync(ct);
        logs.Add(autoMsg);
        if (!autoOk)
            return Fail(logs, autoMsg);

        var (commitOk, commitOut, commitErr) = await RunGitBashAsync(
            "git -C /repo config user.name 'ha-staging-kit' && git -C /repo config user.email 'ha-staging-kit@localhost' && " +
            "git -C /repo add -A && if git -C /repo diff --cached --quiet; then echo 'No file changes — keeping existing HEAD commit'; " +
            "else git -C /repo commit -m \"baseline: prod snapshot $(date -u +%Y-%m-%dT%H:%M:%SZ)\"; fi",
            ct);
        if (!commitOk)
            return Fail(logs, commitErr);
        if (!string.IsNullOrWhiteSpace(commitOut))
            logs.Add(commitOut.Trim());

        var (revOk, revOut, revErr) = await RunGitBashAsync("git -C /repo rev-parse HEAD", ct);
        if (!revOk)
            return Fail(logs, revErr);
        var sha = revOut.Trim();

        logs.Add($"Baseline commit: {sha[..Math.Min(7, sha.Length)]}");

        logs.Add("Step 2/7 — clear kit deploy-gate defer/undo/recheck state");
        deferStore.Clear();
        undoStore.Clear();
        fixActionStore.Clear();
        scanStore.ClearLastScan();

        logs.Add("Step 3/7 — reset release history and prod deploy tracker to baseline");
        releaseHistory.ResetForBaseline(sha);

        if (request.PushToGitHub)
        {
            logs.Add("Step 4/7 — align origin/main with baseline and push GitHub");
            var (fetchOk, _, fetchErr) = await RunGitBashAsync("git -C /repo fetch origin", ct);
            if (!fetchOk)
                return Fail(logs, fetchErr);

            var (mainOk, _, mainErr) = await RunGitBashAsync(
                $"git -C /repo checkout main && git -C /repo reset --hard {ShellQuote(sha)} && git -C /repo checkout {ShellQuote(branch)}",
                ct);
            if (!mainOk)
                return Fail(logs, mainErr);

            var (pushStagingOk, pushStagingOut, pushStagingErr) = await RunGitBashAsync(
                $"git -C /repo push --force-with-lease origin {ShellQuote(branch)}",
                ct);
            if (!pushStagingOk)
                return Fail(logs, pushStagingErr);
            if (!string.IsNullOrWhiteSpace(pushStagingOut))
                logs.Add(pushStagingOut.Trim());

            var (pushMainOk, pushMainOut, pushMainErr) = await RunGitBashAsync(
                "git -C /repo push --force-with-lease origin main",
                ct);
            if (!pushMainOk)
                return Fail(logs, pushMainErr);
            if (!string.IsNullOrWhiteSpace(pushMainOut))
                logs.Add(pushMainOut.Trim());
        }
        else
        {
            logs.Add("Step 4/7 — skipped GitHub push (pushToGitHub=false)");
        }

        StampRepoLovelaceFresh();
        logs.Add("Stamped git Lovelace mtimes — staging UI capture will not overwrite after storage sync");

        if (!request.RebuildStaging)
        {
            logs.Add("Steps 5–7 skipped — rebuild staging manually in Operations (Apply config, Storage sync, Mirror, Restart)");
            return new OperationResult(
                true,
                $"Baseline from prod — git and GitHub aligned at {sha[..Math.Min(7, sha.Length)]}. Rebuild staging when ready.",
                JoinLogs(logs));
        }

        if (request.FreshDatabase)
        {
            logs.Add("Step 5/7 — fresh staging recorder DB + wipe .storage (auth preserved)");
            var (freshOk, freshMsg) = await sidecar.RunScriptAsync(
                "/sidecar/sbin/prepare-staging-fresh.sh",
                LongScriptTimeout,
                ct);
            logs.Add(freshMsg);
            if (!freshOk)
                return Fail(logs, freshMsg);
        }
        else
        {
            logs.Add("Step 5/7 — keeping existing staging recorder DB");
        }

        logs.Add("Step 6/7 — apply git to staging + prod .storage sync");
        var (applyOk, applyMsg) = await sidecar.RunScriptAsync(
            "SKIP_GIT_FETCH=1 GIT_PULL=0 /sidecar/sbin/apply-config.sh",
            LongScriptTimeout,
            ct);
        logs.Add(applyMsg);
        if (!applyOk)
            return Fail(logs, applyMsg);

        if (request.DeployMirror)
        {
            logs.Add("Step 7/7 — deploy MQTT mirror + restart staging HA");
            var (mirrorOk, mirrorMsg) = await docker.RunScriptAsync(paths.DeployMirrorScript, "", ct);
            logs.Add(mirrorMsg);
            if (!mirrorOk)
                logs.Add("WARN: mirror deploy failed — run Deploy / refresh mirror manually");
        }
        else
        {
            logs.Add("Step 7/7 — restart staging HA (mirror deploy skipped)");
        }

        var container = EnvFile.Get(paths.EnvFile, "STAGING_HA_CONTAINER");
        if (string.IsNullOrWhiteSpace(container))
            return Fail(logs, "STAGING_HA_CONTAINER not set in .env");

        var (restartOk, restartMsg) = await docker.RestartContainerAsync(container, ct);
        logs.Add(restartMsg);
        if (!restartOk)
            return Fail(logs, restartMsg);

        logs.Add($"Restarted {container} — quiescing staging-unsafe integrations");
        var (quiesceOk, quiesceMsg) = await stagingQuiesce.QuiesceAsync(ct);
        logs.Add(quiesceMsg);
        if (!quiesceOk)
            logs.Add("WARN: post-restart quiesce had warnings");

        logs.Add("Regenerate staging LLAT in Settings if diagnostics show token errors. Reconfigure SmartThings/Tuya once if OAuth still fails.");

        return new OperationResult(
            true,
            $"Baseline from prod — git, GitHub, and staging rebuilt at {sha[..Math.Min(7, sha.Length)]}",
            JoinLogs(logs));
    }

    static string? ParseBaselineSha(string output)
    {
        foreach (var line in output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (line.StartsWith("BASELINE_SHA=", StringComparison.Ordinal))
                return line["BASELINE_SHA=".Length..].Trim();
        }

        return null;
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

    static OperationResult Fail(IReadOnlyList<string> logs, string? tail) =>
        new(false, "Baseline from prod failed", JoinLogs(logs, tail));

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

public sealed record BaselineFromProdRequest(
    bool PushToGitHub = true,
    bool FreshDatabase = true,
    bool DeployMirror = true,
    bool RebuildStaging = true);
