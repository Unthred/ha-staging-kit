using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

/// <summary>
/// Validates and deploys staging-authored .storage bundles to prod (Lovelace quartet + UI helpers).
/// Never uses git reset on prod .storage — files are copied via SSH tee only.
/// Entity deploy scan is read-only on prod — user fixes integration/HA naming manually, then Recheck.
/// </summary>
public sealed class ProdStorageDeployService(
    KitPaths paths,
    GitSshConfigurator gitSsh,
    IHttpClientFactory httpClientFactory,
    LovelaceParityDeferStore deferStore,
    LovelaceParityFixActionStore fixActionStore,
    LovelaceParityUndoStore undoStore,
    ProdRegistryReader prodRegistry,
    ProdZigbee2MqttReader z2mReader,
    EntityDeployScanStore scanStore)
{
    static readonly Regex LovelaceEntityFieldRegex = new(
        """entity(?:_id)?"\s*:\s*"([a-z_][a-z0-9_]*\.[a-z0-9_]+)""",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);
    public static readonly string[] LovelaceBundlePaths =
    [
        ".storage/lovelace.lovelace",
        ".storage/lovelace.map",
        ".storage/lovelace_dashboards",
        ".storage/lovelace_resources",
    ];

    public static readonly string[] HelperBundlePaths =
    [
        ".storage/input_boolean",
        ".storage/input_number",
        ".storage/input_select",
        ".storage/input_text",
        ".storage/input_datetime",
        ".storage/timer",
        ".storage/scheduler.storage",
    ];

    public static bool IsLovelacePath(string path) =>
        LovelaceBundlePaths.Contains(NormalizeRepoPath(path), StringComparer.OrdinalIgnoreCase);

    public static bool IsHelperPath(string path) =>
        HelperBundlePaths.Contains(NormalizeRepoPath(path), StringComparer.OrdinalIgnoreCase);

    public async Task<IReadOnlyList<string>> GetChangedStoragePathsAsync(
        string? baseline,
        string gitRef,
        CancellationToken ct)
    {
        var allPaths = LovelaceBundlePaths.Concat(HelperBundlePaths).ToArray();
        var pathArgs = string.Join(" ", allPaths.Select(ShQ));

        string stdout;
        if (string.IsNullOrWhiteSpace(baseline))
        {
            var (ok, ls, _) = await RunGitBashAsync(
                $"git -C /repo ls-tree -r --name-only {gitRef} -- {pathArgs}", ct);
            if (!ok)
                return [];
            stdout = ls;
        }
        else
        {
            var (diffOk, diffOut, _) = await RunGitBashAsync(
                $"git -C /repo diff --name-only {ShQ(baseline)} {gitRef} -- {pathArgs}", ct);
            if (!diffOk)
                return [];
            stdout = diffOut;
        }

        return stdout
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(NormalizeRepoPath)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public IReadOnlyList<string> ResolveDeployPaths(IReadOnlyList<string> changedPaths)
    {
        var deploy = new List<string>();
        if (changedPaths.Any(IsLovelacePath))
            deploy.AddRange(LovelaceBundlePaths);
        deploy.AddRange(changedPaths.Where(IsHelperPath));
        return deploy.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    public Task<ProdStoragePreflightResult> PreflightLovelaceBundleAsync(string gitRef, CancellationToken ct) =>
        PreflightLovelaceBundleAsync(gitRef, LovelaceParitySource.GitRef, ct);

    public Task<ProdStoragePreflightResult> PreflightZ2mConfigAsync(string gitRef, CancellationToken ct) =>
        BuildZ2mPreflightAsync(gitRef, LovelaceParitySource.GitRef, ct);

    /// <summary>
    /// Deploy/release gate: block only on entity refs, card resources, or Z2M issues
    /// newly introduced since <paramref name="baselineSha"/>. Pre-existing git/prod drift
    /// is advisory — fix in Operations, not a deploy blocker.
    /// </summary>
    public async Task<ProdStorageDeployGateResult> PreflightLovelaceBundleDeployAsync(
        string? baselineSha,
        string gitRef,
        bool z2mChangedInDiff,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(baselineSha))
            return MapFullPreflightToDeployGate(await PreflightLovelaceBundleAsync(gitRef, ct));

        var issues = new List<string>();
        var baselineRefs = await CollectLovelaceEntityReferencesAsync(baselineSha, LovelaceParitySource.GitRef, ct);
        var targetRefs = await CollectLovelaceEntityReferencesAsync(gitRef, LovelaceParitySource.GitRef, ct);
        var baselineIds = baselineRefs.Keys.ToHashSet(StringComparer.Ordinal);
        var targetIds = targetRefs.Keys.ToHashSet(StringComparer.Ordinal);
        var deltaIds = targetIds.Except(baselineIds).ToList();

        var (prodUrl, prodToken) = TokenFile.Read(paths.ProdTokenFile);
        if (string.IsNullOrWhiteSpace(prodUrl) || string.IsNullOrWhiteSpace(prodToken))
        {
            return new ProdStorageDeployGateResult(
                false,
                0,
                0,
                0,
                0,
                [],
                [],
                [],
                [],
                ["Prod HA API token not configured — add prod.token to kit secrets"]);
        }

        var prodEntities = await FetchEntityIdsAsync(prodUrl, prodToken, ct);
        if (prodEntities is null)
        {
            return new ProdStorageDeployGateResult(
                false,
                0,
                0,
                0,
                0,
                [],
                [],
                [],
                [],
                ["Could not read entity list from prod HA — check prod URL/token"]);
        }

        var registry = await prodRegistry.ReadAsync(ct);
        var (stagingUrl, stagingToken) = TokenFile.Read(paths.StagingTokenFile);
        var stagingEntities = !string.IsNullOrWhiteSpace(stagingUrl) && !string.IsNullOrWhiteSpace(stagingToken)
            ? await FetchEntityIdsAsync(stagingUrl, stagingToken, ct)
            : null;

        var preExistingMissing = targetIds.Where(id => !prodEntities.Contains(id)).Except(deltaIds).ToList();
        if (preExistingMissing.Count > 0)
        {
            issues.Add(
                $"{preExistingMissing.Count} entity reference(s) in git Lovelace already missing on prod — not introduced by this deploy. Fix in Operations → Entity Janitor when ready.");
        }

        var deltaReferences = deltaIds.ToDictionary(id => id, id => targetRefs[id], StringComparer.Ordinal);
        var deltaMissingIds = deltaIds.Where(id => !prodEntities.Contains(id)).ToList();
        var deltaMissingIssues = LovelaceEntityAnalysis.BuildMissingIssues(
            deltaMissingIds,
            deltaReferences,
            prodEntities,
            stagingEntities ?? new HashSet<string>(StringComparer.Ordinal),
            registry);
        var deltaMissingEntities = deltaMissingIssues.Select(i => i.EntityId).ToList();

        var baselineResources = await ReadResourceUrlsAsync(baselineSha, LovelaceParitySource.GitRef, ct);
        var targetResources = await ReadResourceUrlsAsync(gitRef, LovelaceParitySource.GitRef, ct);
        var deltaResources = targetResources.Except(baselineResources).Order(StringComparer.Ordinal).ToList();
        var missingDeltaResources = new List<string>();
        var prodResources = await ReadProdResourceUrlsAsync(ct);
        if (prodResources is null)
        {
            issues.Add("Could not read prod lovelace_resources — check prod SSH settings");
        }
        else if (deltaResources.Count > 0)
        {
            missingDeltaResources = deltaResources
                .Where(url => !prodResources.Contains(url))
                .Order(StringComparer.Ordinal)
                .ToList();
            if (missingDeltaResources.Count > 0)
            {
                issues.Add(
                    $"{missingDeltaResources.Count} new Lovelace resource URL(s) in this deploy missing on prod — install matching HACS cards first");
            }
        }

        IReadOnlyList<Z2mStaleConfigIssue> z2mIssues = [];
        if (z2mChangedInDiff)
        {
            var z2mPreflight = await BuildZ2mPreflightAsync(gitRef, LovelaceParitySource.GitRef, ct);
            z2mIssues = z2mPreflight.Z2mConfigIssues;
            issues.AddRange(z2mPreflight.Issues);
        }

        var deltaBlockers = deltaMissingEntities.Count
            + missingDeltaResources.Count
            + z2mIssues.Count(i => i.BlocksDeploy);
        var ok = deltaBlockers == 0;
        var removedEntityRefCount = baselineIds.Except(targetIds).Count();
        if (ok && deltaIds.Count == 0 && missingDeltaResources.Count == 0 && !z2mChangedInDiff)
        {
            issues.Insert(0, "Entity Janitor: no new entity references or dashboard resources in this change");
        }

        return new ProdStorageDeployGateResult(
            ok,
            deltaBlockers,
            preExistingMissing.Count,
            deltaIds.Count,
            removedEntityRefCount,
            deltaMissingEntities,
            deltaMissingIssues,
            missingDeltaResources,
            z2mIssues,
            issues);
    }

    static ProdStorageDeployGateResult MapFullPreflightToDeployGate(ProdStoragePreflightResult full) =>
        new(
            full.Ok,
            full.MissingEntityIssues.Count + full.MissingCustomCards.Count + full.Z2mConfigIssues.Count(i => i.BlocksDeploy),
            0,
            full.EntityRefCount,
            0,
            full.MissingEntities,
            full.MissingEntityIssues,
            full.MissingCustomCards,
            full.Z2mConfigIssues,
            full.Issues);

    public async Task<ProdStoragePreflightResult> PreflightLovelaceBundleForPanelAsync(
        string gitRef,
        CancellationToken ct)
    {
        var local = await PreflightLovelaceBundleAsync(gitRef, LovelaceParitySource.WorkingTree, ct, "Local dashboard (1/2)");
        var deploy = await PreflightLovelaceBundleAsync(gitRef, LovelaceParitySource.GitRef, ct, "Published dashboard (2/2)");

        var localRefs = await CollectLovelaceEntityReferencesAsync(gitRef, LovelaceParitySource.WorkingTree, ct);
        var localParseFailed = local.Issues.Any(i => i.Contains("Invalid JSON", StringComparison.Ordinal));
        var localDraftEntityIds = await ResolveLocalDraftEntityIdsAsync(localRefs, localParseFailed, ct);
        var localDeferredIds = local.DeferredEntityIssues
            .Select(i => i.EntityId)
            .ToHashSet(StringComparer.Ordinal);
        var localBlockingById = local.MissingEntityIssues
            .ToDictionary(i => i.EntityId, StringComparer.Ordinal);

        var panelBlocking = new List<LovelaceMissingEntityIssue>();
        foreach (var deployIssue in deploy.MissingEntityIssues)
        {
            if (!localDraftEntityIds.Contains(deployIssue.EntityId))
                continue;
            if (localDeferredIds.Contains(deployIssue.EntityId))
                continue;

            panelBlocking.Add(
                localBlockingById.TryGetValue(deployIssue.EntityId, out var localIssue)
                    ? localIssue
                    : deployIssue);
        }

        foreach (var localIssue in local.MissingEntityIssues)
        {
            if (localDeferredIds.Contains(localIssue.EntityId))
                continue;
            if (panelBlocking.Any(i => i.EntityId.Equals(localIssue.EntityId, StringComparison.Ordinal)))
                continue;
            panelBlocking.Add(localIssue);
        }

        panelBlocking = panelBlocking
            .OrderBy(i => i.EntityId, StringComparer.Ordinal)
            .ToList();

        var deployAwaitingPublish = EnrichAwaitingPublishActions(
            deploy.MissingEntityIssues
                .Where(i => !localDraftEntityIds.Contains(i.EntityId))
                .Where(i => !localDeferredIds.Contains(i.EntityId))
                .OrderBy(i => i.EntityId, StringComparer.Ordinal)
                .ToList(),
            fixActionStore.Load(),
            undoStore.GetEntries());

        var deployIssueCount = deploy.MissingEntityIssues.Count;
        var fixedLocally = deployAwaitingPublish.Count;

        var pendingCommit = !deploy.Ok
            && panelBlocking.Count == 0
            && deployIssueCount > 0
            && local.DeferredEntityIssues.Count == 0;

        var issues = new List<string>(local.Issues);
        if (localParseFailed)
        {
            issues.Insert(
                0,
                "Local dashboard JSON is invalid — kit fixes may have left a syntax error. Repair .storage/lovelace.lovelace or Reset workbench before continuing.");
        }

        if (local.DeferredEntityIssues.Count > 0)
        {
            issues.Add(
                $"{local.DeferredEntityIssues.Count} entity reference(s) deferred — cards may error on prod until fixed manually.");
        }

        if (fixedLocally > 0 && !pendingCommit)
        {
            issues.Add(
                $"{fixedLocally} issue(s) fixed in the dashboard draft — save and publish before deploy.");
        }

        if (pendingCommit)
        {
            issues.Add(
                "Dashboard fixes are saved locally — publish to staging branch, then Recheck before deploy.");
        }

        var allowProdRegistryPurge = await prodRegistry.ReadAsync(ct) is not null;

        return new ProdStoragePreflightResult(
            deploy.Ok && panelBlocking.Count == 0 && !pendingCommit,
            local.EntityRefCount,
            deploy.BlockerCount,
            local.DeferredEntityIssues.Count,
            panelBlocking.Select(i => i.EntityId).ToList(),
            panelBlocking,
            local.DeferredEntityIssues,
            deploy.MissingCustomCards,
            issues,
            pendingCommit,
            deployIssueCount + deploy.Z2mConfigIssues.Count(i => i.BlocksDeploy),
            fixedLocally,
            local.Recheck,
            false,
            null,
            deploy.Z2mConfigIssues,
            deployAwaitingPublish,
            allowProdRegistryPurge,
            []);
    }

    public async Task<IReadOnlyList<ProdEntityNamingIssue>> ScanProdNamingIssuesAsync(
        IEnumerable<string> lovelaceEntityIds,
        CancellationToken ct) =>
        await BuildProdNamingIssuesCoreAsync(lovelaceEntityIds, ct);

    public async Task<IReadOnlyList<ProdEntityNamingIssue>> ScanProdNamingIssuesAsync(CancellationToken ct) =>
        await BuildProdNamingIssuesCoreAsync([], ct);

    public static ProdStoragePreflightResult AttachProdNamingIssues(
        ProdStoragePreflightResult result,
        IReadOnlyList<ProdEntityNamingIssue> namingIssues)
    {
        if (namingIssues.Count == 0)
            return result with { ProdNamingIssues = namingIssues };

        var message =
            $"{namingIssues.Count} prod entity naming issue(s) — `_2` / numeric cast suffixes that should be cleaned up on prod.";
        var issues = result.Issues.Any(i => i.Contains("prod entity naming issue", StringComparison.Ordinal))
            ? result.Issues
            : result.Issues.Concat([message]).ToList();

        return result with { ProdNamingIssues = namingIssues, Issues = issues };
    }

    async Task<IReadOnlyList<ProdEntityNamingIssue>> BuildProdNamingIssuesCoreAsync(
        IEnumerable<string> lovelaceEntityIds,
        CancellationToken ct)
    {
        var registry = await prodRegistry.ReadAsync(ct);
        if (registry is null)
            return [];

        var (prodUrl, prodToken) = TokenFile.Read(paths.ProdTokenFile);
        if (string.IsNullOrWhiteSpace(prodUrl) || string.IsNullOrWhiteSpace(prodToken))
            return [];

        var prodLiveIds = await FetchEntityIdsAsync(prodUrl, prodToken, ct);
        if (prodLiveIds is null)
            return [];

        var gitRefs = ProdEntityNamingAnalysis.CollectGitEntityReferences(lovelaceEntityIds);
        return ProdEntityNamingAnalysis.BuildIssues(registry, prodLiveIds, gitRefs);
    }

    static IReadOnlyList<LovelaceMissingEntityIssue> EnrichAwaitingPublishActions(
        IReadOnlyList<LovelaceMissingEntityIssue> issues,
        IReadOnlyDictionary<string, LovelaceParityFixActionEntry> actions,
        IReadOnlyList<LovelaceParityUndoEntry> undoEntries)
    {
        var undoActions = undoEntries
            .Where(entry => entry.Action is "rename" or "remove")
            .GroupBy(entry => entry.EntityId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Last().Action, StringComparer.Ordinal);

        return issues
            .Select(issue =>
            {
                if (actions.TryGetValue(issue.EntityId, out var entry))
                    return issue with { AwaitingPublishAction = entry.Action };

                if (undoActions.TryGetValue(issue.EntityId, out var undoAction))
                    return issue with { AwaitingPublishAction = undoAction };

                return issue with { AwaitingPublishAction = "fixed" };
            })
            .ToList();
    }

    async Task<Dictionary<string, List<LovelaceEntityReference>>> CollectLovelaceEntityReferencesAsync(
        string gitRef,
        LovelaceParitySource source,
        CancellationToken ct)
    {
        var lovelaceDocs = new Dictionary<string, JsonDocument>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in LovelaceBundlePaths)
        {
            var (ok, json, _) = await ReadLovelaceJsonAsync(gitRef, path, source, ct);
            if (!ok || string.IsNullOrWhiteSpace(json))
                continue;

            try
            {
                lovelaceDocs[path] = JsonDocument.Parse(json);
            }
            catch (JsonException)
            {
                // Skip invalid JSON — preflight pass will surface parse errors.
            }
        }

        var references = LovelaceEntityAnalysis.CollectReferences(lovelaceDocs);
        foreach (var doc in lovelaceDocs.Values)
            doc.Dispose();

        return references;
    }

    async Task<HashSet<string>> ResolveLocalDraftEntityIdsAsync(
        IReadOnlyDictionary<string, List<LovelaceEntityReference>> parsedRefs,
        bool localParseFailed,
        CancellationToken ct)
    {
        var ids = parsedRefs.Keys.ToHashSet(StringComparer.Ordinal);
        if (ids.Count == 0 || localParseFailed)
        {
            foreach (var id in await CollectLovelaceEntityIdsFromRawFilesAsync(ct))
                ids.Add(id);
        }

        return ids;
    }

    async Task<HashSet<string>> CollectLovelaceEntityIdsFromRawFilesAsync(CancellationToken ct)
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var path in LovelaceBundlePaths)
        {
            var diskPath = Path.Combine("/repo", path);
            if (!File.Exists(diskPath))
                continue;

            ct.ThrowIfCancellationRequested();
            var text = await File.ReadAllTextAsync(diskPath, ct);
            foreach (Match match in LovelaceEntityFieldRegex.Matches(text))
            {
                var entityId = match.Groups[1].Value;
                if (!string.IsNullOrWhiteSpace(entityId))
                    ids.Add(entityId);
            }
        }

        return ids;
    }

    static (IReadOnlyList<LovelaceMissingEntityIssue> Blocking, IReadOnlyList<LovelaceMissingEntityIssue> Deferred)
        PartitionIssues(
            IReadOnlyList<LovelaceMissingEntityIssue> issues,
            IReadOnlySet<string> deferredIds)
    {
        var blocking = new List<LovelaceMissingEntityIssue>();
        var deferred = new List<LovelaceMissingEntityIssue>();
        foreach (var issue in issues)
        {
            if (deferredIds.Contains(issue.EntityId))
            {
                deferred.Add(issue with { FixOptions = LovelaceEntityAnalysis.BuildDeferredFixOptions() });
            }
            else
            {
                blocking.Add(issue);
            }
        }

        return (blocking, deferred);
    }

    async Task<ProdStoragePreflightResult> PreflightLovelaceBundleAsync(
        string gitRef,
        LovelaceParitySource source,
        CancellationToken ct,
        string? passLabel = null)
    {
        var issues = new List<string>();
        var lovelaceDocs = new Dictionary<string, JsonDocument>(StringComparer.OrdinalIgnoreCase);
        string Step(string detail) => passLabel is null ? detail : $"{passLabel} — {detail}";

        PreflightProgressStore.Advance(Step("reading bundle"));
        foreach (var path in LovelaceBundlePaths)
        {
            var (ok, json, err) = await ReadLovelaceJsonAsync(gitRef, path, source, ct);
            if (!ok || string.IsNullOrWhiteSpace(json))
            {
                issues.Add(source == LovelaceParitySource.WorkingTree
                    ? $"Could not read {path} from repo: {err}"
                    : $"Could not read {path} from git: {err}");
                continue;
            }

            try
            {
                lovelaceDocs[path] = JsonDocument.Parse(json);
            }
            catch (JsonException ex)
            {
                issues.Add($"Invalid JSON in {path}: {ex.Message}");
            }
        }

        PreflightProgressStore.Advance(Step("collecting entity references"));
        var references = LovelaceEntityAnalysis.CollectReferences(lovelaceDocs);
        foreach (var doc in lovelaceDocs.Values)
            doc.Dispose();

        var entityRefs = references.Keys.ToHashSet(StringComparer.Ordinal);

        var (prodUrl, prodToken) = TokenFile.Read(paths.ProdTokenFile);
        if (string.IsNullOrWhiteSpace(prodUrl) || string.IsNullOrWhiteSpace(prodToken))
        {
            return EmptyResult(
                entityRefs.Count,
                ["Prod HA API token not configured — add prod.token to kit secrets"]);
        }

        PreflightProgressStore.Advance(Step("loading prod entity list"));
        var prodEntities = await FetchEntityIdsAsync(prodUrl, prodToken, ct);
        if (prodEntities is null)
        {
            return EmptyResult(
                entityRefs.Count,
                ["Could not read entity list from prod HA — check prod URL/token"]);
        }

        PreflightProgressStore.Advance(Step("loading prod entity registry"));
        var registry = await prodRegistry.ReadAsync(ct);
        if (registry is null && source == LovelaceParitySource.GitRef)
        {
            issues.Add(
                "Could not read prod entity registry — manual-fix hints may be limited (check prod SSH settings)");
        }

        var (stagingUrl, stagingToken) = TokenFile.Read(paths.StagingTokenFile);
        PreflightProgressStore.Advance(Step("loading staging entity list"));
        var stagingEntities = !string.IsNullOrWhiteSpace(stagingUrl) && !string.IsNullOrWhiteSpace(stagingToken)
            ? await FetchEntityIdsAsync(stagingUrl, stagingToken, ct)
            : null;

        PreflightProgressStore.Advance(Step("analysing mismatches"));
        var missingEntityIds = entityRefs
            .Where(id => !prodEntities.Contains(id))
            .ToList();
        var missingIssues = LovelaceEntityAnalysis.BuildMissingIssues(
            missingEntityIds,
            references,
            prodEntities,
            stagingEntities ?? new HashSet<string>(StringComparer.Ordinal),
            registry);

        var deferredIds = deferStore.Load();
        // Incomplete JSON parse yields partial missingIssues — pruning would drop valid defers.
        var scanComplete = !issues.Any(i => i.Contains("Invalid JSON", StringComparison.Ordinal));
        if (scanComplete)
            deferStore.PruneStale(missingIssues.Select(i => i.EntityId));
        deferredIds = deferStore.Load();
        var (blockingIssues, deferredIssues) = PartitionIssues(missingIssues, deferredIds);
        var missingEntities = blockingIssues.Select(i => i.EntityId).ToList();

        PreflightProgressStore.Advance(Step("checking Lovelace card resources"));
        var gitResources = await ReadResourceUrlsAsync(gitRef, source, ct);
        var prodResources = await ReadProdResourceUrlsAsync(ct);
        var missingResources = new List<string>();
        if (prodResources is null)
        {
            issues.Add("Could not read prod lovelace_resources — check prod SSH settings");
        }
        else
        {
            missingResources = gitResources
                .Where(url => !prodResources.Contains(url))
                .Order(StringComparer.Ordinal)
                .ToList();
            if (missingResources.Count > 0)
            {
                issues.Add(
                    $"{missingResources.Count} Lovelace resource URL(s) in git are missing on prod — install matching HACS cards on prod first");
            }
        }

        var okToDeploy = missingEntities.Count == 0
            && missingResources.Count == 0
            && issues.Count == 0;

        EntityDeployRecheckDelta? recheck = null;
        if (source == LovelaceParitySource.WorkingTree)
            recheck = scanStore.RecordScan(missingEntities);

        PreflightProgressStore.Advance(Step("checking Zigbee2MQTT config"));
        var z2mIssues = await ScanZ2mConfigIssuesAsync(gitRef, source, ct);
        var blockingZ2m = z2mIssues.Count(i => i.BlocksDeploy);
        if (blockingZ2m > 0)
        {
            issues.Add(
                $"{blockingZ2m} Zigbee2MQTT config issue(s) on prod — fix in git, deploy, then restart Z2M");
            okToDeploy = false;
        }

        return MergeZ2mIssues(
            new ProdStoragePreflightResult(
                okToDeploy,
                entityRefs.Count,
                blockingIssues.Count + blockingZ2m,
                deferredIssues.Count,
                missingEntities,
                blockingIssues,
                deferredIssues,
                missingResources.Take(12).ToList(),
                issues,
                false,
                blockingIssues.Count + blockingZ2m,
                0,
                recheck,
                false,
                null,
                [],
                [],
                false,
                []),
            z2mIssues);
    }

    async Task<ProdStoragePreflightResult> BuildZ2mPreflightAsync(
        string gitRef,
        LovelaceParitySource source,
        CancellationToken ct)
    {
        var issues = new List<string>();
        PreflightProgressStore.Advance("Checking Zigbee2MQTT config");
        var z2mIssues = await ScanZ2mConfigIssuesAsync(gitRef, source, ct);
        var blockingZ2m = z2mIssues.Count(i => i.BlocksDeploy);
        if (blockingZ2m > 0)
        {
            issues.Add(
                $"{blockingZ2m} Zigbee2MQTT config issue(s) on prod — fix in git, deploy, then restart Z2M");
        }
        else if (z2mIssues.Count > 0)
        {
            issues.Add(
                "Zigbee2MQTT fix is in git — deploy to prod, restart Zigbee2MQTT, then Recheck");
        }

        return MergeZ2mIssues(
            new ProdStoragePreflightResult(
                blockingZ2m == 0,
                0,
                blockingZ2m,
                0,
                [],
                [],
                [],
                [],
                issues,
                false,
                blockingZ2m,
                0,
                null,
                false,
                null,
                [],
                [],
                false,
                []),
            z2mIssues);
    }

    async Task<IReadOnlyList<Z2mStaleConfigIssue>> ScanZ2mConfigIssuesAsync(
        string gitRef,
        LovelaceParitySource source,
        CancellationToken ct)
    {
        var registry = await prodRegistry.ReadAsync(ct);
        var snapshot = await z2mReader.ReadProdSnapshotAsync(ct);
        if (snapshot is null)
            return [];

        var prodIssues = Zigbee2MqttStaleConfigAnalysis.DetectIssues(snapshot, registry?.ActiveEntities);
        var gitYaml = await ReadZ2mConfigYamlAsync(gitRef, source, ct);
        if (string.IsNullOrWhiteSpace(gitYaml))
            return prodIssues;

        var gitConfig = ProdZigbee2MqttReader.ParseConfigurationYaml(gitYaml);
        return Zigbee2MqttStaleConfigAnalysis.ApplyGitFixStatus(prodIssues, gitConfig);
    }

    async Task<string?> ReadZ2mConfigYamlAsync(
        string gitRef,
        LovelaceParitySource source,
        CancellationToken ct)
    {
        const string relativePath = "zigbee2mqtt/configuration.yaml";
        if (source == LovelaceParitySource.WorkingTree)
        {
            var diskPath = Path.Combine("/repo", relativePath);
            if (File.Exists(diskPath))
                return await File.ReadAllTextAsync(diskPath, ct);
        }

        var (ok, stdout, _) = await ReadGitFileAsync(gitRef, relativePath, ct);
        return ok && !string.IsNullOrWhiteSpace(stdout) ? stdout : null;
    }

    static ProdStoragePreflightResult MergeZ2mIssues(
        ProdStoragePreflightResult result,
        IReadOnlyList<Z2mStaleConfigIssue> z2mIssues)
    {
        if (z2mIssues.Count == 0)
            return result;

        var blockingZ2m = z2mIssues.Count(i => i.BlocksDeploy);
        return result with
        {
            Ok = result.Ok && blockingZ2m == 0,
            BlockerCount = result.BlockerCount + blockingZ2m,
            DeployIssueCount = result.DeployIssueCount + blockingZ2m,
            Z2mConfigIssues = z2mIssues,
        };
    }

    public static ProdStoragePreflightResult EmptyPreflight(
        int entityRefCount,
        IReadOnlyList<string> issues) =>
        new(
            false,
            entityRefCount,
            0,
            0,
            [],
            [],
            [],
            [],
            issues,
            false,
            0,
            0,
            null,
            false,
            null,
            [],
            [],
            false,
            []);

    static ProdStoragePreflightResult EmptyResult(int entityRefCount, IReadOnlyList<string> issues) =>
        EmptyPreflight(entityRefCount, issues);

    public async Task<OperationResult> DeployStorageFilesFromRefAsync(
        string gitRef,
        IReadOnlyList<string> relativePaths,
        CancellationToken ct)
    {
        var target = ParseProdTarget();
        if (target is null)
            return new OperationResult(false, "Prod SSH not configured — set SSH target in Settings", null);
        if (!File.Exists(paths.SshKeyFile))
            return new OperationResult(false, "SSH key not found — add id_ed25519 to the kit secrets directory", null);

        var (userHost, configPath) = target.Value;
        var sshBase = SshBase();
        var deployed = 0;
        var labels = new List<string>();

        foreach (var relativePath in relativePaths)
        {
            var (existsOk, _, _) = await RunGitBashAsync(
                $"git -C /repo cat-file -e {gitRef}:{relativePath} 2>/dev/null", ct);
            if (!existsOk)
                continue;

            var dest = $"{configPath}/{relativePath}";
            var remoteTee = ShQ($"sudo tee {dest} > /dev/null");
            var script =
                $"git -C /repo show {ShellQuote(gitRef)}:{ShellQuote(relativePath)} | " +
                $"nice -n 15 ssh {sshBase} {ShQ(userHost)} {remoteTee}";
            var (ok, _, stderr) = await RunBashAsync(script, ct);
            if (!ok)
                return new OperationResult(false, $"Failed to deploy {relativePath} to prod", stderr);

            deployed++;
            labels.Add(relativePath[".storage/".Length..]);
        }

        if (deployed == 0)
            return new OperationResult(false, "No .storage files found in git to deploy", null);

        return new OperationResult(
            true,
            $"Deployed {deployed} prod .storage file(s): {string.Join(", ", labels)}",
            null);
    }

    async Task<HashSet<string>?> FetchEntityIdsAsync(string url, string token, CancellationToken ct)
    {
        try
        {
            using var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(15);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await client.GetAsync($"{url.TrimEnd('/')}/api/states", ct);
            if (!response.IsSuccessStatusCode)
                return null;

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                return null;

            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (!item.TryGetProperty("entity_id", out var idProp))
                    continue;
                var id = idProp.GetString();
                if (!string.IsNullOrWhiteSpace(id))
                    ids.Add(id);
            }

            return ids;
        }
        catch
        {
            return null;
        }
    }

    async Task<HashSet<string>> ReadResourceUrlsAsync(
        string gitRef,
        LovelaceParitySource source,
        CancellationToken ct)
    {
        var (ok, json, _) = await ReadLovelaceJsonAsync(gitRef, ".storage/lovelace_resources", source, ct);
        if (!ok || string.IsNullOrWhiteSpace(json))
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        return ParseResourceUrls(json);
    }

    async Task<HashSet<string>?> ReadProdResourceUrlsAsync(CancellationToken ct)
    {
        var target = ParseProdTarget();
        if (target is null)
            return null;

        var (userHost, configPath) = target.Value;
        var path = $"{configPath}/.storage/lovelace_resources";
        var sshBase = SshBase();
        var remoteCmd = ShQ($"sudo cat {path} 2>/dev/null");
        var (ok, stdout, _) = await RunBashAsync($"ssh {sshBase} {ShQ(userHost)} {remoteCmd}", ct);
        if (!ok || string.IsNullOrWhiteSpace(stdout))
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        return ParseResourceUrls(stdout);
    }

    static HashSet<string> ParseResourceUrls(string json)
    {
        var urls = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("data", out var data)
                || !data.TryGetProperty("items", out var items)
                || items.ValueKind != JsonValueKind.Array)
            {
                return urls;
            }

            foreach (var item in items.EnumerateArray())
            {
                if (item.TryGetProperty("url", out var urlProp))
                {
                    var url = urlProp.GetString();
                    if (!string.IsNullOrWhiteSpace(url))
                        urls.Add(url.Trim());
                }
            }
        }
        catch (JsonException)
        {
            /* best effort */
        }

        return urls;
    }

    async Task<(bool Ok, string Stdout, string Stderr)> ReadLovelaceJsonAsync(
        string gitRef,
        string relativePath,
        LovelaceParitySource source,
        CancellationToken ct)
    {
        if (source == LovelaceParitySource.WorkingTree)
        {
            var diskPath = Path.Combine("/repo", relativePath);
            if (File.Exists(diskPath))
            {
                ct.ThrowIfCancellationRequested();
                return (true, await File.ReadAllTextAsync(diskPath, ct), "");
            }
        }

        return await ReadGitFileAsync(gitRef, relativePath, ct);
    }

    async Task<(bool Ok, string Stdout, string Stderr)> ReadGitFileAsync(
        string gitRef,
        string relativePath,
        CancellationToken ct)
    {
        return await RunGitBashAsync(
            $"git -C /repo show {ShellQuote(gitRef)}:{ShellQuote(relativePath)}", ct);
    }

    (string UserHost, string ConfigPath)? ParseProdTarget()
    {
        var haSecrets = EnvFile.Get(paths.EnvFile, "HA_SECRETS") ?? "";
        if (string.IsNullOrWhiteSpace(haSecrets))
            return null;

        var colonIdx = haSecrets.IndexOf(':');
        var userHost = colonIdx > 0 ? haSecrets[..colonIdx] : haSecrets;
        var remotePath = colonIdx > 0 ? haSecrets[(colonIdx + 1)..] : "";
        var configPath = remotePath.EndsWith("/secrets.yaml", StringComparison.OrdinalIgnoreCase)
            ? remotePath[..^"/secrets.yaml".Length]
            : remotePath.TrimEnd('/');

        if (string.IsNullOrWhiteSpace(configPath))
            configPath = "/config";
        if (!userHost.Contains('@'))
            userHost = $"root@{userHost}";
        return (userHost, configPath);
    }

    string SshBase() =>
        $"-i {ShQ(paths.SshKeyFile)} -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30";

    static string NormalizeRepoPath(string path) =>
        path.Replace('\\', '/').TrimStart('/');

    static string ShQ(string s) => "'" + s.Replace("'", "'\\''") + "'";

    static string ShellQuote(string value) => ShQ(value);

    async Task<(bool Ok, string Stdout, string Stderr)> RunGitBashAsync(string script, CancellationToken ct) =>
        await RunBashAsync(script, ct);

    async Task<(bool Ok, string Stdout, string Stderr)> RunBashAsync(string script, CancellationToken ct)
    {
        var psi = new System.Diagnostics.ProcessStartInfo("bash")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        psi.ArgumentList.Add("-c");
        psi.ArgumentList.Add(script);
        gitSsh.Apply(psi);
        using var proc = System.Diagnostics.Process.Start(psi)
            ?? throw new InvalidOperationException("Failed to start bash");
        var stdoutTask = proc.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        var stdout = await stdoutTask;
        var stderr = await stderrTask;
        return (proc.ExitCode == 0, stdout.Trim(), stderr.Trim());
    }
}
