using System.Diagnostics;
using System.Text.Json;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services.Release;

public sealed class ReleaseAgentService(
    KitPaths paths,
    GitSshConfigurator gitSsh,
    DashboardBuilder dashboard,
    OperationsService operations,
    ReleaseHistoryStore historyStore,
    MigrationManifestLoader manifestLoader,
    MigrationRunner migrationRunner,
    ProdRegistrySnapshotService registrySnapshots)
{
    const string PendingPrefix = "migrations/pending/";

    public async Task<ReleaseAgentPlanResult> PlanAsync(string gitRef, CancellationToken ct)
    {
        var resolve = await ResolveGitRefAsync(gitRef, ct);
        if (!resolve.Ok || string.IsNullOrWhiteSpace(resolve.Sha))
        {
            return new ReleaseAgentPlanResult(
                false,
                resolve.Message,
                null,
                null,
                [],
                [],
                [],
                false,
                resolve.LogTail);
        }

        var manifests = await LoadPendingManifestsAsync(resolve.Sha, ct);
        var skipped = manifests.Where(m => historyStore.IsMigrationApplied(m.Id)).Select(m => m.Id).ToList();
        var willRun = manifests.Where(m => !historyStore.IsMigrationApplied(m.Id)).Select(m => m.Id).ToList();
        var requiresStop = manifests
            .Where(m => !historyStore.IsMigrationApplied(m.Id))
            .Any(migrationRunner.RequiresRegistryStop);

        var lines = new List<string>
        {
            $"Git ref `{gitRef}` → {resolve.ShortSha}",
            $"Pending manifests: {manifests.Count}",
            willRun.Count > 0 ? $"Will run: {string.Join(", ", willRun)}" : "No new migrations to run",
            skipped.Count > 0 ? $"Skipped (already applied): {string.Join(", ", skipped)}" : "",
        };

        return new ReleaseAgentPlanResult(
            true,
            "Release plan ready",
            resolve.Sha,
            resolve.ShortSha,
            manifests.Select(m => m.RelativePath).ToList(),
            skipped,
            willRun,
            requiresStop,
            string.Join("\n", lines.Where(l => !string.IsNullOrWhiteSpace(l))));
    }

    public async Task<ReleaseImpactPreviewResult> ImpactAsync(string gitRef, CancellationToken ct)
    {
        var requestedRef = string.IsNullOrWhiteSpace(gitRef) ? "origin/main" : gitRef.Trim();
        var previewRef = await operations.ResolveReleasePreviewRefAsync(requestedRef, ct);
        var mergesStagingFirst = !string.Equals(previewRef, requestedRef, StringComparison.OrdinalIgnoreCase);

        var plan = await PlanAsync(previewRef, ct);
        if (!plan.Ok || string.IsNullOrWhiteSpace(plan.GitSha))
        {
            return new ReleaseImpactPreviewResult(
                false,
                plan.Message,
                "high",
                true,
                false,
                plan.Message,
                [plan.Message],
                [],
                plan.GitSha,
                plan.ShortSha,
                null,
                false,
                false,
                false,
                false,
                false,
                plan.RequiresRegistryStop,
                plan.WillRunManifests,
                null);
        }

        var context = await operations.GetReleaseDeployContextAsync(requestedRef, ct);
        var gate = context.DeployGate;
        var blockers = BuildImpactBlockers(gate);
        var warnings = BuildImpactWarnings(context, gate, plan);
        if (mergesStagingFirst)
        {
            warnings.Insert(
                0,
                "Release merges GitHub staging into main first — impact includes HA work not yet on main");
        }
        var blocksRelease = !gate.Ok;
        var requiresConfirm = !blocksRelease && warnings.Count > 0;
        var impactLevel = blocksRelease ? "high" : requiresConfirm ? "medium" : "low";
        var summary = BuildImpactSummary(plan, context, gate, blocksRelease, warnings.Count);

        return new ReleaseImpactPreviewResult(
            true,
            blocksRelease ? "Release blocked — fix new issues before shipping" : "Release impact preview ready",
            impactLevel,
            blocksRelease,
            requiresConfirm,
            summary,
            blockers,
            warnings,
            plan.GitSha,
            plan.ShortSha,
            context.BaselineSha,
            context.YamlDeploy,
            context.LovelaceBundleDeploy,
            context.HelpersDeploy,
            context.Z2mConfigDeploy,
            context.RequiresProdRestart,
            plan.RequiresRegistryStop,
            plan.WillRunManifests,
            gate);
    }

    static List<string> BuildImpactBlockers(ProdStorageDeployGateResult gate)
    {
        var blockers = new List<string>();
        if (gate.DeltaBlockerCount > 0)
        {
            if (gate.MissingEntityIssues.Count > 0)
            {
                blockers.Add(
                    $"{gate.MissingEntityIssues.Count} new Lovelace entity reference(s) in this release missing on prod");
            }

            if (gate.MissingCustomCards.Count > 0)
            {
                blockers.Add(
                    $"{gate.MissingCustomCards.Count} new Lovelace resource URL(s) in this release missing on prod");
            }

            var z2mBlockers = gate.Z2mConfigIssues.Count(i => i.BlocksDeploy);
            if (z2mBlockers > 0)
            {
                blockers.Add($"{z2mBlockers} new Zigbee2MQTT config issue(s) in this release");
            }
        }

        if (!gate.Ok && blockers.Count == 0)
        {
            blockers.AddRange(gate.Issues.Where(i =>
                !i.Contains("pre-existing", StringComparison.OrdinalIgnoreCase) &&
                !i.Contains("not introduced by this deploy", StringComparison.OrdinalIgnoreCase)));
        }

        return blockers;
    }

    static List<string> BuildImpactWarnings(
        ReleaseDeployContext context,
        ProdStorageDeployGateResult gate,
        ReleaseAgentPlanResult plan)
    {
        var warnings = new List<string>();

        if (gate.PreExistingMissingCount > 0)
        {
            warnings.Add(
                $"{gate.PreExistingMissingCount} entity reference(s) in git Lovelace already missing on prod — not introduced by this release");
        }

        if (context.LovelaceBundleDeploy)
        {
            var entityNote = gate.NewEntityRefCount > 0 || gate.RemovedEntityRefCount > 0
                ? $" ({gate.NewEntityRefCount} new, {gate.RemovedEntityRefCount} removed entity refs in diff)"
                : " (layout/text changes only — no new entity refs)";
            warnings.Add($"Full Lovelace .storage bundle replace on prod{entityNote}");
        }

        if (context.HelpersDeploy)
            warnings.Add("Helper .storage files will be updated on prod");

        if (context.YamlDeploy)
            warnings.Add("YAML config deploy via git reset on prod");

        if (context.Z2mConfigDeploy)
            warnings.Add("Zigbee2MQTT configuration.yaml changes — restart the Z2M add-on after release");

        if (plan.WillRunManifests.Count > 0)
            warnings.Add($"Migrations will run: {string.Join(", ", plan.WillRunManifests)}");

        if (plan.RequiresRegistryStop)
            warnings.Add("Stops Home Assistant Core briefly for registry migration work");

        if (context.RequiresProdRestart && !context.LovelaceBundleDeploy && !context.HelpersDeploy)
            warnings.Add("Prod Home Assistant will restart to apply changes");

        return warnings;
    }

    static string BuildImpactSummary(
        ReleaseAgentPlanResult plan,
        ReleaseDeployContext context,
        ProdStorageDeployGateResult gate,
        bool blocksRelease,
        int warningCount)
    {
        var shortSha = plan.ShortSha ?? plan.GitSha?[..Math.Min(7, plan.GitSha.Length)] ?? "main";
        if (blocksRelease)
        {
            return gate.DeltaBlockerCount > 0
                ? $"Release @ {shortSha} blocked — {gate.DeltaBlockerCount} new issue(s) would break prod"
                : $"Release @ {shortSha} blocked — Entity Janitor could not verify prod safely";
        }

        if (warningCount > 0)
        {
            return $"Release @ {shortSha} — {warningCount} advisory note(s); confirm before applying";
        }

        if (!context.YamlDeploy && !context.LovelaceBundleDeploy && !context.HelpersDeploy && !context.Z2mConfigDeploy
            && plan.WillRunManifests.Count == 0)
        {
            return $"Release @ {shortSha} — no HA file changes detected";
        }

        return $"Release @ {shortSha} — low impact; no known breakages detected";
    }

    public async Task<OperationResult> ApplyAsync(ReleaseAgentApplyRequest request, CancellationToken ct)
    {
        if (!AcquireLock())
            return new OperationResult(false, "Another release is in progress (release.lock held)", null);

        try
        {
            var logs = new List<string>();
            if (request.MergeStaging)
            {
                var merge = await MergeStagingToMainIfNeededAsync(ct);
                logs.Add(merge.Message);
                if (!merge.Ok)
                    return new OperationResult(false, merge.Message, merge.LogTail);
            }

            var plan = await PlanAsync(request.GitRef, ct);
            if (!plan.Ok || string.IsNullOrWhiteSpace(plan.GitSha))
                return new OperationResult(false, plan.Message, JoinLogs(logs, plan.LogTail));

            logs.Add(plan.LogTail ?? plan.Message);
            var manifests = await LoadPendingManifestsAsync(plan.GitSha, ct);
            var toRun = manifests.Where(m => !historyStore.IsMigrationApplied(m.Id)).ToList();
            var appliedIds = new List<string>();
            var registryStopped = false;

            if (toRun.Any(migrationRunner.RequiresRegistryStop))
            {
                var stop = await operations.StopProdCoreAsync(ct);
                logs.Add(stop.Message);
                if (!stop.Ok)
                    return Fail(logs, stop.LogTail);

                var down = await WaitForProdDownAsync(ct);
                logs.Add(down.Message);
                if (!down.Ok)
                    return Fail(logs, down.LogTail);

                registryStopped = true;
            }

            foreach (var manifest in toRun.OrderBy(m => m.RelativePath, StringComparer.Ordinal))
            {
                var pre = await migrationRunner.ValidatePreconditionsAsync(manifest, ct);
                logs.Add(pre.Message);
                if (!pre.Ok)
                    return Fail(logs, pre.LogTail);

                var run = await migrationRunner.RunAsync(manifest, ct);
                logs.Add(run.Message);
                if (!run.Ok)
                    return Fail(logs, run.LogTail);

                historyStore.AppendMigrationApplied(manifest.Id, plan.GitSha, manifest.RelativePath);
                appliedIds.Add(manifest.Id);
            }

            if (registryStopped)
            {
                var start = await operations.StartProdCoreAsync(ct);
                logs.Add(start.Message);
                if (!start.Ok)
                    return Fail(logs, start.LogTail);
                registryStopped = false;
            }

            var current = historyStore.CurrentRelease();
            var baseline = current?.Sha;
            var deploy = await operations.DeployProdConfigAtRefAsync(plan.GitSha, baseline, ct);
            logs.Add(deploy.Result.Message);
            if (!deploy.Result.Ok)
                return Fail(logs, deploy.Result.LogTail);

            var shortSha = plan.ShortSha ?? plan.GitSha[..Math.Min(7, plan.GitSha.Length)];
            var snapshot = await registrySnapshots.CapturePostReleaseAsync(
                shortSha,
                includeDeviceRegistry: appliedIds.Count > 0,
                ct);
            logs.Add(snapshot.Message);

            Directory.CreateDirectory(paths.ReleaseReportsDir);
            var reportPath = Path.Combine(paths.ReleaseReportsDir, $"{shortSha}.json");
            await File.WriteAllTextAsync(
                reportPath,
                JsonSerializer.Serialize(new
                {
                    sha = plan.GitSha,
                    appliedAt = DateTimeOffset.UtcNow,
                    migrationsApplied = appliedIds,
                    yamlDeployed = deploy.YamlDeployed,
                    storageBundlePaths = deploy.StoragePaths,
                }),
                ct);

            var history = historyStore.LoadHistory();
            var nextIndex = history.Releases.Count == 0 ? 1 : history.Releases.Max(r => r.Index) + 1;
            historyStore.AppendRelease(new ReleaseHistoryEntry(
                nextIndex,
                plan.GitSha,
                shortSha,
                DateTimeOffset.UtcNow,
                request.GitRef,
                request.Message,
                appliedIds,
                deploy.YamlDeployed,
                deploy.StoragePaths.ToList(),
                snapshot.EntityRegistryPath,
                snapshot.DeviceRegistryPath,
                reportPath));

            return new OperationResult(
                true,
                $"Release applied — {shortSha} ({appliedIds.Count} migration(s))",
                JoinLogs(logs, null));
        }
        finally
        {
            ReleaseLock();
        }
    }

    public Task<ReleaseAgentHistoryResult> HistoryAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var doc = historyStore.LoadHistory();
        return Task.FromResult(new ReleaseAgentHistoryResult(
            true,
            doc.Releases.Count == 0 ? "No releases recorded yet" : $"{doc.Releases.Count} release(s)",
            doc.Releases,
            doc.CurrentIndex));
    }

    public async Task<OperationResult> RollbackAsync(ReleaseAgentRollbackRequest request, CancellationToken ct)
    {
        if (!AcquireLock())
            return new OperationResult(false, "Another release is in progress (release.lock held)", null);

        try
        {
            var doc = historyStore.LoadHistory();
            if (doc.Releases.Count == 0)
                return new OperationResult(false, "No release history — nothing to roll back", null);

            var target = ResolveRollbackTarget(doc, request);
            if (target is null)
                return new OperationResult(false, "Could not resolve rollback target", null);

            var logs = new List<string>
            {
                $"Rolling back to release #{target.Index} ({target.ShortSha})",
            };

            var stop = await operations.StopProdCoreAsync(ct);
            logs.Add(stop.Message);
            if (!stop.Ok)
                return Fail(logs, stop.LogTail);

            var down = await WaitForProdDownAsync(ct);
            logs.Add(down.Message);
            if (!down.Ok)
                return Fail(logs, down.LogTail);

            if (!string.IsNullOrWhiteSpace(target.RegistrySnapshot))
            {
                var restore = await registrySnapshots.RestoreSnapshotAsync(
                    target.RegistrySnapshot,
                    target.DeviceRegistrySnapshot,
                    ct);
                logs.Add(restore.Message);
                if (!restore.Ok)
                    return Fail(logs, restore.LogTail);
            }

            var config = await operations.RollbackProdConfigToRefAsync(target.Sha, ct);
            logs.Add(config.Message);
            if (!config.Ok)
                return Fail(logs, config.LogTail);

            historyStore.TruncateToReleaseIndex(target.Index);

            return new OperationResult(
                true,
                $"Rolled back prod to release #{target.Index} ({target.ShortSha})",
                JoinLogs(logs, null));
        }
        finally
        {
            ReleaseLock();
        }
    }

    static ReleaseHistoryEntry? ResolveRollbackTarget(ReleaseHistoryDocument doc, ReleaseAgentRollbackRequest request)
    {
        if (request.ToIndex is > 0)
            return doc.Releases.FirstOrDefault(r => r.Index == request.ToIndex.Value);

        if (!string.IsNullOrWhiteSpace(request.ToSha))
        {
            var sha = request.ToSha.Trim();
            return doc.Releases.LastOrDefault(r =>
                string.Equals(r.Sha, sha, StringComparison.OrdinalIgnoreCase)
                || string.Equals(r.ShortSha, sha, StringComparison.OrdinalIgnoreCase)
                || r.Sha.StartsWith(sha, StringComparison.OrdinalIgnoreCase));
        }

        var steps = request.Steps ?? 1;
        if (steps <= 0)
            return doc.Releases.LastOrDefault();

        var current = doc.Releases.LastOrDefault(r => r.Index == doc.CurrentIndex) ?? doc.Releases.Last();
        var targetIndex = current.Index - steps;
        return doc.Releases.FirstOrDefault(r => r.Index == targetIndex);
    }

    async Task<IReadOnlyList<MigrationManifestDocument>> LoadPendingManifestsAsync(string gitSha, CancellationToken ct)
    {
        var (ok, stdout, _) = await RunGitBashAsync(
            $"git -C /repo ls-tree --name-only {gitSha} migrations/pending/ 2>/dev/null",
            ct);
        if (!ok || string.IsNullOrWhiteSpace(stdout))
            return [];

        var manifests = new List<MigrationManifestDocument>();
        foreach (var line in stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!line.EndsWith(".yaml", StringComparison.OrdinalIgnoreCase))
                continue;

            var relativePath = line.Replace('\\', '/');
            var (showOk, yaml, _) = await RunGitBashAsync(
                $"git -C /repo show {gitSha}:{ShellQuote(relativePath)}",
                ct);
            if (!showOk || string.IsNullOrWhiteSpace(yaml))
                continue;

            manifests.Add(manifestLoader.Parse(yaml, relativePath));
        }

        return manifests.OrderBy(m => m.RelativePath, StringComparer.Ordinal).ToList();
    }

    async Task<OperationResult> MergeStagingToMainIfNeededAsync(CancellationToken ct)
    {
        if (!Directory.Exists("/repo/.git"))
            return new OperationResult(false, "Git repo not configured in kit", null);

        var stagingBranch = EnvFile.Get(paths.EnvFile, "HA_BRANCH") ?? "staging";
        var (fetchOk, _, fetchErr) = await RunGitBashAsync("git -C /repo fetch origin 2>/dev/null", ct);
        if (!fetchOk)
            return new OperationResult(false, "git fetch failed before release", fetchErr);

        var stagingAhead = await GitRevCountAsync($"origin/main..origin/{stagingBranch}", ct);
        var commitsAhead = await GitRevCountAsync($"origin/{stagingBranch}..HEAD", ct);
        if (commitsAhead > 0)
        {
            return new OperationResult(
                false,
                $"{commitsAhead} local commit(s) not on GitHub — push before requesting release",
                null);
        }

        if (stagingAhead <= 0)
            return new OperationResult(true, "GitHub staging is already on main", null);

        var (dirtyOk, dirtyOut, _) = await RunGitBashAsync("git -C /repo status --porcelain", ct);
        if (dirtyOk && !string.IsNullOrWhiteSpace(dirtyOut))
        {
            return new OperationResult(
                false,
                "Uncommitted local changes — commit before merging staging to main for release",
                null);
        }

        return await dashboard.PromoteStagingToMainAsync(ct);
    }

    async Task<int> GitRevCountAsync(string range, CancellationToken ct)
    {
        var (ok, stdout, _) = await RunGitBashAsync($"git -C /repo rev-list --count {range} 2>/dev/null", ct);
        return ok && int.TryParse(stdout.Trim(), out var count) ? count : 0;
    }

    async Task<(bool Ok, string? Sha, string? ShortSha, string Message, string? LogTail)> ResolveGitRefAsync(
        string gitRef,
        CancellationToken ct)
    {
        if (!Directory.Exists("/repo/.git"))
            return (false, null, null, "Git repo not configured in kit", null);

        await RunGitBashAsync("git -C /repo fetch origin 2>/dev/null || true", ct);
        var (ok, sha, stderr) = await RunGitBashAsync($"git -C /repo rev-parse {ShellQuote(gitRef)}", ct);
        if (!ok || string.IsNullOrWhiteSpace(sha))
            return (false, null, null, $"Could not resolve git ref `{gitRef}`", stderr);

        var full = sha.Trim();
        return (true, full, full[..Math.Min(7, full.Length)], $"Resolved {gitRef} → {full[..7]}", null);
    }

    async Task<OperationResult> WaitForProdDownAsync(CancellationToken ct)
    {
        var (prodUrl, prodToken) = TokenFile.Read(paths.ProdTokenFile);
        if (string.IsNullOrWhiteSpace(prodUrl))
            return new OperationResult(false, "Prod HA URL not configured", null);

        for (var attempt = 0; attempt < 30; attempt++)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
                using var req = new HttpRequestMessage(HttpMethod.Get, $"{prodUrl.TrimEnd('/')}/api/");
                if (!string.IsNullOrWhiteSpace(prodToken))
                    req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", prodToken);
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

    bool AcquireLock()
    {
        try
        {
            Directory.CreateDirectory(paths.SidecarData);
            if (File.Exists(paths.ReleaseLockFile))
                return false;
            File.WriteAllText(paths.ReleaseLockFile, DateTimeOffset.UtcNow.ToString("O"));
            return true;
        }
        catch
        {
            return false;
        }
    }

    void ReleaseLock()
    {
        try { File.Delete(paths.ReleaseLockFile); }
        catch { /* ignore */ }
    }

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
        if (proc is null)
            return (false, "", "Failed to start bash");
        var stdoutTask = proc.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        return (proc.ExitCode == 0, (await stdoutTask).Trim(), (await stderrTask).Trim());
    }

    static string ShellQuote(string value) => "'" + value.Replace("'", "'\\''") + "'";

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
