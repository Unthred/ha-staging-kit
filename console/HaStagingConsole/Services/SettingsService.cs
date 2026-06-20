using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class SettingsService(
    KitPaths paths,
    EnvWriter envWriter,
    OnboardingBootstrap bootstrap,
    OnboardingStore store,
    StagingTargetBuilder stagingTarget,
    MirrorEndpointResolver mirrorEndpoints,
    ProdWritesGuard prodWrites)
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
                sidecar.GetValueOrDefault("APPLY_ON_START", "auto") is "1" or "true" or "yes",
                sidecar.GetValueOrDefault("SKIP_STORAGE_SYNC", "0") is "1" or "true" or "yes"),
            kit.GetValueOrDefault("STAGING_HA_CONTAINER", ""),
            stagingTargetInfo,
            state.Appearance,
            prodWrites.GetView());
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

    public AppearanceSettings SaveAppearance(AppearanceSettings appearance)
    {
        var state = bootstrap.LoadOrBootstrap();
        state.Appearance = NormalizeAppearance(appearance);
        store.Save(state);
        return state.Appearance;
    }

    public ReleaseSafetyView SaveReleaseSafety(bool prodWritesEnabled)
    {
        var state = bootstrap.LoadOrBootstrap();
        state.ProdWritesEnabled = prodWritesEnabled;
        store.Save(state);
        return prodWrites.GetView();
    }

    static AppearanceSettings NormalizeAppearance(AppearanceSettings appearance)
    {
        var theme = appearance.ThemeMode is "light" or "dark" or "system" ? appearance.ThemeMode : "dark";
        var badge = NormalizeHex(appearance.BadgeColor, "#ffb74d");
        var accent = NormalizeHex(appearance.AccentColor, "#03a9f4");
        var density = appearance.Density is "compact" or "comfortable" ? appearance.Density : "comfortable";
        var fontScale = appearance.FontScale is "small" or "default" or "large" ? appearance.FontScale : "default";
        var statusIntensity = appearance.StatusIntensity is "soft" or "default" or "strong"
            ? appearance.StatusIntensity
            : "default";

        return appearance with
        {
            ThemeMode = theme,
            BadgeColor = badge,
            AccentColor = accent,
            Density = density,
            FontScale = fontScale,
            StatusIntensity = statusIntensity,
        };
    }

    static string NormalizeHex(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        var v = value.Trim();
        return System.Text.RegularExpressions.Regex.IsMatch(v, "^#[0-9a-fA-F]{6}$") ? v : fallback;
    }
}
