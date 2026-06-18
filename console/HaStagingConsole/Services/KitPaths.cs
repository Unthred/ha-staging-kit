namespace HaStagingConsole.Services;

public sealed class KitPaths(IConfiguration config)
{
    public string SidecarData { get; } = config["SIDECAR_DATA"] ?? "/sidecar-data";
    public string KitRoot { get; } = config["KIT_ROOT"] ?? "/kit";
    public string KitContainer { get; } =
        config["KIT_CONTAINER"] ?? config["WEB_CONTAINER"] ?? config["CONSOLE_CONTAINER"] ?? "ha-staging-kit";

    public string OnboardingFile => Path.Combine(SidecarData, "onboarding.json");
    public string EnvFile => Path.Combine(KitRoot, ".env");
    public string HostEnvFile { get; } = config["HOST_ENV_FILE"] ?? "/sidecar-data/.env.host";
    public string ConfigEnvFile => Path.Combine(SidecarData, "config.env");
    public string SecretsDir => Path.Combine(SidecarData, "secrets");
    public string ProdTokenFile => Path.Combine(SecretsDir, "ha-prod-api.token");
    public string StagingTokenFile => Path.Combine(SecretsDir, "ha-staging-api.token");
    public string SshKeyFile => Path.Combine(SecretsDir, "id_ed25519");
    public string LastProdDeployShaFile => Path.Combine(SidecarData, "last-prod-deploy.sha");
    public string LastProdDeployPreviousShaFile => Path.Combine(SidecarData, "last-prod-deploy-previous.sha");
    public string DeployScript => Path.Combine(KitRoot, "scripts", "deploy.sh");
    public string DeployMirrorScript => Path.Combine(KitRoot, "scripts", "deploy-mirror.sh");
    public string MirrorControlScript => Path.Combine(KitRoot, "scripts", "mirror-control-mode.sh");

    /// <summary>Host path for kit data (from .env), for user-facing messages.</summary>
    public string HostKitDataDir =>
        FirstNonEmpty(global::HaStagingConsole.Services.EnvFile.Get(EnvFile, "SIDECAR_DATA"), SidecarData) ?? SidecarData;

    public string SyncLogLocation => $"{HostKitDataDir}/sync.log";

    static string? FirstNonEmpty(params string?[] values)
    {
        foreach (var v in values)
        {
            if (!string.IsNullOrWhiteSpace(v))
                return v;
        }
        return null;
    }

    public string SidecarRoot { get; } = "/sidecar";

    /// <summary>Legacy names — single-container kit.</summary>
    public string SyncContainer => KitContainer;
    public string SidecarContainer => KitContainer;
    public string WebContainer => KitContainer;
    public string MirrorContainer => KitContainer;

    public IReadOnlyList<string> KitContainerCandidates =>
        DistinctNames(KitContainer, "ha-staging-kit-web", "ha-staging-kit-sync", "ha-staging-console", "ha-staging-sidecar");

    public IReadOnlyList<string> SyncContainerCandidates => KitContainerCandidates;
    public IReadOnlyList<string> WebContainerCandidates => KitContainerCandidates;
    public IReadOnlyList<string> MirrorContainerCandidates => KitContainerCandidates;

    static IReadOnlyList<string> DistinctNames(params string[] names) =>
        names.Where(n => !string.IsNullOrWhiteSpace(n)).Distinct(StringComparer.Ordinal).ToList();
}
