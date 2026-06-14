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
builder.Services.AddSingleton<SidecarRunner>();
builder.Services.AddSingleton<OnboardingStore>();
builder.Services.AddSingleton<OnboardingBootstrap>();
builder.Services.AddSingleton<EnvWriter>();
builder.Services.AddSingleton<OnboardingTests>();
builder.Services.AddSingleton<LiveMetricsStore>();
builder.Services.AddSingleton<DashboardBuilder>();
builder.Services.AddSingleton<StagingTargetBuilder>();
builder.Services.AddSingleton<StatusService>();
builder.Services.AddSingleton<SettingsService>();
builder.Services.AddSingleton<OperationsService>();
builder.Services.AddSingleton<SystemService>();
builder.Services.AddSingleton<PathBrowserService>();
builder.Services.AddSingleton<SetupDetector>();
builder.Services.AddSingleton<MirrorEndpointResolver>();
builder.Services.AddHttpClient();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", service = "ha-staging-kit" }));

app.MapGet("/api/system/containers", async (SystemService system, CancellationToken ct) =>
    Results.Ok(await system.GetContainersAsync(ct)));

app.MapPost("/api/system/restart-container", async (RestartContainerRequest req, SystemService system, CancellationToken ct) =>
    Results.Ok(await system.RestartContainerAsync(req.Role, ct)));

app.MapGet("/api/dashboard", async (StatusService status, CancellationToken ct) =>
    Results.Ok(await status.GetDashboardAsync(ct)));

app.MapGet("/api/git/diff", async (string? path, DashboardBuilder dashboard, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { message = "path is required" });

    var diff = await dashboard.GetGitFileDiffAsync(path, ct);
    return diff is null
        ? Results.NotFound(new { message = "File is not changed or path is invalid" })
        : Results.Ok(diff);
});

app.MapPost("/api/git/commit", async (GitCommitRequest req, DashboardBuilder dashboard, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(req.Scope))
        return Results.BadRequest(new { message = "scope is required (ha or repo)" });

    return Results.Ok(await dashboard.CommitChangedFilesAsync(req.Scope, req.Message, ct));
});

app.MapGet("/api/diagnostics", async (StatusService status, CancellationToken ct) =>
    Results.Ok(await status.GetDiagnosticsAsync(ct)));

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
app.MapPost("/api/operations/ship-to-staging", async (OperationsService ops, CancellationToken ct) =>
    Results.Ok(await ops.ShipToStagingAsync(ct)));
app.MapPost("/api/operations/deploy-to-prod", async (OperationsService ops, CancellationToken ct) =>
    Results.Ok(await ops.DeployToProdAsync(ct)));
app.MapPost("/api/git/push", async (GitPushRequest? req, DashboardBuilder dashboard, CancellationToken ct) =>
    Results.Ok(await dashboard.PushBranchAsync(req?.Branch, ct)));

app.MapGet("/api/onboarding/status", async (
    OnboardingBootstrap bootstrap,
    OnboardingStore store,
    SetupDetector detector,
    EnvWriter envWriter,
    SidecarRunner sidecar,
    CancellationToken ct) =>
{
    var state = bootstrap.LoadOrBootstrap();
    var (detected, changed) = await detector.DetectAndMergeAsync(state, ct);
    if (changed)
    {
        detector.PersistMergedEnv(state, detected, envWriter);
        store.Save(state);
    }

    var mirrorRunning = await sidecar.IsMirrorRunningAsync(ct);
    return Results.Ok(store.ToStatus(state, mirrorRunning, detected));
});

