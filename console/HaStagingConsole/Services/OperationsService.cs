using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class OperationsService(KitPaths paths, SidecarRunner sidecar, DockerRunner docker, DashboardBuilder dashboard)
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

    public Task<OperationResult> DeployToProdAsync(CancellationToken ct) =>
        dashboard.PromoteStagingToMainAsync(ct);

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
