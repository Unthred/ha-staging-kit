using HaStagingConsole.Models;
using HaStagingConsole.Services;
using HaStagingConsole.Services.Release;
using HaStagingConsole.Hubs;

var builder = WebApplication.CreateBuilder(args);
builder.Host.ConfigureHostOptions(o => o.ShutdownTimeout = TimeSpan.FromSeconds(12));
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    o.SerializerOptions.PropertyNameCaseInsensitive = true;
});
builder.Services.AddSingleton<StartupGuard>();
builder.Services.AddSingleton<GitSshConfigurator>();
builder.Services.AddSingleton<KitPaths>();
builder.Services.AddSingleton<DockerRunner>();
builder.Services.AddSingleton<SidecarRunner>();
builder.Services.AddSingleton<StagingUiCapture>();
builder.Services.AddSingleton<OnboardingStore>();
builder.Services.AddSingleton<OnboardingBootstrap>();
builder.Services.AddSingleton<EnvWriter>();
builder.Services.AddSingleton<OnboardingTests>();
builder.Services.AddSingleton<LiveMetricsStore>();
builder.Services.AddSingleton<DashboardBuilder>();
builder.Services.AddSingleton<LovelaceParityDeferStore>();
builder.Services.AddSingleton<EntityDeployScanStore>();
builder.Services.AddSingleton<ProdRegistryReader>();
builder.Services.AddSingleton<ProdZigbee2MqttReader>();
builder.Services.AddSingleton<Zigbee2MqttConfigFixService>();
builder.Services.AddSingleton<ProdDeletedRegistryPurgeService>();
builder.Services.AddSingleton<ProdEntitySuffixFixService>();
builder.Services.AddSingleton<ProdWritesGuard>();
builder.Services.AddSingleton<LovelaceParityUndoStore>();
builder.Services.AddSingleton<LovelaceParityFixActionStore>();
builder.Services.AddSingleton<ProdStorageDeployService>();
builder.Services.AddSingleton<MigrationExportService>();
builder.Services.AddSingleton<ReleaseHistoryStore>();
builder.Services.AddSingleton<MigrationManifestLoader>();
builder.Services.AddSingleton<MigrationRunner>();
builder.Services.AddSingleton<ProdRegistrySnapshotService>();
builder.Services.AddSingleton<ReleaseAgentService>();
builder.Services.AddSingleton<LovelaceParityFixService>();
builder.Services.AddSingleton<WorkbenchResetService>();
builder.Services.AddSingleton<StagingTargetBuilder>();
builder.Services.AddSingleton<HaInstanceDiagnostics>();
builder.Services.AddSingleton<StatusService>();
builder.Services.AddSingleton<SettingsService>();
builder.Services.AddSingleton<OperationsService>();
builder.Services.AddSingleton<SystemService>();
builder.Services.AddSingleton<PathBrowserService>();
builder.Services.AddSingleton<SetupDetector>();
builder.Services.AddSingleton<MirrorEndpointResolver>();
builder.Services.AddSingleton<OperationLogService>();
builder.Services.AddSingleton<ActivityStreamService>();
builder.Services.AddSingleton<ActivitySuggestionsService>();
builder.Services.AddSignalR();
builder.Services.AddHttpClient();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", service = "ha-staging-kit" }));

app.MapGet("/api/system/containers", async (SystemService system, ILogger<Program> log, CancellationToken ct) =>
{
    var endpointCt = RequestDeadline.WithTimeout(ct, RequestDeadline.SystemContainers, out var linked);
    try
    {
        return Results.Ok(await system.GetContainersAsync(endpointCt));
    }
    catch (OperationCanceledException) when (RequestDeadline.IsTimeout(ct, endpointCt))
    {
        log.LogWarning("GET /api/system/containers timed out after {Seconds}s", RequestDeadline.SystemContainers.TotalSeconds);
        return Results.Json(
            new { message = "Container status timed out — Docker may be slow; retry shortly." },
            statusCode: 503);
    }
    finally
    {
        linked?.Dispose();
    }
});

