using System.Diagnostics;
using System.Net.Http.Headers;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class OperationsService(
    KitPaths paths,
    SidecarRunner sidecar,
    DockerRunner docker,
    DashboardBuilder dashboard,
    ProdStorageDeployService storageDeploy,
    LovelaceParityFixService parityFix,
    Zigbee2MqttConfigFixService z2mConfigFix,
    WorkbenchResetService workbenchReset,
    ProdDeletedRegistryPurgeService deletedRegistryPurge,
    ProdEntitySuffixFixService entitySuffixFix,
    MigrationExportService migrationExport,
    ProdWritesGuard prodWrites,
    GitSshConfigurator gitSsh,
    IHttpClientFactory httpClientFactory)
{
    public Task<OperationResult> ApplyConfigAsync(CancellationToken ct)
    {
        if (!Directory.Exists("/repo/.git"))
            return Task.FromResult(new OperationResult(
                false,
                "Git repo not configured — set the HA config repo path in Settings and complete the setup wizard paths step",
                null));

        return RunSidecarScript("/sidecar/sbin/apply-config.sh", "Apply config", ct);
    }

    public Task<OperationResult> PushToGitHubAsync(CancellationToken ct)
    {
        var branch = EnvFile.Get(paths.EnvFile, "HA_BRANCH") ?? "staging";
        return dashboard.PushBranchAsync(branch, ct);
    }

    public Task<OperationResult> SnapshotFromStagingAsync(CancellationToken ct) =>
        RunSidecarScript("/sidecar/sbin/snapshot-from-staging.sh", "Snapshot from staging HA", ct);

    public Task<OperationResult> PersonPollAsync(CancellationToken ct) =>
        RunSidecarScript("/sidecar/sbin/person-poller.sh --once", "Person poll", ct);

    public async Task<OperationResult> StorageSyncAsync(CancellationToken ct)
    {
        var result = await RunSidecarScript("/sidecar/sbin/sync-storage.sh", "Storage sync", ct);
        if (!result.Ok)
            return result;

        var stagingUrl = EnvFile.Get(paths.EnvFile, "STAGING_HA_URL");
        var probe = await dashboard.ProbeHaReachabilityAsync(stagingUrl, paths.StagingTokenFile, ct);
        if (probe.Available && !probe.Reachable)
        {
            return result with
            {
                Message =
                    "Storage sync completed — staging API token rejected; regenerate in Settings → Staging (auth is no longer overwritten by sync)",
            };
        }

        return result;
    }

    public Task<OperationResult> ResetWorkbenchAsync(CancellationToken ct) =>
        workbenchReset.ResetAsync(ct);

    public async Task<OperationResult> ShipToStagingAsync(CancellationToken ct)
    {
        var logs = new List<string>();
        var branch = EnvFile.Get(paths.EnvFile, "HA_BRANCH") ?? "staging";

        var push = await dashboard.PushBranchAsync(branch, ct);
        logs.Add(push.Message);
        if (!push.Ok)
            return Fail(logs, push.LogTail);

        if (!string.IsNullOrWhiteSpace(push.LogTail))
            logs.Add(push.LogTail!);

        var apply = await ApplyConfigAsync(ct);
        logs.Add(apply.Message);
        if (!apply.Ok)
            return Fail(logs, apply.LogTail);

        if (!string.IsNullOrWhiteSpace(apply.LogTail))
            logs.Add(apply.LogTail!);

        var restart = await RestartStagingHaAsync(ct);
        logs.Add(restart.Message);
        if (!restart.Ok)
            return Fail(logs, restart.LogTail);

        return new OperationResult(
            true,
            "Shipped to staging — pushed git, applied config, restarted staging HA",
            JoinLogs(logs, restart.LogTail));
    }

    // Files in the config repo that HA actually reads — must match DashboardBuilder.IsHaDeployPath.
    static readonly string[] HaConfigPaths =
    [
        "automations.yaml", "scripts.yaml", "configuration.yaml",
        "scenes.yaml", "groups.yaml", "notify.yaml",
        "packages/", "python_scripts/", "custom_components/",
        "blueprints/", "www/", "themes/", "lovelace/", "zigbee2mqtt/",
        ".storage/lovelace.lovelace", ".storage/lovelace.map",
        ".storage/lovelace_dashboards", ".storage/lovelace_resources",
        ".storage/input_boolean", ".storage/input_number", ".storage/input_select",
        ".storage/input_text", ".storage/input_datetime",
        ".storage/timer", ".storage/counter", ".storage/schedule",
        ".storage/todo", ".storage/scheduler.storage",
    ];

    // HA paths deployed to prod — excludes .storage (prod dashboard stays live-managed).
    static readonly string[] ProdHaConfigPaths =
        HaConfigPaths.Where(p => !p.StartsWith(".storage/", StringComparison.OrdinalIgnoreCase)).ToArray();

    static readonly string[] ProdStorageConfigPaths =
        HaConfigPaths.Where(p => p.StartsWith(".storage/", StringComparison.OrdinalIgnoreCase)).ToArray();

    // Prod sparse-checkout: YAML + packages only — never overwrite live .storage (matches ha-prod-deploy.sh).
    const string SparseExcludeContent =
        "/*\n!/.storage/\n!/docs/\n!/scripts/\n!/.cursor/\n!/.github/\n" +
        "!/AGENTS.md\n!/WORKFLOW.md\n!/CLAUDE.md\n!/CHANGELOG.md\n" +
        "!/.cursorrules\n!/README.md\n";

    static readonly string[] ProdStorageRestoreFiles =
    [
        ".storage/lovelace.lovelace", ".storage/lovelace.map",
        ".storage/lovelace_dashboards", ".storage/lovelace_resources",
        // UI helpers — prod-only live state; must be restored on rollback after a bad .storage deploy
        ".storage/timer", ".storage/input_boolean", ".storage/input_number",
        ".storage/input_select", ".storage/input_text", ".storage/input_datetime",
        ".storage/scheduler.storage",
    ];

    public Task<OperationResult> RollbackProdDeployAsync(CancellationToken ct)
    {
        if (prodWrites.BlockIfLocked("Rollback prod deploy") is { } blocked)
            return Task.FromResult(blocked);
        return RollbackProdDeployInternalAsync(ct);
    }

    async Task<OperationResult> RollbackProdDeployInternalAsync(CancellationToken ct)
    {
        var previous = ReadPreviousDeployedSha();
        if (string.IsNullOrWhiteSpace(previous))
        {
            return new OperationResult(
                false,
                "No previous prod deploy recorded — cannot rollback automatically",
                null);
        }

        var logs = new List<string> { $"Rolling back prod HA to {previous[..Math.Min(7, previous.Length)]}" };

        var deploy = await SshGitDeployRefAsync(previous, ct);
        logs.Add(deploy.Message);
        if (!deploy.Ok)
            return Fail(logs, deploy.LogTail);

        var restore = await RestoreProdStorageFilesFromRefAsync(previous, ct);
        logs.Add(restore.Message);
        if (!restore.Ok)
            return Fail(logs, restore.LogTail);

        var restart = await RestartProdHaAsync(ct);
        logs.Add(restart.Message);
        if (!restart.Ok)
            return Fail(logs, restart.LogTail);

        var current = ReadLastDeployedSha();
        File.WriteAllText(paths.LastProdDeployShaFile, previous);
        if (!string.IsNullOrWhiteSpace(current))
            File.WriteAllText(paths.LastProdDeployPreviousShaFile, current);

        return new OperationResult(
            true,
            $"Rolled back prod HA to {previous[..7]} — YAML + dashboard/helpers .storage restored from that commit",
            JoinLogs(logs, restart.LogTail));
    }

    public Task<OperationResult> DeployToProdAsync(CancellationToken ct)
    {
        if (prodWrites.BlockIfLocked("Deploy to prod") is { } blocked)
            return Task.FromResult(blocked);
        return DeployToProdInternalAsync(ct);
    }

    public Task<LovelaceParityFixResult> ApplyLovelaceParityFixAsync(
        LovelaceParityFixRequest request,
        CancellationToken ct) =>
        parityFix.ApplyFixAsync(request, ct);

    public Task<ExportMigrationResult> ExportMigrationAsync(ExportMigrationRequest request, CancellationToken ct) =>
        migrationExport.ExportAsync(request, ct);

    public Task<OperationResult> PurgeProdDeletedEntitiesAsync(
        string entityId,
        string? similarProdEntityId,
        CancellationToken ct)
    {
        if (prodWrites.BlockIfLocked("Purge prod registry tombstones") is { } blocked)
            return Task.FromResult(blocked);
        return deletedRegistryPurge.PurgeDeletedEntitiesAsync(entityId, similarProdEntityId, ct);
    }

    public Task<OperationResult> FixProdEntitySuffixAsync(
        string expectedEntityId,
        string suffixProdEntityId,
        CancellationToken ct)
    {
        if (prodWrites.BlockIfLocked("Fix prod entity suffix") is { } blocked)
            return Task.FromResult(blocked);
        return entitySuffixFix.FixSuffixCollisionAsync(expectedEntityId, suffixProdEntityId, ct);
    }

    public Task<OperationResult> FixProdEntityIdAsync(
        string expectedEntityId,
        string wrongProdEntityId,
        bool relaxedUniqueId,
        CancellationToken ct)
    {
        if (prodWrites.BlockIfLocked("Fix prod entity id") is { } blocked)
            return Task.FromResult(blocked);
        return entitySuffixFix.FixWrongEntityIdAsync(expectedEntityId, wrongProdEntityId, ct, relaxedUniqueId);
    }

    public Task<LovelaceParityFixResult> ApplyZ2mConfigFixAsync(
        Z2mConfigFixRequest request,
        CancellationToken ct) =>
        z2mConfigFix.ApplyGitFixAsync(request, ct);

    static readonly object PreflightSync = new();
    static Task<ProdStoragePreflightResult>? PreflightInFlight;

    public async Task<ProdStoragePreflightResult> PreflightProdStorageDeployAsync(CancellationToken ct)
    {
        Task<ProdStoragePreflightResult> task;
        lock (PreflightSync)
        {
            PreflightInFlight ??= RunPreflightProdStorageDeployCoreAsync(ct);
            task = PreflightInFlight;
        }

        try
        {
            return await task;
        }
        finally
        {
            lock (PreflightSync)
            {
                if (ReferenceEquals(PreflightInFlight, task))
                    PreflightInFlight = null;
            }
        }
    }

    async Task<ProdStoragePreflightResult> RunPreflightProdStorageDeployCoreAsync(CancellationToken ct)
    {
        using var scan = PreflightProgressStore.BeginScan(3);
        const string deployRef = "origin/main";
        PreflightProgressStore.Advance("Fetching latest from GitHub");
        var (fetchOk, _, fetchErr) = await RunGitBashAsync("git -C /repo fetch origin main 2>/dev/null", ct);
        if (!fetchOk)
        {
            PreflightProgressStore.Complete("Scan failed");
            return WithUndoStatus(ProdStorageDeployService.EmptyPreflight(
                0,
                [$"git fetch failed: {fetchErr}"]));
        }

        PreflightProgressStore.Advance("Checking pending dashboard changes");
        var baseline = ReadLastDeployedSha();
        var changed = await storageDeploy.GetChangedStoragePathsAsync(
            string.IsNullOrWhiteSpace(baseline) ? null : baseline,
            deployRef,
            ct);
        var lovelacePending = changed.Any(ProdStorageDeployService.IsLovelacePath);
        var z2mPending = await Zigbee2MqttChangedSinceAsync(
            string.IsNullOrWhiteSpace(baseline) ? null : baseline,
            deployRef,
            ct);

        ProdStoragePreflightResult result;
        if (!lovelacePending && !z2mPending)
        {
            PreflightProgressStore.SetTotalSteps(4);
            var z2mOnly = await storageDeploy.PreflightZ2mConfigAsync(deployRef, ct);
            result = z2mOnly.Z2mConfigIssues.Any(i => i.BlocksDeploy)
                ? WithUndoStatus(z2mOnly)
                : WithUndoStatus(ProdStorageDeployService.EmptyPreflight(
                    0,
                    ["No Lovelace bundle or zigbee2mqtt changes pending on GitHub main"]));
            PreflightProgressStore.Complete();
            return result;
        }

        if (lovelacePending)
        {
            PreflightProgressStore.SetTotalSteps(19);
            result = WithUndoStatus(await storageDeploy.PreflightLovelaceBundleForPanelAsync(deployRef, ct));
        }
        else
        {
            PreflightProgressStore.SetTotalSteps(5);
            result = WithUndoStatus(await storageDeploy.PreflightZ2mConfigAsync(deployRef, ct));
        }

        PreflightProgressStore.Advance("Checking prod entity naming");
        var namingIssues = await storageDeploy.ScanProdNamingIssuesAsync(ct);
        result = ProdStorageDeployService.AttachProdNamingIssues(result, namingIssues);

        result = WithUndoStatus(result);
        result = result with
        {
            Issues = result.Issues.Concat([
                $"Scan summary: local blockers={result.MissingEntityIssues.Count}, awaiting publish={result.DeployMissingEntityIssues.Count}, published total={result.DeployIssueCount}, pendingCommit={result.PendingCommit}",
            ]).ToList(),
        };
        PreflightProgressStore.Complete();
        return result;
    }

    ProdStoragePreflightResult WithUndoStatus(ProdStoragePreflightResult result)
    {
        var (canUndo, description) = parityFix.GetUndoStatus();
        return result with
        {
            CanUndoLovelaceFix = canUndo,
            LovelaceUndoDescription = description,
        };
    }

    async Task<OperationResult> DeployToProdInternalAsync(CancellationToken ct)
    {
        var logs = new List<string>();
        var stagingBranch = EnvFile.Get(paths.EnvFile, "HA_BRANCH") ?? "staging";

        var (fetchOk, _, fetchErr) = await RunGitBashAsync("git -C /repo fetch origin", ct);
        if (!fetchOk)
            return new OperationResult(false, "git fetch failed before prod deploy", fetchErr);

        var stagingAhead = await GitRevCountAsync($"origin/main..origin/{stagingBranch}", ct);
        var commitsAhead = await GitRevCountAsync($"origin/{stagingBranch}..HEAD", ct);
        var isDirty = await IsWorkingTreeDirtyAsync(ct);

        if (commitsAhead > 0)
        {
            return new OperationResult(
                false,
                $"{commitsAhead} local commit(s) not on GitHub — push before deploying to prod",
                null);
        }

        string? prevMainHead = null;
        if (stagingAhead > 0)
        {
            if (isDirty)
            {
                return new OperationResult(
                    false,
                    "Uncommitted local changes — commit before merging GitHub staging to main for prod deploy",
                    null);
            }

            var (headOk, prevHead, _) = await RunGitBashAsync("git -C /repo rev-parse main 2>/dev/null", ct);
            prevMainHead = headOk ? prevHead.Trim() : "";

            var promote = await dashboard.PromoteStagingToMainAsync(ct);
            logs.Add(promote.Message);
            if (!promote.Ok)
                return promote;

            var (refetchOk, _, refetchErr) = await RunGitBashAsync("git -C /repo fetch origin main", ct);
            if (!refetchOk)
                return Fail(logs, refetchErr);
        }
        else
        {
            logs.Add("GitHub staging is already on main — deploying origin/main to prod HA (local uncommitted files ignored)");
        }

        var lastDeployed = ReadLastDeployedSha();
        var haBaseline = stagingAhead > 0 && !string.IsNullOrWhiteSpace(prevMainHead)
            ? prevMainHead!
            : lastDeployed;

        const string deployRef = "origin/main";
        var haChanged = await HaConfigChangedSinceAsync(haBaseline, deployRef, ct);
        var changedStoragePaths = await storageDeploy.GetChangedStoragePathsAsync(
            string.IsNullOrWhiteSpace(haBaseline) ? null : haBaseline,
            deployRef,
            ct);
        var storageDeployPaths = storageDeploy.ResolveDeployPaths(changedStoragePaths);
        var lovelaceChanged = changedStoragePaths.Any(ProdStorageDeployService.IsLovelacePath);

        if (!haChanged && storageDeployPaths.Count == 0)
        {
            return new OperationResult(
                true,
                stagingAhead > 0
                    ? "Merged to main — docs/scripts only, no HA or dashboard changes for prod"
                    : "GitHub main has no new HA or dashboard changes since last prod deploy — prod HA not updated",
                JoinLogs(logs, null));
        }

        if (haChanged || storageDeployPaths.Count > 0)
        {
            logs.Add(
                "Deploy applies GitHub main YAML plus Lovelace/helper .storage from git only — prod entity ids are not renamed by the kit.");
        }

        var z2mChanged = await Zigbee2MqttChangedSinceAsync(haBaseline, deployRef, ct);
        if (lovelaceChanged || z2mChanged)
        {
            var gate = lovelaceChanged
                ? await storageDeploy.PreflightLovelaceBundleAsync(deployRef, ct)
                : await storageDeploy.PreflightZ2mConfigAsync(deployRef, ct);
            if (!gate.Ok)
            {
                var detail = BuildLovelaceGateFailure(gate);
                logs.Add(detail);
                return new OperationResult(
                    false,
                    lovelaceChanged
                        ? "Deploy blocked — entity deploy scan failed"
                        : "Deploy blocked — Zigbee2MQTT config issues on prod",
                    JoinLogs(logs, detail));
            }

            if (lovelaceChanged)
            {
                logs.Add($"Entity deploy scan passed ({gate.EntityRefCount} entity reference(s) verified on prod)");
                if (gate.DeferredEntityIssues.Count > 0)
                {
                    logs.Add(
                        $"Deploying with {gate.DeferredEntityIssues.Count} deferred entity reference(s) — those cards may error on prod until fixed manually");
                }
            }

            if (z2mChanged)
            {
                logs.Add("Zigbee2MQTT config preflight passed — restart Zigbee2MQTT on prod after deploy");
            }
        }

        if (haChanged)
        {
            var syncMain = await RunGitBashAsync("git -C /repo branch -f main origin/main", ct);
            if (!syncMain.Ok)
                return Fail(logs, syncMain.Stderr);

            var pull = await SshGitDeployRefAsync("main", ct);
            logs.Add(pull.Message);
            if (!pull.Ok)
                return Fail(logs, pull.LogTail);
            if (!string.IsNullOrWhiteSpace(pull.LogTail))
                logs.Add(pull.LogTail!);
        }

        if (storageDeployPaths.Count > 0)
        {
            var storageResult = await storageDeploy.DeployStorageFilesFromRefAsync(deployRef, storageDeployPaths, ct);
            logs.Add(storageResult.Message);
            if (!storageResult.Ok)
                return Fail(logs, storageResult.LogTail);

            var restart = await RestartProdHaAsync(ct);
            logs.Add(restart.Message);
            if (!restart.Ok)
                return Fail(logs, restart.LogTail);

            await WriteLastDeployedShaAsync(ct);
            var summary = haChanged
                ? "Deployed to prod — YAML from GitHub main plus dashboard/helper .storage bundle"
                : "Deployed to prod — dashboard/helper .storage bundle from GitHub main";
            return new OperationResult(true, summary, JoinLogs(logs, restart.LogTail));
        }

        var reload = await ReloadProdHaAsync(ct);
        logs.Add(reload.Message);
        if (!reload.Ok)
            return Fail(logs, reload.LogTail);

        await WriteLastDeployedShaAsync(ct);

        return new OperationResult(
            true,
            "Deployed to prod — applied GitHub main YAML on prod HA and reloaded",
            JoinLogs(logs, reload.LogTail));
    }

    static string BuildLovelaceGateFailure(ProdStoragePreflightResult gate)
    {
        var parts = new List<string>();
        if (gate.MissingEntityIssues.Count > 0)
        {
            parts.Add(
                $"{gate.MissingEntityIssues.Count} Lovelace entity reference(s) missing on prod — open Overview parity panel for locations and suggested fixes");
        }
        else if (gate.MissingEntities.Count > 0)
        {
            parts.Add(
                $"{gate.MissingEntities.Count} Lovelace entity reference(s) missing on prod: " +
                string.Join(", ", gate.MissingEntities));
        }

        if (gate.MissingCustomCards.Count > 0)
        {
            parts.Add(
                $"{gate.MissingCustomCards.Count} Lovelace resource URL(s) missing on prod: " +
                string.Join(", ", gate.MissingCustomCards));
        }

        if (gate.Z2mConfigIssues.Count > 0)
        {
            parts.Add(
                $"{gate.Z2mConfigIssues.Count(i => i.BlocksDeploy)} Zigbee2MQTT config issue(s) on prod — fix in git, deploy, then restart Z2M");
        }

        parts.AddRange(gate.Issues);
        return string.Join("\n", parts);
    }

    async Task<bool> Zigbee2MqttChangedSinceAsync(string? baseline, string toRef, CancellationToken ct)
    {
        string stdout;
        if (string.IsNullOrWhiteSpace(baseline))
        {
            var (ok, ls, _) = await RunGitBashAsync(
                $"git -C /repo ls-tree -r --name-only {toRef} -- zigbee2mqtt/", ct);
            if (!ok)
                return false;
            stdout = ls;
        }
        else
        {
            var (diffOk, diffOut, _) = await RunGitBashAsync(
                $"git -C /repo diff --name-only {ShQ(baseline)} {toRef} -- zigbee2mqtt/", ct);
            if (!diffOk)
                return false;
            stdout = diffOut;
        }

        return !string.IsNullOrWhiteSpace(stdout);
    }

    // Returns true if any HA config file changed between baseline and toRef (commit or ref).
    async Task<bool> HaConfigChangedSinceAsync(string? baseline, string toRef, CancellationToken ct)
    {
        var pathArgs = string.Join(" ", ProdHaConfigPaths.Select(ShQ));
        if (string.IsNullOrWhiteSpace(baseline))
        {
            var (ok, stdout, _) = await RunGitBashAsync(
                $"git -C /repo ls-tree -r --name-only {toRef} -- {pathArgs}", ct);
            return ok && !string.IsNullOrWhiteSpace(stdout);
        }

        var (diffOk, diffOut, _) = await RunGitBashAsync(
            $"git -C /repo diff --name-only {ShQ(baseline)} {toRef} -- {pathArgs}", ct);
        return !diffOk || !string.IsNullOrWhiteSpace(diffOut);
    }

    async Task<int> GitRevCountAsync(string range, CancellationToken ct)
    {
        var (ok, stdout, _) = await RunGitBashAsync($"git -C /repo rev-list --count {range} 2>/dev/null", ct);
        if (!ok || !int.TryParse(stdout.Trim(), out var count))
            return 0;
        return count;
    }

    async Task<bool> IsWorkingTreeDirtyAsync(CancellationToken ct)
    {
        var (ok, stdout, _) = await RunGitBashAsync("git -C /repo status --porcelain", ct);
        return ok && !string.IsNullOrWhiteSpace(stdout);
    }

    string ReadLastDeployedSha()
    {
        try { return File.ReadAllText(paths.LastProdDeployShaFile).Trim(); }
        catch { return ""; }
    }

    string ReadPreviousDeployedSha()
    {
        try { return File.ReadAllText(paths.LastProdDeployPreviousShaFile).Trim(); }
        catch { return ""; }
    }

    // Deploy: bundle a git ref and pipe it to prod via SSH — prod .storage is excluded (sparse checkout).
    async Task<OperationResult> SshGitDeployRefAsync(string gitRef, CancellationToken ct)
    {
        var target = ParseProdTarget();
        if (target is null)
            return new OperationResult(false, "Prod SSH not configured — set SSH target in Settings", null);
        if (!File.Exists(paths.SshKeyFile))
            return new OperationResult(false, "SSH key not found — add id_ed25519 to the kit secrets directory", null);

        var (userHost, configPath) = target.Value;
        var sshBase = SshBase();
        var g = $"sudo git -C {ShQ(configPath)}";

        var sparse = await RunBashAsync($"ssh {sshBase} {ShQ(userHost)} {ShQ(SparseCheckoutCmd(configPath))}", ct);
        if (!sparse.Ok)
            return new OperationResult(false, "Failed to update prod sparse checkout", sparse.Stderr);

        var remoteCmd = ShQ(
            $"cat > /tmp/ha-kit-deploy.bundle && " +
            $"{g} fetch /tmp/ha-kit-deploy.bundle {gitRef}:refs/heads/kit-deploy-tmp && " +
            $"{g} reset --hard kit-deploy-tmp && " +
            $"rm -f /tmp/ha-kit-deploy.bundle");

        var script = $"git -C /repo bundle create - {ShellQuote(gitRef)} | nice -n 15 ssh {sshBase} {ShQ(userHost)} {remoteCmd}";
        var (ok, stdout, stderr) = await RunBashAsync(script, ct);

        if (ok)
            return new OperationResult(true, $"Config bundled and applied on prod HA ({userHost})", stdout);

        var hint = stderr.Contains("not a git repository", StringComparison.OrdinalIgnoreCase)
            ? " — prod HA config dir is not a git repo; run the prod HA git init step in the setup wizard"
            : "";
        return new OperationResult(false, $"Prod HA deploy failed{hint}", string.IsNullOrWhiteSpace(stderr) ? stdout : stderr);
    }

    async Task<OperationResult> RestoreProdStorageFilesFromRefAsync(string gitRef, CancellationToken ct)
    {
        var target = ParseProdTarget();
        if (target is null)
            return new OperationResult(false, "Prod SSH not configured", null);

        var (userHost, configPath) = target.Value;
        var sshBase = SshBase();
        var restored = 0;

        foreach (var relativePath in ProdStorageRestoreFiles)
        {
            var (existsOk, _, _) = await RunGitBashAsync(
                $"git -C /repo cat-file -e {gitRef}:{relativePath} 2>/dev/null", ct);
            if (!existsOk)
                continue;

            var dest = $"{configPath}/{relativePath}";
            var remoteTee = ShQ($"sudo tee {dest} > /dev/null");
            var script =
                $"git -C /repo show {gitRef}:{ShellQuote(relativePath)} | " +
                $"nice -n 15 ssh {sshBase} {ShQ(userHost)} {remoteTee}";
            var (ok, _, stderr) = await RunBashAsync(script, ct);
            if (!ok)
                return new OperationResult(false, $"Failed to restore {relativePath} on prod", stderr);
            restored++;
        }

        return new OperationResult(
            true,
            restored > 0
                ? $"Restored {restored} .storage file(s) on prod from {gitRef[..Math.Min(7, gitRef.Length)]}"
                : "No .storage files to restore for this commit",
            null);
    }

    // Onboarding: initialise prod HA config dir as a git repo — non-destructive, zero file changes.
    // Also sets up sparse checkout so deploys never write docs/scripts/editor-rules to prod HA.
    public async Task<OperationResult> ProdGitInitAsync(CancellationToken ct)
    {
        var target = ParseProdTarget();
        if (target is null)
            return new OperationResult(false, "Prod SSH not configured — set SSH target in Settings", null);
        if (!File.Exists(paths.SshKeyFile))
            return new OperationResult(false, "SSH key not found — add id_ed25519 to the kit secrets directory", null);

        var (userHost, configPath) = target.Value;
        var sshBase = SshBase();

        // Get the remote URL the kit itself uses so prod HA remote matches
        var (remoteOk, remoteOut, _) = await RunBashAsync("git -C /repo remote get-url origin", ct);
        var remoteUrl = remoteOk ? remoteOut.Trim() : "";

        // Check if already a git repo (sudo needed: /homeassistant is root-owned on HA OS)
        var g = $"sudo git -C {ShQ(configPath)}";
        var checkCmd = $"{g} rev-parse --git-dir >/dev/null 2>&1 && echo yes || echo no";
        var (checkOk, checkOut, _) = await RunBashAsync(
            $"ssh {sshBase} {ShQ(userHost)} {ShQ(checkCmd)}", ct);

        if (checkOk && checkOut.Trim() == "yes")
        {
            // Idempotent: (re)apply remote + sparse checkout without touching any files
            if (!string.IsNullOrWhiteSpace(remoteUrl))
            {
                var setRemoteCmd = $"{g} remote set-url origin {ShQ(remoteUrl)} 2>/dev/null || {g} remote add origin {ShQ(remoteUrl)}";
                await RunBashAsync($"ssh {sshBase} {ShQ(userHost)} {ShQ(setRemoteCmd)}", ct);
            }
            await RunBashAsync($"ssh {sshBase} {ShQ(userHost)} {ShQ(SparseCheckoutCmd(configPath))}", ct);
            var existingNote = string.IsNullOrWhiteSpace(remoteUrl) ? "" : $" (remote: {remoteUrl})";
            return new OperationResult(true, $"Prod HA git repo already initialised — sparse checkout updated{existingNote}", null);
        }

        // Not initialised — set up git structure without touching any files
        var initSteps = new List<string>
        {
            $"{g} init",
            $"{g} symbolic-ref HEAD refs/heads/main",
        };
        if (!string.IsNullOrWhiteSpace(remoteUrl))
            initSteps.Add($"{g} remote add origin {ShQ(remoteUrl)}");
        initSteps.Add(SparseCheckoutCmd(configPath));
        initSteps.Add("echo initialized");

        var initCmd = string.Join(" && ", initSteps);
        var (initOk, initOut, initErr) = await RunBashAsync(
            $"ssh {sshBase} {ShQ(userHost)} {ShQ(initCmd)}", ct);

        if (!initOk)
            return new OperationResult(false, $"git init on prod HA failed: {initErr}", initErr);

        var remoteNote = string.IsNullOrWhiteSpace(remoteUrl) ? " (remote not set — configure manually)" : $" with remote {remoteUrl}";
        return new OperationResult(
            true,
            $"Prod HA config dir initialised{remoteNote} with sparse checkout. No files changed — next deploy will apply config.",
            initOut);
    }

    // Configures git sparse checkout on the remote config dir (idempotent).
    // docs/, scripts/, editor config and meta files are excluded; all HA YAML passes through.
    string SparseCheckoutCmd(string configPath)
    {
        var g = $"sudo git -C {ShQ(configPath)}";
        var sparseFile = $"{configPath}/.git/info/sparse-checkout";
        // Replace actual newlines with \n so printf on the remote shell can emit them
        var sparseContent = SparseExcludeContent.Replace("\n", "\\n");
        return $"{g} config core.sparseCheckout true && " +
               $"printf {ShQ(sparseContent)} | sudo tee {ShQ(sparseFile)} > /dev/null";
    }

    async Task<OperationResult> ReloadProdHaAsync(CancellationToken ct)
    {
        var (prodUrl, prodToken) = TokenFile.Read(paths.ProdTokenFile);
        if (string.IsNullOrWhiteSpace(prodUrl) || string.IsNullOrWhiteSpace(prodToken))
            return new OperationResult(false, "Prod HA token not configured — add prod.token to kit secrets", null);

        try
        {
            using var http = httpClientFactory.CreateClient();
            using var req = new HttpRequestMessage(
                HttpMethod.Post,
                $"{prodUrl.TrimEnd('/')}/api/services/homeassistant/reload_all");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", prodToken);
            req.Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
            using var resp = await http.SendAsync(req, ct);
            if (resp.IsSuccessStatusCode)
                return new OperationResult(true, "Prod HA config reloaded", null);
            return new OperationResult(false, $"HA reload returned HTTP {(int)resp.StatusCode}", null);
        }
        catch (Exception ex)
        {
            return new OperationResult(false, $"HA reload request failed: {ex.Message}", null);
        }
    }

    async Task<OperationResult> RestartProdHaAsync(CancellationToken ct)
    {
        var (prodUrl, prodToken) = TokenFile.Read(paths.ProdTokenFile);
        if (string.IsNullOrWhiteSpace(prodUrl) || string.IsNullOrWhiteSpace(prodToken))
            return new OperationResult(false, "Prod HA token not configured — add prod.token to kit secrets", null);

        try
        {
            using var http = httpClientFactory.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(120);
            using var req = new HttpRequestMessage(
                HttpMethod.Post,
                $"{prodUrl.TrimEnd('/')}/api/services/homeassistant/restart");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", prodToken);
            req.Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
            using var resp = await http.SendAsync(req, ct);
            if (resp.IsSuccessStatusCode || (int)resp.StatusCode == 504)
                return new OperationResult(true, "Prod HA restarted to load Lovelace changes", null);
            return new OperationResult(false, $"HA restart returned HTTP {(int)resp.StatusCode}", null);
        }
        catch (Exception ex) when (ex is TaskCanceledException or HttpRequestException)
        {
            // HA often drops the connection mid-restart — treat timeout as success if we got that far.
            return new OperationResult(true, "Prod HA restart requested (connection dropped — normal during restart)", null);
        }
        catch (Exception ex)
        {
            return new OperationResult(false, $"HA restart request failed: {ex.Message}", null);
        }
    }

    public async Task<OperationResult> SetMirrorModeAsync(bool controlMode, CancellationToken ct)
    {
        var arg = controlMode ? "on" : "off";
        var (ok, msg) = await docker.RunScriptAsync(paths.MirrorControlScript, arg, ct);
        var label = controlMode ? "Control mode enabled" : "Read-only mode enabled";
        return new OperationResult(ok, ok ? label : "Mirror mode change failed", msg);
    }

    public async Task<OperationResult> DeployMirrorAsync(CancellationToken ct)
    {
        var (ok, msg) = await docker.RunScriptAsync(paths.DeployMirrorScript, "", ct);
        return new OperationResult(ok, ok ? "Mirror deployed" : "Mirror deploy failed", msg);
    }

    public async Task<OperationResult> RestartStagingHaAsync(CancellationToken ct)
    {
        var container = EnvFile.Get(paths.EnvFile, "STAGING_HA_CONTAINER");
        if (string.IsNullOrWhiteSpace(container))
            return new OperationResult(false, "STAGING_HA_CONTAINER not set in .env", null);

        var (ok, msg) = await docker.RestartContainerAsync(container, ct);
        if (!string.IsNullOrWhiteSpace(msg))
            await sidecar.AppendSyncLogAsync(ok ? $"Restarted staging HA ({container})" : $"Restart staging HA failed ({container}): {msg}", ct);
        else if (ok)
            await sidecar.AppendSyncLogAsync($"Restarted staging HA ({container})", ct);

        return new OperationResult(ok, ok ? $"Restarted {container}" : "Restart failed", msg);
    }

    async Task<OperationResult> RunSidecarScript(string script, string label, CancellationToken ct)
    {
        if (!await sidecar.IsSyncLoopRunningAsync(ct))
            return new OperationResult(false, $"Config sync loop is not running — check {paths.SyncLogLocation}", null);

        var (ok, msg) = await sidecar.RunScriptAsync(script, ct);
        if (!string.IsNullOrWhiteSpace(msg))
            await sidecar.AppendSyncLogAsync(msg, ct);

        return new OperationResult(ok, ok ? $"{label} completed" : $"{label} failed", msg);
    }

    // Parse HA_SECRETS env var ("user@host:/path/secrets.yaml") into (userHost, configPath)
    (string UserHost, string ConfigPath)? ParseProdTarget()
    {
        var haSecrets = EnvFile.Get(paths.EnvFile, "HA_SECRETS") ?? "";
        if (string.IsNullOrWhiteSpace(haSecrets)) return null;

        var colonIdx = haSecrets.IndexOf(':');
        var userHost = colonIdx > 0 ? haSecrets[..colonIdx] : haSecrets;
        var remotePath = colonIdx > 0 ? haSecrets[(colonIdx + 1)..] : "";
        var configPath = remotePath.EndsWith("/secrets.yaml", StringComparison.OrdinalIgnoreCase)
            ? remotePath[..^"/secrets.yaml".Length]
            : remotePath.TrimEnd('/');

        if (string.IsNullOrWhiteSpace(configPath)) configPath = "/config";
        if (!userHost.Contains('@')) userHost = $"root@{userHost}";
        return (userHost, configPath);
    }

    async Task WriteLastDeployedShaAsync(CancellationToken ct)
    {
        try
        {
            var (ok, sha, _) = await RunGitBashAsync("git -C /repo rev-parse origin/main 2>/dev/null", ct);
            if (!ok || string.IsNullOrWhiteSpace(sha))
                return;

            var newSha = sha.Trim();
            var current = ReadLastDeployedSha();
            if (!string.IsNullOrWhiteSpace(current)
                && !string.Equals(current, newSha, StringComparison.OrdinalIgnoreCase))
            {
                File.WriteAllText(paths.LastProdDeployPreviousShaFile, current);
            }

            File.WriteAllText(paths.LastProdDeployShaFile, newSha);
        }
        catch { }
    }

    string SshBase() =>
        $"-i {ShQ(paths.SshKeyFile)} -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30";

    static string ShQ(string s) => "'" + s.Replace("'", "'\\''") + "'";

    static string ShellQuote(string value) => ShQ(value);

    async Task<(bool Ok, string Stdout, string Stderr)> RunGitBashAsync(string script, CancellationToken ct)
    {
        var psi = new ProcessStartInfo("bash")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        psi.ArgumentList.Add("-c");
        psi.ArgumentList.Add(script);
        gitSsh.Apply(psi);
        using var proc = Process.Start(psi);
        if (proc is null) return (false, "", "Failed to start bash");
        var stdoutTask = proc.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        return (proc.ExitCode == 0, (await stdoutTask).Trim(), (await stderrTask).Trim());
    }

    static async Task<(bool Ok, string Stdout, string Stderr)> RunBashAsync(string script, CancellationToken ct)
    {
        var psi = new ProcessStartInfo("bash")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        psi.ArgumentList.Add("-c");
        psi.ArgumentList.Add(script);
        using var proc = Process.Start(psi);
        if (proc is null) return (false, "", "Failed to start bash");
        var stdoutTask = proc.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        return (proc.ExitCode == 0, (await stdoutTask).Trim(), (await stderrTask).Trim());
    }

    /// <summary>Release agent: deploy git ref to prod without staging→main merge.</summary>
    public async Task<(OperationResult Result, bool YamlDeployed, IReadOnlyList<string> StoragePaths)> DeployProdConfigAtRefAsync(
        string gitRef,
        string? baselineSha,
        CancellationToken ct)
    {
        var logs = new List<string>();
        var haChanged = await HaConfigChangedSinceAsync(baselineSha, gitRef, ct);
        var changedStoragePaths = await storageDeploy.GetChangedStoragePathsAsync(baselineSha, gitRef, ct);
        var storageDeployPaths = storageDeploy.ResolveDeployPaths(changedStoragePaths);
        var lovelaceChanged = changedStoragePaths.Any(ProdStorageDeployService.IsLovelacePath);

        if (!haChanged && storageDeployPaths.Count == 0)
        {
            return (new OperationResult(
                true,
                $"No HA or dashboard changes between baseline and {gitRef[..Math.Min(7, gitRef.Length)]}",
                null), false, []);
        }

        if (lovelaceChanged || await Zigbee2MqttChangedSinceAsync(baselineSha, gitRef, ct))
        {
            var gate = lovelaceChanged
                ? await storageDeploy.PreflightLovelaceBundleAsync(gitRef, ct)
                : await storageDeploy.PreflightZ2mConfigAsync(gitRef, ct);
            if (!gate.Ok)
            {
                var detail = BuildLovelaceGateFailure(gate);
                logs.Add(detail);
                return (new OperationResult(false, "Release blocked — entity deploy scan failed", JoinLogs(logs, detail)), false, []);
            }
        }

        if (haChanged)
        {
            var pull = await SshGitDeployRefAsync(gitRef, ct);
            logs.Add(pull.Message);
            if (!pull.Ok)
                return (new OperationResult(false, pull.Message, pull.LogTail), false, []);
        }

        if (storageDeployPaths.Count > 0)
        {
            var storageResult = await storageDeploy.DeployStorageFilesFromRefAsync(gitRef, storageDeployPaths, ct);
            logs.Add(storageResult.Message);
            if (!storageResult.Ok)
                return (new OperationResult(false, storageResult.Message, storageResult.LogTail), haChanged, storageDeployPaths);

            var restart = await RestartProdHaAsync(ct);
            logs.Add(restart.Message);
            if (!restart.Ok)
                return (new OperationResult(false, restart.Message, restart.LogTail), haChanged, storageDeployPaths);

            return (new OperationResult(
                true,
                haChanged
                    ? "Prod config deployed — YAML plus dashboard/helper .storage bundle"
                    : "Prod config deployed — dashboard/helper .storage bundle",
                JoinLogs(logs, restart.LogTail)), haChanged, storageDeployPaths);
        }

        var reload = await ReloadProdHaAsync(ct);
        logs.Add(reload.Message);
        if (!reload.Ok)
            return (new OperationResult(false, reload.Message, reload.LogTail), haChanged, []);

        return (new OperationResult(
            true,
            "Prod config deployed — YAML reloaded",
            JoinLogs(logs, reload.LogTail)), haChanged, []);
    }

    public async Task<OperationResult> RollbackProdConfigToRefAsync(string gitRef, CancellationToken ct)
    {
        var logs = new List<string> { $"Rolling back prod config to {gitRef[..Math.Min(7, gitRef.Length)]}" };
        var deploy = await SshGitDeployRefAsync(gitRef, ct);
        logs.Add(deploy.Message);
        if (!deploy.Ok)
            return Fail(logs, deploy.LogTail);

        var restore = await RestoreProdStorageFilesFromRefAsync(gitRef, ct);
        logs.Add(restore.Message);
        if (!restore.Ok)
            return Fail(logs, restore.LogTail);

        var restart = await RestartProdHaAsync(ct);
        logs.Add(restart.Message);
        if (!restart.Ok)
            return Fail(logs, restart.LogTail);

        return new OperationResult(
            true,
            $"Prod config rolled back to {gitRef[..Math.Min(7, gitRef.Length)]}",
            JoinLogs(logs, restart.LogTail));
    }

    public Task<OperationResult> StopProdCoreAsync(CancellationToken ct) => StopProdHaCoreAsync(ct);

    public Task<OperationResult> StartProdCoreAsync(CancellationToken ct) => StartProdHaCoreAsync(ct);

    async Task<OperationResult> StopProdHaCoreAsync(CancellationToken ct)
    {
        var (prodUrl, prodToken) = TokenFile.Read(paths.ProdTokenFile);
        if (string.IsNullOrWhiteSpace(prodUrl) || string.IsNullOrWhiteSpace(prodToken))
            return new OperationResult(false, "Prod HA token not configured", null);

        try
        {
            using var http = httpClientFactory.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(120);
            using var req = new HttpRequestMessage(
                HttpMethod.Post,
                $"{prodUrl.TrimEnd('/')}/api/services/homeassistant/stop");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", prodToken);
            req.Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
            using var resp = await http.SendAsync(req, ct);
            if (resp.IsSuccessStatusCode || (int)resp.StatusCode == 504)
                return new OperationResult(true, "Prod HA stop requested", null);
            return new OperationResult(false, $"Prod HA stop returned HTTP {(int)resp.StatusCode}", null);
        }
        catch (Exception ex) when (ex is TaskCanceledException or HttpRequestException)
        {
            return new OperationResult(true, "Prod HA stop requested (connection dropped)", null);
        }
        catch (Exception ex)
        {
            return new OperationResult(false, $"Prod HA stop failed: {ex.Message}", null);
        }
    }

    async Task<OperationResult> StartProdHaCoreAsync(CancellationToken ct)
    {
        var target = ParseProdTarget();
        if (target is null)
            return new OperationResult(false, "Prod SSH not configured", null);

        var (userHost, configPath) = target.Value;
        var sshBase = SshBase();
        var (startOk, startOut, startErr) = await RunBashAsync(
            $"ssh {sshBase} {ShQ(userHost)} {ShQ("sudo bash -lc \"ha core start\"")}",
            ct);
        if (!startOk)
            return new OperationResult(false, "Prod HA start failed — start core manually", startErr);

        return new OperationResult(true, "Prod HA core started", startOut);
    }

    async Task<OperationResult> WaitForProdCoreDownAsync(CancellationToken ct)
    {
        var (prodUrl, prodToken) = TokenFile.Read(paths.ProdTokenFile);
        if (string.IsNullOrWhiteSpace(prodUrl))
            return new OperationResult(false, "Prod HA URL not configured", null);

        for (var attempt = 0; attempt < 30; attempt++)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                using var http = httpClientFactory.CreateClient();
                http.Timeout = TimeSpan.FromSeconds(3);
                using var req = new HttpRequestMessage(HttpMethod.Get, $"{prodUrl.TrimEnd('/')}/api/");
                if (!string.IsNullOrWhiteSpace(prodToken))
                    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", prodToken);
                using var resp = await http.SendAsync(req, ct);
                if (!resp.IsSuccessStatusCode)
                    return new OperationResult(true, "Prod HA API is down", null);
            }
            catch (Exception) when (attempt < 29)
            {
                return new OperationResult(true, "Prod HA API is down", null);
            }

            await Task.Delay(TimeSpan.FromSeconds(2), ct);
        }

        return new OperationResult(false, "Timed out waiting for prod HA to stop", null);
    }

    static OperationResult Fail(IReadOnlyList<string> logs, string? tail) =>
        new(false, logs[^1], JoinLogs(logs, tail));

    static string JoinLogs(IReadOnlyList<string> logs, string? tail)
    {
        var combined = string.Join(Environment.NewLine, logs.Where(l => !string.IsNullOrWhiteSpace(l)));
        if (string.IsNullOrWhiteSpace(tail))
            return combined;
        return string.IsNullOrWhiteSpace(combined) ? tail : combined + Environment.NewLine + tail;
    }
}
