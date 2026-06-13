using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class SettingsService(
    KitPaths paths,
    EnvWriter envWriter,
    OnboardingBootstrap bootstrap,
    OnboardingStore store,
    StagingTargetBuilder stagingTarget,
    MirrorEndpointResolver mirrorEndpoints)
{
    public async Task<SettingsView> GetAsync(CancellationToken ct)
    {
        var state = bootstrap.LoadOrBootstrap();
        if (state.Mirror.Enabled)
            state.Mirror = mirrorEndpoints.Resolve(state);
        var sidecar = EnvFile.Read(paths.ConfigEnvFile);
        var kit = EnvFile.Read(paths.EnvFile);
        var stagingTargetInfo = await stagingTarget.BuildAsync(state, kit, ct);

        return new SettingsView(
            state.Paths,
            state.Prod with
            {
                HasToken = File.Exists(paths.ProdTokenFile),
                HasSshKey = File.Exists(paths.SshKeyFile)
            },
            state.Staging with { HasToken = File.Exists(paths.StagingTokenFile) },
            state.Mirror,
            state.Topology,
            new SidecarIntervals(
                int.TryParse(sidecar.GetValueOrDefault("PERSON_POLL_INTERVAL", "60"), out var poll) ? poll : 60,
                int.TryParse(sidecar.GetValueOrDefault("STORAGE_SYNC_INTERVAL", "86400"), out var storage) ? storage : 86400,
                sidecar.GetValueOrDefault("APPLY_ON_START", "1") is "1" or "true" or "yes",
                sidecar.GetValueOrDefault("SKIP_STORAGE_SYNC", "0") is "1" or "true" or "yes"),
            kit.GetValueOrDefault("STAGING_HA_CONTAINER", ""),
            stagingTargetInfo);
    }

    public SettingsView Get() => GetAsync(CancellationToken.None).GetAwaiter().GetResult();

    public SettingsView Save(SettingsUpdateRequest req)
    {
        var state = bootstrap.LoadOrBootstrap();

        state.Paths = req.Paths;
        state.Prod = state.Prod with { Url = req.ProdUrl.Trim(), SshTarget = req.SshTarget.Trim() };
        state.Staging = state.Staging with { Url = req.StagingUrl.Trim() };
        state.Mirror = req.Mirror with { Enabled = req.Mirror.Enabled };
        if (state.Mirror.Enabled)
            state.Mirror = mirrorEndpoints.Resolve(state);
        state.Topology = req.Topology;

        if (!string.IsNullOrWhiteSpace(req.ProdToken))
            envWriter.WriteTokenFile(paths.ProdTokenFile, req.ProdUrl, req.ProdToken);
        else
            envWriter.SyncTokenUrl(paths.ProdTokenFile, req.ProdUrl);
        if (!string.IsNullOrWhiteSpace(req.StagingToken))
            envWriter.WriteTokenFile(paths.StagingTokenFile, req.StagingUrl, req.StagingToken);
        else
            envWriter.SyncTokenUrl(paths.StagingTokenFile, req.StagingUrl);
        if (!string.IsNullOrWhiteSpace(req.SshPrivateKey))
            envWriter.WriteSshKey(req.SshPrivateKey);

        envWriter.WriteKitEnv(state, req.StagingHaContainer);
        envWriter.WriteSidecarConfig(state, req.Intervals);
        store.Save(state);

        return Get();
    }
}