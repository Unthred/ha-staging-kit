using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class OnboardingBootstrap(KitPaths paths, OnboardingStore store, ILogger<OnboardingBootstrap> logger)
{
    public OnboardingState LoadOrBootstrap()
    {
        if (File.Exists(paths.OnboardingFile))
            return store.Load();

        var state = BootstrapFromEnv();
        if (HasExistingConfig(state))
        {
            logger.LogInformation("Bootstrapped onboarding state from existing .env and secrets");
            store.Save(state);
        }

        return state;
    }

    public bool HasExistingConfig(OnboardingState state) =>
        !string.IsNullOrWhiteSpace(state.Paths.HaConfigRepo)
        && !string.IsNullOrWhiteSpace(state.Paths.HaStagingConfig)
        && File.Exists(paths.ProdTokenFile)
        && File.Exists(paths.StagingTokenFile);

    OnboardingState BootstrapFromEnv()
    {
        var env = EnvFile.Read(paths.EnvFile);
        var sidecar = EnvFile.Read(paths.ConfigEnvFile);
        var state = new OnboardingState();

        state.Paths = new PathSettings(
            env.GetValueOrDefault("HA_CONFIG_REPO", ""),
            env.GetValueOrDefault("HA_BRANCH", sidecar.GetValueOrDefault("HA_BRANCH", "staging")),
            env.GetValueOrDefault("HA_STAGING_CONFIG", ""),
            env.GetValueOrDefault("SIDECAR_DATA", paths.SidecarData),
            env.GetValueOrDefault("MIRROR_DATA", ""));

        state.Prod = state.Prod with
        {
            Url = env.GetValueOrDefault("PROD_HA_URL", ""),
            SshTarget = SshTargetFromEnv(env)
        };

        state.Staging = state.Staging with
        {
            Url = env.GetValueOrDefault("STAGING_HA_URL", sidecar.GetValueOrDefault("STAGING_HA_URL", ""))
        };

        var mqttHost = env.GetValueOrDefault("PROD_MQTT_HOST", "");
        var mqttPort = int.TryParse(env.GetValueOrDefault("PROD_MQTT_PORT", "1883"), out var p) ? p : 1883;
        var mirrorConfigured = !string.IsNullOrWhiteSpace(mqttHost)
            && !string.IsNullOrWhiteSpace(state.Paths.MirrorData)
            && Directory.Exists(Path.Combine(state.Paths.MirrorData, "config"));

        state.Mirror = new MirrorSettings(mirrorConfigured, mqttHost, mqttPort);

        if (HasExistingConfig(state))
        {
            state.CurrentStep = 10;
            state.CompletedSteps =
            [
                "topology", "paths", "prod", "staging", "mirror", "deploy", "storage-sync"
            ];
            if (mirrorConfigured)
                state.CompletedSteps.Add("mirror-deploy");
        }

        return state;
    }

    static string SshTargetFromEnv(Dictionary<string, string> env)
    {
        var secrets = env.GetValueOrDefault("HA_SECRETS", "");
        if (string.IsNullOrWhiteSpace(secrets))
            return "";

        if (secrets.EndsWith("/secrets.yaml", StringComparison.OrdinalIgnoreCase))
            return secrets[..^"/secrets.yaml".Length];
        if (secrets.EndsWith("secrets.yaml", StringComparison.OrdinalIgnoreCase))
            return secrets.Replace("/secrets.yaml", "").Replace("secrets.yaml", "").TrimEnd('/');

        return secrets;
    }
}
