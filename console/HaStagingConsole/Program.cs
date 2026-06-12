using HaStagingConsole.Models;
using HaStagingConsole.Services;

var builder = WebApplication.CreateBuilder(args);
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    o.SerializerOptions.PropertyNameCaseInsensitive = true;
});
builder.Services.AddSingleton<KitPaths>();
builder.Services.AddSingleton<OnboardingStore>();
builder.Services.AddSingleton<EnvWriter>();
builder.Services.AddSingleton<OnboardingTests>();
builder.Services.AddHttpClient();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", service = "ha-staging-console" }));

app.MapGet("/api/onboarding/status", (OnboardingStore store) =>
{
    var state = store.Load();
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/topology", (TopologyRequest req, OnboardingStore store) =>
{
    var state = store.Load();
    state.Topology = new TopologySettings(req.ProdHaType, req.StagingHaType, req.SameHostAsKit);
    store.MarkStep(state, "topology", 2);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/paths", (PathsRequest req, OnboardingStore store, EnvWriter env) =>
{
    var state = store.Load();
    state.Paths = new PathSettings(
        req.HaConfigRepo.Trim(),
        req.HaBranch.Trim(),
        req.HaStagingConfig.Trim(),
        req.SidecarData.Trim(),
        req.MirrorData.Trim());
    env.WriteKitEnv(state);
    env.WriteSidecarConfig(state);
    store.MarkStep(state, "paths", 3);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/prod", (ProdSecretsRequest req, OnboardingStore store, EnvWriter env, KitPaths paths) =>
{
    var state = store.Load();
    state.Prod = state.Prod with { Url = req.Url.Trim(), SshTarget = req.SshTarget.Trim() };
    if (!string.IsNullOrWhiteSpace(req.Token))
        env.WriteTokenFile(paths.ProdTokenFile, req.Url, req.Token);
    if (!string.IsNullOrWhiteSpace(req.SshPrivateKey))
        env.WriteSshKey(req.SshPrivateKey);
    env.WriteKitEnv(state);
    store.MarkStep(state, "prod", 4);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/staging", (StagingSecretsRequest req, OnboardingStore store, EnvWriter env, KitPaths paths) =>
{
    var state = store.Load();
    state.Staging = state.Staging with { Url = req.Url.Trim() };
    if (!string.IsNullOrWhiteSpace(req.Token))
        env.WriteTokenFile(paths.StagingTokenFile, req.Url, req.Token);
    env.WriteKitEnv(state);
    env.WriteSidecarConfig(state);
    store.MarkStep(state, "staging", 5);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/mirror", (MirrorRequest req, OnboardingStore store, EnvWriter env) =>
{
    var state = store.Load();
    state.Mirror = new MirrorSettings(req.Enabled, req.ProdMqttHost.Trim(), req.ProdMqttPort);
    env.WriteKitEnv(state);
    store.MarkStep(state, "mirror", 6);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/ha-mqtt-confirmed", (OnboardingStore store) =>
{
    var state = store.Load();
    state.HaMqttConfirmed = true;
    store.MarkStep(state, "ha-mqtt", 10);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/test/prod-api", async (OnboardingTests tests, CancellationToken ct) =>
    Results.Ok(await tests.TestProdApiAsync(ct)));

app.MapPost("/api/onboarding/test/staging-api", async (OnboardingTests tests, CancellationToken ct) =>
    Results.Ok(await tests.TestStagingApiAsync(ct)));

app.MapPost("/api/onboarding/test/ssh", async (OnboardingStore store, OnboardingTests tests, CancellationToken ct) =>
    Results.Ok(await tests.TestSshAsync(store.Load(), ct)));

app.MapPost("/api/onboarding/test/mqtt", async (OnboardingStore store, OnboardingTests tests, CancellationToken ct) =>
    Results.Ok(await tests.TestMqttAsync(store.Load().Mirror, ct)));

app.MapPost("/api/onboarding/deploy", async (OnboardingStore store, KitPaths paths, CancellationToken ct) =>
{
    var state = store.Load();
    var withMirror = state.Mirror.Enabled ? "--with-mirror" : "";
    var result = await RunScriptAsync(paths.DeployScript, withMirror, paths.KitRoot, ct);
    if (result.Ok)
        store.MarkStep(state, "deploy", state.Mirror.Enabled ? 7 : 10);
    return Results.Ok(new DeployResult(result.Ok, result.Ok ? "Sidecar deployed" : "Deploy failed", result.Message));
});

app.MapPost("/api/onboarding/storage-sync", async (KitPaths paths, OnboardingStore store, CancellationToken ct) =>
{
    var result = await RunDockerAsync(paths, ["exec", paths.SidecarContainer, "/sidecar/sbin/sync-storage.sh"], ct);
    if (result.Ok)
    {
        var state = store.Load();
        store.MarkStep(state, "storage-sync", 8);
    }
    return Results.Ok(new DeployResult(result.Ok, result.Ok ? "Storage sync started" : "Storage sync failed", result.Message));
});

app.MapPost("/api/onboarding/deploy-mirror", async (KitPaths paths, OnboardingStore store, CancellationToken ct) =>
{
    var mirrorScript = Path.Combine(paths.KitRoot, "scripts", "deploy-mirror.sh");
    var result = await RunScriptAsync(mirrorScript, "", paths.KitRoot, ct);
    if (result.Ok)
    {
        var state = store.Load();
        store.MarkStep(state, "mirror-deploy", 9);
    }
    return Results.Ok(new DeployResult(result.Ok, result.Ok ? "Mirror deployed" : "Mirror deploy failed", result.Message));
});

app.MapPost("/api/onboarding/health", async (OnboardingStore store, OnboardingTests tests, CancellationToken ct) =>
{
    var state = store.Load();
    state.LastHealthChecks = (await tests.RunHealthChecksAsync(state, ct)).ToList();
    store.MarkStep(state, "health", 11);
    return Results.Ok(state.LastHealthChecks);
});

app.MapPost("/api/onboarding/complete", (OnboardingStore store) =>
{
    var state = store.Load();
    state.IsComplete = true;
    store.MarkStep(state, "done", 11);
    return Results.Ok(store.ToStatus(state));
});

app.MapGet("/api/onboarding/report", (OnboardingStore store) =>
{
    var state = store.Load();
    var status = store.ToStatus(state);
    var next = new List<string>
    {
        "Edit HA YAML on the staging branch and run Apply from the console dashboard.",
        "Person sync runs automatically while the sidecar is up.",
    };
    if (state.Mirror.Enabled)
        next.Add("Keep staging HA pointed at the mirror broker (read-only by default).");
    if (!state.Mirror.Enabled)
        next.Add("Optional: enable MQTT mirror later from Settings if you need live device states.");

    var summary = state.IsComplete
        ? "Onboarding complete. Staging sidecar is configured."
        : "Onboarding in progress — resume at /onboarding.";

    return Results.Ok(new OnboardingReport(summary, next, status.LastHealthChecks ?? []));
});

app.MapFallbackToFile("index.html");
app.Run("http://0.0.0.0:8080");

static async Task<(bool Ok, string Message)> RunScriptAsync(string script, string args, string kitRoot, CancellationToken ct)
{
    if (!File.Exists(script))
        return (false, $"Script not found: {script}");

    var psi = new System.Diagnostics.ProcessStartInfo("bash")
    {
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false,
        WorkingDirectory = kitRoot
    };
    psi.ArgumentList.Add(script);
    if (!string.IsNullOrWhiteSpace(args))
        psi.ArgumentList.Add(args);

    using var proc = System.Diagnostics.Process.Start(psi);
    if (proc is null)
        return (false, "Failed to start bash");
    var stdout = await proc.StandardOutput.ReadToEndAsync(ct);
    var stderr = await proc.StandardError.ReadToEndAsync(ct);
    await proc.WaitForExitAsync(ct);
    var tail = (stdout + stderr).Trim();
    if (tail.Length > 4000)
        tail = tail[^4000..];
    return (proc.ExitCode == 0, tail);
}

static async Task<(bool Ok, string Message)> RunDockerAsync(KitPaths paths, string[] args, CancellationToken ct)
{
    var psi = new System.Diagnostics.ProcessStartInfo("docker")
    {
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false
    };
    foreach (var arg in args)
        psi.ArgumentList.Add(arg);

    using var proc = System.Diagnostics.Process.Start(psi);
    if (proc is null)
        return (false, "Failed to start docker");
    var stdout = await proc.StandardOutput.ReadToEndAsync(ct);
    var stderr = await proc.StandardError.ReadToEndAsync(ct);
    await proc.WaitForExitAsync(ct);
    return (proc.ExitCode == 0, string.IsNullOrWhiteSpace(stdout) ? stderr.Trim() : stdout.Trim());
}
