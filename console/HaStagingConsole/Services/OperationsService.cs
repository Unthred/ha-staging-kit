using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class OperationsService(KitPaths paths, SidecarRunner sidecar, DockerRunner docker)
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
}