app.MapPost("/api/system/restart-container", async (RestartContainerRequest req, SystemService system, CancellationToken ct) =>
    Results.Ok(await system.RestartContainerAsync(req.Role, ct)));

app.MapGet("/api/dashboard", async (StatusService status, ILogger<Program> log, CancellationToken ct) =>
{
    var endpointCt = RequestDeadline.WithTimeout(ct, RequestDeadline.Dashboard, out var linked);
    try
    {
        return Results.Ok(await status.GetDashboardAsync(endpointCt));
    }
    catch (OperationCanceledException) when (RequestDeadline.IsTimeout(ct, endpointCt))
    {
        log.LogWarning("GET /api/dashboard timed out after {Seconds}s", RequestDeadline.Dashboard.TotalSeconds);
        return Results.Json(
            new { message = "Dashboard timed out — the kit may still be starting. Retry in a few seconds." },
            statusCode: 503);
    }
    finally
    {
        linked?.Dispose();
    }
});

app.MapGet("/api/git/changed-files", async (DashboardBuilder dashboard, CancellationToken ct) =>
    Results.Ok(await dashboard.GetGitChangedFilesAsync(ct)));

app.MapGet("/api/git/diff", async (string? path, DashboardBuilder dashboard, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { message = "path is required" });

    var diff = await dashboard.GetGitFileDiffAsync(path, ct);
    return diff is null
        ? Results.NotFound(new { message = "File is not changed or path is invalid" })
        : Results.Ok(diff);
});

app.MapGet("/api/git/staging-diff", async (string? path, DashboardBuilder dashboard, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { message = "path is required" });

    var diff = await dashboard.GetStagingVsMainFileDiffAsync(path, ct);
    return diff is null
        ? Results.NotFound(new { message = "File not found or git not configured" })
        : Results.Ok(diff);
});

app.MapGet("/api/git/main-prod-diff", async (string? path, DashboardBuilder dashboard, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { message = "path is required" });

    var diff = await dashboard.GetMainProdPendingFileDiffAsync(path, ct);
    return diff is null
        ? Results.NotFound(new { message = "File not found, git not configured, or prod deploy not tracked yet" })
        : Results.Ok(diff);
});

app.MapPost("/api/git/commit", async (GitCommitRequest req, DashboardBuilder dashboard, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(req.Scope))
        return Results.BadRequest(new { message = "scope is required (ha or repo)" });

    return Results.Ok(await dashboard.CommitChangedFilesAsync(req.Scope, req.Message, ct));
});

app.MapGet("/api/diagnostics", async (StatusService status, OperationLogService opLog, ILogger<Program> log, CancellationToken ct) =>
{
    try
    {
        return Results.Ok(await status.GetDiagnosticsAsync(ct, opLog.GetRecent()));
    }
    catch (OperationCanceledException)
    {
        log.LogWarning("GET /api/diagnostics timed out after {Seconds}s", RequestDeadline.Diagnostics.TotalSeconds);
        return Results.Json(
            new { message = "Diagnostics timed out — partial Docker or HA slowness; retry shortly." },
            statusCode: 503);
    }
});

app.MapGet("/api/settings", (SettingsService settings) => Results.Ok(settings.Get()));
app.MapPost("/api/settings", (SettingsUpdateRequest req, SettingsService settings) =>
    Results.Ok(settings.Save(req)));
app.MapPost("/api/settings/appearance", (AppearanceSettings req, SettingsService settings) =>
    Results.Ok(settings.SaveAppearance(req)));
app.MapPost("/api/settings/release-safety", (ReleaseSafetySettingsRequest req, SettingsService settings) =>
    Results.Ok(settings.SaveReleaseSafety(req.ProdWritesEnabled)));

