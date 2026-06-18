using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class SystemService(
    KitPaths paths,
    SidecarRunner sidecar,
    DockerRunner docker,
    StartupGuard startup,
    ILogger<SystemService> logger)
{
    public async Task<IReadOnlyList<ContainerStatus>> GetContainersAsync(CancellationToken ct)
    {
        try
        {
            var kitRunning = startup.IsWarmingUp
                ? true
                : await docker.IsContainerRunningAsync(paths.KitContainerCandidates, ct);
            var syncRunning = await sidecar.IsSyncLoopRunningAsync(ct);
            var mirrorRunning = await sidecar.IsMirrorRunningAsync(ct);

            logger.LogDebug(
                "Container status: kit={KitRunning} sync={SyncRunning} mirror={MirrorRunning}",
                kitRunning,
                syncRunning,
                mirrorRunning);

            return
            [
                new ContainerStatus(
                    "kit",
                    "Staging kit",
                    string.Join(" or ", paths.KitContainerCandidates),
                    kitRunning ? paths.KitContainer : null,
                    kitRunning),
                new ContainerStatus(
                    "sync",
                    "Config sync loop",
                    "in-process (sidecar/sbin/run.sh)",
                    syncRunning ? "run.sh" : null,
                    syncRunning),
                new ContainerStatus(
                    "mirror",
                    "MQTT mirror",
                    "in-process (mosquitto)",
                    mirrorRunning ? "mosquitto" : null,
                    mirrorRunning),
            ];
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            logger.LogWarning("GetContainersAsync cancelled (request timeout)");
            throw;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "GetContainersAsync failed");
            throw;
        }
    }

    public async Task<OperationResult> RestartContainerAsync(string role, CancellationToken ct) => role switch
    {
        "web" or "console" or "kit" => await RestartKitAsync(ct),
        "sync" => ToResult(await sidecar.RestartSyncLoopAsync(ct), "Config sync loop restarted"),
        "mirror" => ToResult(await sidecar.RestartMirrorAsync(paths, ct), "MQTT mirror restarted"),
        _ => new OperationResult(false, $"Unknown role: {role}", null)
    };

    async Task<OperationResult> RestartKitAsync(CancellationToken ct)
    {
        var resolved = await docker.ResolveContainerAsync(paths.KitContainerCandidates, ct);
        if (resolved is null)
        {
            logger.LogWarning("Kit container not found among: {Candidates}", string.Join(", ", paths.KitContainerCandidates));
            return new OperationResult(false, $"Kit container not found ({paths.KitContainer})", null);
        }

        return await docker.RestartContainerDetachedAsync(resolved, "Staging kit", ct);
    }

    static OperationResult ToResult((bool Ok, string Message) r, string okLabel) =>
        new(r.Ok, r.Ok ? okLabel : r.Message, r.Message);
}