app.MapPost("/api/onboarding/topology", (TopologyRequest req, OnboardingBootstrap bootstrap, OnboardingStore store, EnvWriter env, MirrorEndpointResolver mirrorEndpoints) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.Topology = new TopologySettings(req.ProdHaType, req.StagingHaType, req.SameHostAsKit);
    mirrorEndpoints.ApplyIfEnabled(state);
    env.WriteSidecarConfig(state);
    env.WriteKitEnv(state);
    store.MarkStep(state, "topology", 2);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/paths", (PathsRequest req, OnboardingBootstrap bootstrap, OnboardingStore store, EnvWriter env, MirrorEndpointResolver mirrorEndpoints) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.Paths = new PathSettings(
        req.HaConfigRepo.Trim(),
        req.HaBranch.Trim(),
        req.HaStagingConfig.Trim(),
        req.SidecarData.Trim(),
        req.MirrorData.Trim());
    mirrorEndpoints.ApplyIfEnabled(state);
    env.WriteKitEnv(state);
    env.WriteSidecarConfig(state);
    store.MarkStep(state, "paths", 3);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/prod", (ProdSecretsRequest req, OnboardingBootstrap bootstrap, OnboardingStore store, EnvWriter env, KitPaths paths, MirrorEndpointResolver mirrorEndpoints) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.Prod = state.Prod with { Url = req.Url.Trim(), SshTarget = req.SshTarget.Trim() };
    if (!string.IsNullOrWhiteSpace(req.Token))
        env.WriteTokenFile(paths.ProdTokenFile, req.Url, req.Token);
    else
        env.SyncTokenUrl(paths.ProdTokenFile, req.Url);
    if (!string.IsNullOrWhiteSpace(req.SshPrivateKey))
        env.WriteSshKey(req.SshPrivateKey);
    mirrorEndpoints.ApplyIfEnabled(state);
    env.WriteKitEnv(state);
    store.MarkStep(state, "prod", 4);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/staging", (StagingSecretsRequest req, OnboardingBootstrap bootstrap, OnboardingStore store, EnvWriter env, KitPaths paths, MirrorEndpointResolver mirrorEndpoints) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.Staging = state.Staging with { Url = req.Url.Trim() };
    if (!string.IsNullOrWhiteSpace(req.Token))
        env.WriteTokenFile(paths.StagingTokenFile, req.Url, req.Token);
    else
        env.SyncTokenUrl(paths.StagingTokenFile, req.Url);
    mirrorEndpoints.ApplyIfEnabled(state);
    env.WriteKitEnv(state);
    env.WriteSidecarConfig(state);
    store.MarkStep(state, "staging", 5);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/mirror", (MirrorRequest req, OnboardingBootstrap bootstrap, OnboardingStore store, EnvWriter env, MirrorEndpointResolver mirrorEndpoints) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.Mirror = state.Mirror with { Enabled = req.Enabled };
    if (state.Mirror.Enabled)
        state.Mirror = mirrorEndpoints.Resolve(state);
    env.WriteKitEnv(state);
    env.WriteSidecarConfig(state);
    store.MarkStep(state, "mirror", 7);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/ha-mqtt-confirmed", (OnboardingBootstrap bootstrap, OnboardingStore store) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.HaMqttConfirmed = true;
    if (!state.CompletedSteps.Contains("ha-mqtt"))
        state.CompletedSteps.Add("ha-mqtt");
    state.CurrentStep = Math.Max(state.CurrentStep, 7);
    store.Save(state);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/skip-to-dashboard", (OnboardingBootstrap bootstrap, OnboardingStore store) =>
{
    var state = bootstrap.LoadOrBootstrap();
    if (!bootstrap.HasExistingConfig(state))
        return Results.BadRequest(new { message = "Configure paths and tokens before skipping onboarding." });

    state.IsComplete = true;
    store.MarkStep(state, "done", 8);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/test/prod-api", async (ApiTestRequest? req, OnboardingTests tests, CancellationToken ct) =>
    Results.Ok(await tests.TestProdApiAsync(req?.Url, req?.Token, ct)));

app.MapPost("/api/onboarding/test/staging-api", async (ApiTestRequest? req, OnboardingTests tests, CancellationToken ct) =>
    Results.Ok(await tests.TestStagingApiAsync(req?.Url, req?.Token, ct)));

app.MapPost("/api/onboarding/test/ssh", async (SshTestRequest? req, OnboardingBootstrap bootstrap, OnboardingTests tests, CancellationToken ct) =>
    Results.Ok(await tests.TestSshAsync(req?.SshTarget, req?.SshPrivateKey, bootstrap.LoadOrBootstrap(), ct)));

app.MapPost("/api/onboarding/test/mqtt", async (MqttTestRequest? req, OnboardingBootstrap bootstrap, OnboardingTests tests, CancellationToken ct) =>
    Results.Ok(await tests.TestMqttAsync(bootstrap.LoadOrBootstrap().Mirror, req ?? new MqttTestRequest(null, null), ct)));

app.MapGet("/api/onboarding/mounts", (OnboardingBootstrap bootstrap, PathBrowserService browser) =>
    Results.Ok(browser.GetMountHints(bootstrap.LoadOrBootstrap())));

app.MapGet("/api/onboarding/browse", (string? path, OnboardingBootstrap bootstrap, PathBrowserService browser) =>
    Results.Ok(browser.Browse(path, bootstrap.LoadOrBootstrap())));

app.MapPost("/api/onboarding/test/git-repo", async (GitRepoTestRequest? req, OnboardingBootstrap bootstrap, OnboardingTests tests, CancellationToken ct) =>
    Results.Ok(await tests.TestGitRepoPathAsync(req?.HaConfigRepo, bootstrap.LoadOrBootstrap(), ct)));

app.MapPost("/api/onboarding/test/staging-path", async (StagingPathTestRequest? req, OnboardingBootstrap bootstrap, OnboardingTests tests, SidecarRunner sidecar, CancellationToken ct) =>
    Results.Ok(await tests.TestStagingConfigPathAsync(req?.HaStagingConfig, bootstrap.LoadOrBootstrap(), sidecar, ct)));