app.MapPost("/api/operations/apply-config", async (OperationsService ops, OperationLogService opLog, CancellationToken ct) =>
{ var r = await ops.ApplyConfigAsync(ct); opLog.Record("Apply config", r); return Results.Ok(r); });
app.MapPost("/api/operations/person-poll", async (OperationsService ops, OperationLogService opLog, CancellationToken ct) =>
{ var r = await ops.PersonPollAsync(ct); opLog.Record("Person poll", r); return Results.Ok(r); });
app.MapPost("/api/operations/storage-sync", async (OperationsService ops, OperationLogService opLog, CancellationToken ct) =>
{ var r = await ops.StorageSyncAsync(ct); opLog.Record("Storage sync", r); return Results.Ok(r); });
app.MapPost("/api/operations/reset-workbench", async (OperationsService ops, OperationLogService opLog, CancellationToken ct) =>
{ var r = await ops.ResetWorkbenchAsync(ct); opLog.Record("Reset workbench", r); return Results.Ok(r); });
app.MapPost("/api/operations/mirror-mode", async (MirrorModeRequest req, OperationsService ops, OperationLogService opLog, CancellationToken ct) =>
{ var r = await ops.SetMirrorModeAsync(req.ControlMode, ct); opLog.Record("Mirror mode", r); return Results.Ok(r); });
app.MapPost("/api/operations/deploy-mirror", async (OperationsService ops, OperationLogService opLog, CancellationToken ct) =>
{ var r = await ops.DeployMirrorAsync(ct); opLog.Record("Deploy mirror", r); return Results.Ok(r); });
app.MapPost("/api/operations/restart-staging", async (OperationsService ops, OperationLogService opLog, CancellationToken ct) =>
{ var r = await ops.RestartStagingHaAsync(ct); opLog.Record("Restart staging HA", r); return Results.Ok(r); });
app.MapPost("/api/operations/ship-to-staging", async (OperationsService ops, OperationLogService opLog, CancellationToken ct) =>
{ var r = await ops.ShipToStagingAsync(ct); opLog.Record("Ship to staging", r); return Results.Ok(r); });
app.MapPost("/api/operations/push-to-github", async (OperationsService ops, OperationLogService opLog, CancellationToken ct) =>
{ var r = await ops.PushToGitHubAsync(ct); opLog.Record("Push to GitHub", r); return Results.Ok(r); });
app.MapPost("/api/operations/snapshot-from-staging", async (OperationsService ops, OperationLogService opLog, CancellationToken ct) =>
{ var r = await ops.SnapshotFromStagingAsync(ct); opLog.Record("Snapshot from staging HA", r); return Results.Ok(r); });
app.MapPost("/api/operations/deploy-to-prod", async (OperationsService ops, OperationLogService opLog, CancellationToken ct) =>
{ var r = await ops.DeployToProdAsync(ct); opLog.Record("Deploy to prod", r); return Results.Ok(r); });
app.MapGet("/api/operations/prod-storage-preflight", async (OperationsService ops, CancellationToken ct) =>
    Results.Ok(await ops.PreflightProdStorageDeployAsync(ct)));
app.MapGet("/api/operations/prod-storage-preflight/progress", () =>
{
    var snapshot = PreflightProgressStore.Get();
    return Results.Ok(snapshot ?? new PreflightProgressSnapshot(false, 0, 0, "", DateTimeOffset.UtcNow));
});
app.MapPost("/api/operations/lovelace-parity-fix", async (
    LovelaceParityFixRequest req,
    OperationsService ops,
    OperationLogService opLog,
    CancellationToken ct) =>
{
    var r = await ops.ApplyLovelaceParityFixAsync(req, ct);
    opLog.Record($"Lovelace parity fix ({req.Action} {req.EntityId})", new OperationResult(r.Ok, r.Message, null));
    return Results.Ok(r);
});
app.MapPost("/api/operations/export-migration", async (
    ExportMigrationRequest req,
    OperationsService ops,
    OperationLogService opLog,
    CancellationToken ct) =>
{
    var r = await ops.ExportMigrationAsync(req, ct);
    opLog.Record($"Export migration ({req.Source})", new OperationResult(r.Ok, r.Message, null));
    return Results.Ok(r);
});

app.MapGet("/api/release-agent/plan", async (string? gitRef, ReleaseAgentService agent, CancellationToken ct) =>
    Results.Ok(await agent.PlanAsync(gitRef ?? "origin/main", ct)));

app.MapGet("/api/release-agent/history", async (ReleaseAgentService agent, CancellationToken ct) =>
    Results.Ok(await agent.HistoryAsync(ct)));

