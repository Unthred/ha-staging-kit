using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class SettingsService(KitPaths paths, EnvWriter envWriter, OnboardingBootstrap bootstrap, OnboardingStore store)
{
    public SettingsView Get()
    {
        var state = bootstrap.LoadOrBootstrap();
        var sidecar = EnvFile.Read(paths.ConfigEnvFile);
        var kit = EnvFile.Read(paths.EnvFile);

        return new SettingsView(
            state.Paths,
            state.Prod with
            {
                HasToken = File.Exists(paths.ProdTokenFile),
                HasSshKey = File.Exists(paths.SshKeyFile)
            },
            state.Staging with { HasToken = File.Exists(paths.StagingTokenFile) },
            state.Mirror,
            new SidecarIntervals(
                int.TryParse(sidecar.GetValueOrDefault("PERSON_POLL_INTERVAL", "60"), out var poll) ? poll : 60,
                int.TryParse(sidecar.GetValueOrDefault("STORAGE_SYNC_INTERVAL", "86400"), out var storage) ? storage : 86400,
                sidecar.GetValueOrDefault("APPLY_ON_START", "1") is "1" or "true" or "yes",
                sidecar.GetValueOrDefault("SKIP_STORAGE_SYNC", "0") is "1" or "true" or "yes"),
            kit.GetValueOrDefault("STAGING_HA_CONTAINER", ""));
    }

    public SettingsView Save(SettingsUpdateRequest req)
    {
        var state = bootstrap.LoadOrBootstrap();

        state.Paths = req.Paths;
        state.Prod = state.Prod with { Url = req.ProdUrl.Trim(), SshTarget = req.SshTarget.Trim() };
        state.Staging = state.Staging with { Url = req.StagingUrl.Trim() };
        state.Mirror = req.Mirror;

        if (!string.IsNullOrWhiteSpace(req.ProdToken))
            envWriter.WriteTokenFile(paths.ProdTokenFile, req.ProdUrl, req.ProdToken);
        if (!string.IsNullOrWhiteSpace(req.StagingToken))
            envWriter.WriteTokenFile(paths.StagingTokenFile, req.StagingUrl, req.StagingToken);
        if (!string.IsNullOrWhiteSpace(req.SshPrivateKey))
            envWriter.WriteSshKey(req.SshPrivateKey);

        envWriter.WriteKitEnv(state, req.StagingHaContainer);
        envWriter.WriteSidecarConfig(state, req.Intervals);
        store.Save(state);

        return Get();
    }
}
