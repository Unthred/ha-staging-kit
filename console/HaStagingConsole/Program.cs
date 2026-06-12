using HaStagingConsole.Models;
using HaStagingConsole.Services;

var builder = WebApplication.CreateBuilder(args);
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    o.SerializerOptions.PropertyNameCaseInsensitive = true;
});
builder.Services.AddSingleton<KitPaths>();
builder.Services.AddSingleton<DockerRunner>();
builder.Services.AddSingleton<OnboardingStore>();
builder.Services.AddSingleton<OnboardingBootstrap>();
builder.Services.AddSingleton<EnvWriter>();
builder.Services.AddSingleton<OnboardingTests>();
builder.Services.AddSingleton<StatusService>();
builder.Services.AddSingleton<SettingsService>();
builder.Services.AddSingleton<OperationsService>();
builder.Services.AddHttpClient();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", service = "ha-staging-console" }));

app.MapGet("/api/dashboard", async (StatusService status, CancellationToken ct) =>
    Results.Ok(await status.GetDashboardAsync(ct)));

app.MapGet("/api/settings", (SettingsService settings) => Results.Ok(settings.Get()));
app.MapPost("/api/settings", (SettingsUpdateRequest req, SettingsService settings) =>
    Results.Ok(settings.Save(req)));

app.MapPost("/api/operations/apply-config", async (OperationsService ops, CancellationToken ct) =>
    Results.Ok(await ops.ApplyConfigAsync(ct)));
app.MapPost("/api/operations/person-poll", async (OperationsService ops, CancellationToken ct) =>
    Results.Ok(await ops.PersonPollAsync(ct)));
app.MapPost("/api/operations/storage-sync", async (OperationsService ops, CancellationToken ct) =>
    Results.Ok(await ops.StorageSyncAsync(ct)));
app.MapPost("/api/operations/mirror-mode", async (MirrorModeRequest req, OperationsService ops, CancellationToken ct) =>
    Results.Ok(await ops.SetMirrorModeAsync(req.ControlMode, ct)));
app.MapPost("/api/operations/deploy-mirror", async (OperationsService ops, CancellationToken ct) =>
    Results.Ok(await ops.DeployMirrorAsync(ct)));
app.MapPost("/api/operations/restart-staging", async (OperationsService ops, CancellationToken ct) =>
    Results.Ok(await ops.RestartStagingHaAsync(ct)));