app.MapPost("/api/release-agent/apply", async (
    ReleaseAgentApplyRequest req,
    ReleaseAgentService agent,
    OperationLogService opLog,
    CancellationToken ct) =>
{
    var r = await agent.ApplyAsync(req, ct);
    opLog.Record($"Release apply ({req.GitRef})", r);
    return Results.Ok(r);
});

app.MapPost("/api/release-agent/rollback", async (
    ReleaseAgentRollbackRequest req,
    ReleaseAgentService agent,
    OperationLogService opLog,
    CancellationToken ct) =>
{
    var r = await agent.RollbackAsync(req, ct);
    opLog.Record("Release rollback", r);
    return Results.Ok(r);
});

app.MapPost("/api/operations/purge-prod-deleted-entities", async (
    PurgeProdDeletedEntitiesRequest req,
    OperationsService ops,
    OperationLogService opLog,
    CancellationToken ct) =>
{
    var r = await ops.PurgeProdDeletedEntitiesAsync(req.EntityId, req.SimilarProdEntityId, ct);
    opLog.Record($"Purge prod deleted entities ({req.EntityId})", r);
    return Results.Ok(r);
});
app.MapPost("/api/operations/fix-prod-entity-suffix", async (
    FixProdEntitySuffixRequest req,
    OperationsService ops,
    OperationLogService opLog,
    CancellationToken ct) =>
{
    var r = await ops.FixProdEntitySuffixAsync(req.ExpectedEntityId, req.SuffixProdEntityId, ct);
    opLog.Record($"Fix prod entity suffix ({req.ExpectedEntityId} ← {req.SuffixProdEntityId})", r);
    return Results.Ok(r);
});
app.MapPost("/api/operations/fix-prod-entity-id", async (
    FixProdEntityIdRequest req,
    OperationsService ops,
    OperationLogService opLog,
    CancellationToken ct) =>
{
    var r = await ops.FixProdEntityIdAsync(req.ExpectedEntityId, req.WrongProdEntityId, req.RelaxedUniqueId, ct);
    opLog.Record($"Fix prod entity id ({req.WrongProdEntityId} → {req.ExpectedEntityId})", r);
    return Results.Ok(r);
});
app.MapPost("/api/operations/fix-z2m-config", async (
    Z2mConfigFixRequest req,
    OperationsService ops,
    OperationLogService opLog,
    CancellationToken ct) =>
{
    var r = await ops.ApplyZ2mConfigFixAsync(req, ct);
    opLog.Record($"Fix Z2M config ({req.LiveIeee})", new OperationResult(r.Ok, r.Message, null));
    return Results.Ok(r);
});
app.MapPost("/api/operations/rollback-prod", async (OperationsService ops, OperationLogService opLog, CancellationToken ct) =>
{ var r = await ops.RollbackProdDeployAsync(ct); opLog.Record("Rollback prod deploy", r); return Results.Ok(r); });
app.MapPost("/api/git/push", async (GitPushRequest? req, DashboardBuilder dashboard, CancellationToken ct) =>
    Results.Ok(await dashboard.PushBranchAsync(req?.Branch, ct)));

app.MapGet("/api/onboarding/status", async (
    OnboardingBootstrap bootstrap,
    OnboardingStore store,
    SetupDetector detector,
    EnvWriter envWriter,
    SidecarRunner sidecar,
    ILogger<Program> log,
    CancellationToken ct) =>
{
    var endpointCt = RequestDeadline.WithTimeout(ct, RequestDeadline.OnboardingStatus, out var linked);
    try
    {
        var state = bootstrap.LoadOrBootstrap();
        var (detected, changed) = await detector.DetectAndMergeAsync(state, endpointCt);
        if (changed)
        {
            detector.PersistMergedEnv(state, detected, envWriter);
            store.Save(state);
        }

        var mirrorRunning = await sidecar.IsMirrorRunningAsync(endpointCt);
        return Results.Ok(store.ToStatus(state, mirrorRunning, detected));
    }
    catch (OperationCanceledException) when (RequestDeadline.IsTimeout(ct, endpointCt))
    {
        log.LogWarning("GET /api/onboarding/status timed out after {Seconds}s", RequestDeadline.OnboardingStatus.TotalSeconds);
        return Results.Json(
            new { message = "Onboarding status timed out — cached detection will be used on retry." },
            statusCode: 503);
    }
    finally
    {
        linked?.Dispose();
    }
});