app.MapPost("/api/onboarding/deploy", async (OnboardingBootstrap bootstrap, OnboardingStore store, KitPaths paths, DockerRunner docker, CancellationToken ct) =>
{
    var state = bootstrap.LoadOrBootstrap();
    var withMirror = state.Mirror.Enabled ? "--with-mirror" : "";
    var result = await docker.RunScriptAsync(paths.DeployScript, withMirror, ct);
    if (result.Ok)
        store.MarkStep(state, "deploy", state.Mirror.Enabled ? 7 : 8);
    return Results.Ok(new DeployResult(result.Ok, result.Ok ? "Kit deployed (single container)" : "Deploy failed", result.Message));
});

app.MapPost("/api/onboarding/storage-sync", async (OnboardingBootstrap bootstrap, OnboardingStore store, SidecarRunner sidecar, CancellationToken ct) =>
{
    var result = await sidecar.RunScriptAsync("/sidecar/sbin/sync-storage.sh", ct);
    if (result.Ok)
    {
        var state = bootstrap.LoadOrBootstrap();
        store.MarkStep(state, "storage", 6);
    }
    return Results.Ok(new DeployResult(result.Ok, result.Ok ? "Storage sync completed" : "Storage sync failed", result.Message));
});

app.MapPost("/api/onboarding/prod-git-init", async (OnboardingBootstrap bootstrap, OnboardingStore store, OperationsService ops, CancellationToken ct) =>
{
    var result = await ops.ProdGitInitAsync(ct);
    if (result.Ok)
    {
        var state = bootstrap.LoadOrBootstrap();
        store.MarkStep(state, "prod-git-init", 7);
    }
    return Results.Ok(new DeployResult(result.Ok, result.Message, result.LogTail));
});

app.MapPost("/api/onboarding/deploy-mirror", async (KitPaths paths, OnboardingBootstrap bootstrap, OnboardingStore store, DockerRunner docker, CancellationToken ct) =>
{
    var result = await docker.RunScriptAsync(paths.DeployMirrorScript, "", ct);
    if (result.Ok)
    {
        var state = bootstrap.LoadOrBootstrap();
        if (!state.CompletedSteps.Contains("mirror-deploy"))
            state.CompletedSteps.Add("mirror-deploy");
        store.Save(state);
    }
    return Results.Ok(new DeployResult(result.Ok, result.Ok ? "Mirror deployed" : "Mirror deploy failed", result.Message));
});

app.MapPost("/api/onboarding/health", async (OnboardingBootstrap bootstrap, OnboardingStore store, OnboardingTests tests, CancellationToken ct) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.LastHealthChecks = (await tests.RunHealthChecksAsync(state, ct)).ToList();
    store.Save(state);
    return Results.Ok(state.LastHealthChecks);
});

app.MapGet("/api/onboarding/health/plan", (OnboardingBootstrap bootstrap, OnboardingTests tests) =>
    Results.Ok(tests.GetHealthCheckPlan(bootstrap.LoadOrBootstrap())));

app.MapPost("/api/onboarding/health/run/{checkId}", async (
    string checkId,
    OnboardingBootstrap bootstrap,
    OnboardingTests tests,
    CancellationToken ct) =>
{
    var state = bootstrap.LoadOrBootstrap();
    return Results.Ok(await tests.RunHealthCheckAsync(state, checkId, ct));
});

app.MapPost("/api/onboarding/health/save", (HealthCheckResult[] results, OnboardingBootstrap bootstrap, OnboardingStore store) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.LastHealthChecks = results.ToList();
    store.Save(state);
    return Results.Ok(state.LastHealthChecks);
});

app.MapPost("/api/onboarding/health/continue", (OnboardingBootstrap bootstrap, OnboardingStore store) =>
{
    var state = bootstrap.LoadOrBootstrap();
    store.MarkStep(state, "health", 8);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/complete", (OnboardingBootstrap bootstrap, OnboardingStore store) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.IsComplete = true;
    store.MarkStep(state, "done", 8);
    return Results.Ok(store.ToStatus(state));
});

app.MapGet("/api/onboarding/report", (OnboardingBootstrap bootstrap, OnboardingStore store) =>
{
    var state = bootstrap.LoadOrBootstrap();
    var status = store.ToStatus(state);
    var next = new List<string>
    {
        "Edit HA YAML in the config repo (staging branch); run Apply from the console dashboard to test on staging.",
        "Person sync runs automatically while the config sync worker is up.",
    };
    if (state.Mirror.Enabled)
        next.Add("Keep staging HA pointed at the mirror broker (read-only by default).");
    else
        next.Add("Optional: enable MQTT mirror later from Settings if you need live device states.");

    var summary = state.IsComplete
        ? "Onboarding complete. Staging kit is configured."
        : "Onboarding in progress — resume at /onboarding.";

    return Results.Ok(new OnboardingReport(summary, next, status.LastHealthChecks ?? []));
});

app.MapFallbackToFile("index.html");
app.Run("http://0.0.0.0:8080");
