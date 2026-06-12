using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class OperationsService(KitPaths paths, DockerRunner docker)
{
    public Task<OperationResult> ApplyConfigAsync(CancellationToken ct) =>
        RunSidecarScript("/sidecar/sbin/apply-config.sh", "Apply config", ct);

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

        var psi = new System.Diagnostics.ProcessStartInfo("docker")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        psi.ArgumentList.Add("restart");
        psi.ArgumentList.Add(container);

        using var proc = System.Diagnostics.Process.Start(psi);
        if (proc is null)
            return new OperationResult(false, "Failed to start docker", null);
        var stdout = await proc.StandardOutput.ReadToEndAsync(ct);
        var stderr = await proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        var msg = string.IsNullOrWhiteSpace(stdout) ? stderr.Trim() : stdout.Trim();
        return new OperationResult(proc.ExitCode == 0, proc.ExitCode == 0 ? $"Restarted {container}" : "Restart failed", msg);
    }

    async Task<OperationResult> RunSidecarScript(string script, string label, CancellationToken ct)
    {
        if (!await docker.IsContainerRunningAsync(paths.SidecarContainer, ct))
            return new OperationResult(false, "Sidecar container is not running", null);

        var (ok, msg) = await docker.DockerExecAsync(paths.SidecarContainer, script, ct);
        return new OperationResult(ok, ok ? $"{label} completed" : $"{label} failed", msg);
    }
}