app.MapPost("/api/onboarding/rescan", async (
    OnboardingBootstrap bootstrap,
    OnboardingStore store,
    SetupDetector detector,
    EnvWriter envWriter,
    SidecarRunner sidecar,
    ILogger<Program> log,
    CancellationToken ct) =>
{
    var endpointCt = RequestDeadline.WithTimeout(ct, TimeSpan.FromSeconds(45), out var linked);
    try
    {
        detector.InvalidateCache();
        var state = bootstrap.LoadOrBootstrap();
        var (detected, changed) = await detector.DetectAndMergeAsync(state, endpointCt, forceRefresh: true);
        if (changed)
        {
            detector.PersistMergedEnv(state, detected, envWriter);
            store.Save(state);
        }

        var mirrorRunning = await sidecar.IsMirrorRunningAsync(endpointCt);
        log.LogInformation("Onboarding rescan completed (stateChanged={Changed})", changed);
        return Results.Ok(store.ToStatus(state, mirrorRunning, detected));
    }
    catch (OperationCanceledException) when (RequestDeadline.IsTimeout(ct, endpointCt))
    {
        log.LogWarning("POST /api/onboarding/rescan timed out");
        return Results.Json(new { message = "Setup rescan timed out — Docker or network may be slow." }, statusCode: 503);
    }
    finally
    {
        linked?.Dispose();
    }
});

app.MapPost("/api/onboarding/topology", (TopologyRequest req, OnboardingBootstrap bootstrap, OnboardingStore store, EnvWriter env, MirrorEndpointResolver mirrorEndpoints, SetupDetector detector) =>
{
    var state = bootstrap.LoadOrBootstrap();
    state.Topology = new TopologySettings(req.ProdHaType, req.StagingHaType, req.SameHostAsKit);
    mirrorEndpoints.ApplyIfEnabled(state);
    env.WriteSidecarConfig(state);
    env.WriteKitEnv(state);
    detector.InvalidateCache();
    store.MarkStep(state, "topology", 2);
    return Results.Ok(store.ToStatus(state));
});

app.MapPost("/api/onboarding/paths", (PathsRequest req, OnboardingBootstrap bootstrap, OnboardingStore store, EnvWriter env, MirrorEndpointResolver mirrorEndpoints, SetupDetector detector) =>
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
    detector.InvalidateCache();
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

app.MapPost("/api/onboarding/staging", (StagingSecretsRequest req, OnboardingBootstrap bootstrap, OnboardingStore store, EnvWriter env, KitPaths paths, MirrorEndpointResolver mirrorEndpoints, SetupDetector detector) =>
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
    detector.InvalidateCache();
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

app.MapPost("/api/onboarding/deploy", async (OnboardingBootstrap bootstrap, OnboardingStore store, KitPaths paths, DockerRunner docker, SetupDetector detector, CancellationToken ct) =>
{
    var state = bootstrap.LoadOrBootstrap();
    var withMirror = state.Mirror.Enabled ? "--with-mirror" : "";
    var result = await docker.RunScriptAsync(paths.DeployScript, withMirror, ct);
    if (result.Ok)
    {
        store.MarkStep(state, "deploy", state.Mirror.Enabled ? 7 : 8);
        detector.InvalidateCache();
    }
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

app.MapHub<ActivityHub>("/hubs/activity");
app.MapGet("/api/activity/snapshot", (ActivityStreamService activity) => Results.Ok(activity.GetSnapshot()));
app.MapGet("/api/activity/suggestions", async (ActivitySuggestionsService suggestions, CancellationToken ct) =>
    Results.Ok(await suggestions.GetSuggestionsAsync(ct)));
app.MapFallbackToFile("index.html");
app.Run("http://0.0.0.0:8080");
