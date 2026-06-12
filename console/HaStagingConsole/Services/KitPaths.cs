namespace HaStagingConsole.Services;

public sealed class KitPaths(IConfiguration config)
{
    public string SidecarData { get; } = config["SIDECAR_DATA"] ?? "/sidecar-data";
    public string KitRoot { get; } = config["KIT_ROOT"] ?? "/kit";
    public string OnboardingFile => Path.Combine(SidecarData, "onboarding.json");
    public string EnvFile => Path.Combine(KitRoot, ".env");
    public string ConfigEnvFile => Path.Combine(SidecarData, "config.env");
    public string SecretsDir => Path.Combine(SidecarData, "secrets");
    public string ProdTokenFile => Path.Combine(SecretsDir, "ha-prod-api.token");
    public string StagingTokenFile => Path.Combine(SecretsDir, "ha-staging-api.token");
    public string SshKeyFile => Path.Combine(SecretsDir, "id_ed25519");
    public string DeployScript => Path.Combine(KitRoot, "scripts", "deploy.sh");
    public string SidecarContainer { get; } = config["SIDECAR_CONTAINER"] ?? "ha-staging-sidecar";
}