app.MapGet("/api/onboarding/status", (OnboardingBootstrap bootstrap, OnboardingStore store) =>
{
    var state = bootstrap.LoadOrBootstrap();
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/topology", (TopologyRequest req, OnboardingBootstrap bootstrap, OnboardingStore store) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.Topology = new TopologySettings(req.ProdHaType, req.StagingHaType, req.SameHostAsKit);
    store.MarkStep(state, "topology", 2);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/paths", (PathsRequest req, OnboardingBootstrap bootstrap, OnboardingStore store, EnvWriter env) =>
{
    var state = bootstrap.LoadOrBootstrap();
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

app.MapPost("/api/onboarding/prod", (ProdSecretsRequest req, OnboardingBootstrap bootstrap, OnboardingStore store, EnvWriter env, KitPaths paths) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.Prod = state.Prod with { Url = req.Url.Trim(), SshTarget = req.SshTarget.Trim() };
    if (!string.IsNullOrWhiteSpace(req.Token))
        env.WriteTokenFile(paths.ProdTokenFile, req.Url, req.Token);
    if (!string.IsNullOrWhiteSpace(req.SshPrivateKey))
        env.WriteSshKey(req.SshPrivateKey);
    env.WriteKitEnv(state);
    store.MarkStep(state, "prod", 4);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/staging", (StagingSecretsRequest req, OnboardingBootstrap bootstrap, OnboardingStore store, EnvWriter env, KitPaths paths) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.Staging = state.Staging with { Url = req.Url.Trim() };
    if (!string.IsNullOrWhiteSpace(req.Token))
        env.WriteTokenFile(paths.StagingTokenFile, req.Url, req.Token);
    env.WriteKitEnv(state);
    env.WriteSidecarConfig(state);
    store.MarkStep(state, "staging", 5);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/mirror", (MirrorRequest req, OnboardingBootstrap bootstrap, OnboardingStore store, EnvWriter env) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.Mirror = new MirrorSettings(req.Enabled, req.ProdMqttHost.Trim(), req.ProdMqttPort);
    env.WriteKitEnv(state);
    store.MarkStep(state, "mirror", 6);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/ha-mqtt-confirmed", (OnboardingBootstrap bootstrap, OnboardingStore store) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.HaMqttConfirmed = true;
    store.MarkStep(state, "ha-mqtt", 10);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/skip-to-dashboard", (OnboardingBootstrap bootstrap, OnboardingStore store) =>
{
    var state = bootstrap.LoadOrBootstrap();
    if (!bootstrap.HasExistingConfig(state))
        return Results.BadRequest(new { message = "Configure paths and tokens before skipping onboarding." });

    state.IsComplete = true;
    store.MarkStep(state, "done", 11);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/test/prod-api", async (OnboardingTests tests, CancellationToken ct) =>
    Results.Ok(await tests.TestProdApiAsync(ct)));

app.MapPost("/api/onboarding/test/staging-api", async (OnboardingTests tests, CancellationToken ct) =>
    Results.Ok(await tests.TestStagingApiAsync(ct)));

app.MapPost("/api/onboarding/test/ssh", async (OnboardingBootstrap bootstrap, OnboardingStore store, OnboardingTests tests, CancellationToken ct) =>
    Results.Ok(await tests.TestSshAsync(bootstrap.LoadOrBootstrap(), ct)));

app.MapPost("/api/onboarding/test/mqtt", async (OnboardingBootstrap bootstrap, OnboardingStore store, OnboardingTests tests, CancellationToken ct) =>
    Results.Ok(await tests.TestMqttAsync(bootstrap.LoadOrBootstrap().Mirror, ct)));

app.MapPost("/api/onboarding/deploy", async (OnboardingBootstrap bootstrap, OnboardingStore store, KitPaths paths, DockerRunner docker, CancellationToken ct) =>
{
    var state = bootstrap.LoadOrBootstrap();
    var withMirror = state.Mirror.Enabled ? "--with-mirror" : "";
    var result = await docker.RunScriptAsync(paths.DeployScript, withMirror, ct);
    if (result.Ok)
        store.MarkStep(state, "deploy", state.Mirror.Enabled ? 7 : 10);
    return Results.Ok(new DeployResult(result.Ok, result.Ok ? "Sidecar deployed" : "Deploy failed", result.Message));
});

app.MapPost("/api/onboarding/storage-sync", async (KitPaths paths, OnboardingBootstrap bootstrap, OnboardingStore store, DockerRunner docker, CancellationToken ct) =>
{
    var result = await docker.DockerExecAsync(paths.SidecarContainer, "/sidecar/sbin/sync-storage.sh", ct);
    if (result.Ok)
    {
        var state = bootstrap.LoadOrBootstrap();
        store.MarkStep(state, "storage-sync", 8);
    }
    return Results.Ok(new DeployResult(result.Ok, result.Ok ? "Storage sync completed" : "Storage sync failed", result.Message));
});

app.MapPost("/api/onboarding/deploy-mirror", async (KitPaths paths, OnboardingBootstrap bootstrap, OnboardingStore store, DockerRunner docker, CancellationToken ct) =>
{
    var result = await docker.RunScriptAsync(paths.DeployMirrorScript, "", ct);
    if (result.Ok)
    {
        var state = bootstrap.LoadOrBootstrap();
        store.MarkStep(state, "mirror-deploy", 9);
    }
    return Results.Ok(new DeployResult(result.Ok, result.Ok ? "Mirror deployed" : "Mirror deploy failed", result.Message));
});

app.MapPost("/api/onboarding/health", async (OnboardingBootstrap bootstrap, OnboardingStore store, OnboardingTests tests, CancellationToken ct) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.LastHealthChecks = (await tests.RunHealthChecksAsync(state, ct)).ToList();
    store.MarkStep(state, "health", 11);
    return Results.Ok(state.LastHealthChecks);
});

app.MapPost("/api/onboarding/complete", (OnboardingBootstrap bootstrap, OnboardingStore store) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.IsComplete = true;
    store.MarkStep(state, "done", 11);
    return Results.Ok(store.ToStatus(state));
});

app.MapGet("/api/onboarding/report", (OnboardingBootstrap bootstrap, OnboardingStore store) =>
{
    var state = bootstrap.LoadOrBootstrap();
    var status = store.ToStatus(state);
    var next = new List<string>
    {
        "Edit HA YAML on the staging branch and run Apply from the console dashboard.",
        "Person sync runs automatically while the sidecar is up.",
    };
    if (state.Mirror.Enabled)
        next.Add("Keep staging HA pointed at the mirror broker (read-only by default).");
    else
        next.Add("Optional: enable MQTT mirror later from Settings if you need live device states.");

    var summary = state.IsComplete
        ? "Onboarding complete. Staging sidecar is configured."
        : "Onboarding in progress — resume at /onboarding.";

    return Results.Ok(new OnboardingReport(summary, next, status.LastHealthChecks ?? []));
});

app.MapFallbackToFile("index.html");
app.Run("http://0.0.0.0:8080");
