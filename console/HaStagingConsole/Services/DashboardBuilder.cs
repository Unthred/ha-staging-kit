using System.Diagnostics;
using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed partial class DashboardBuilder(
    KitPaths paths,
    IHttpClientFactory httpClientFactory)
{
    public async Task<GitSnapshotStatus> GetGitSnapshotAsync(Dictionary<string, string> env, CancellationToken ct)
    {
        if (!Directory.Exists("/repo/.git"))
            return new GitSnapshotStatus(false, null, null, null, null, false, 0, false, 0, false, 0, [], [], [], [], null, null, null, null, 0, null, 0);

        var branch = env.GetValueOrDefault("HA_BRANCH", "staging");
        var head = await RunGitAsync("/repo", "rev-parse", "--short", "HEAD");
        var subject = await RunGitAsync("/repo", "log", "-1", "--format=%s");
        var dateRaw = await RunGitAsync("/repo", "log", "-1", "--format=%cI");
        var status = await RunGitAsync("/repo", "status", "--porcelain");
        var currentBranch = await RunGitAsync("/repo", "rev-parse", "--abbrev-ref", "HEAD");
        var remoteUrl = await RunGitAsync("/repo", "remote", "get-url", "origin");

        DateTimeOffset? commitDate = null;
        if (DateTimeOffset.TryParse(dateRaw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed))
            commitDate = parsed;

        var (haChanged, repoChanged, haSamples, repoSamples, haPaths, repoPaths) = ClassifyGitStatus(status);
        var changedFiles = haChanged + repoChanged;
        var isDirty = changedFiles > 0;

        int? ahead = null;
        int? behind = null;
        var trackingBranch = string.IsNullOrWhiteSpace(currentBranch) ? branch : currentBranch;
        var aheadRaw = await RunGitAsync("/repo", "rev-list", "--count", $"origin/{trackingBranch}..HEAD");
        var behindRaw = await RunGitAsync("/repo", "rev-list", "--count", $"HEAD..origin/{trackingBranch}");
        if (int.TryParse(aheadRaw, out var a)) ahead = a;
        if (int.TryParse(behindRaw, out var b)) behind = b;

        // Staging → main gap: how many commits are on origin/staging not yet merged to origin/main
        int? stagingAheadOfMain = null;
        var stagingHaChanges = 0;
        var stagingMainCountRaw = await RunGitAsync("/repo", "rev-list", "--count", "origin/main..origin/staging");
        if (int.TryParse(stagingMainCountRaw, out var sam))
        {
            stagingAheadOfMain = sam;
            if (sam > 0)
            {
                var diff = await RunGitAsync("/repo", "diff", "--name-only", "origin/main..origin/staging");
                stagingHaChanges = diff
                    .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Count(IsHaDeployPath);
            }
        }

        // Main → prod HA gap: how many commits on origin/main since the last kit deploy
        int? mainAheadOfProdHa = null;
        var mainHaChangesForProdHa = 0;
        var lastDeployedSha = ReadLastDeployedSha();
        if (!string.IsNullOrWhiteSpace(lastDeployedSha))
        {
            var mainCountRaw = await RunGitAsync("/repo", "rev-list", "--count", $"{lastDeployedSha}..origin/main");
            if (int.TryParse(mainCountRaw, out var map))
            {
                mainAheadOfProdHa = map;
                if (map > 0)
                {
                    var diff = await RunGitAsync("/repo", "diff", "--name-only", $"{lastDeployedSha}..origin/main");
                    mainHaChangesForProdHa = diff
                        .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                        .Count(IsHaDeployPath);
                }
            }
        }

        return new GitSnapshotStatus(
            true,
            string.IsNullOrWhiteSpace(currentBranch) ? branch : currentBranch,
            string.IsNullOrWhiteSpace(head) ? null : head,
            string.IsNullOrWhiteSpace(subject) ? null : subject,
            commitDate,
            isDirty,
            changedFiles,
            haChanged > 0,
            haChanged,
            repoChanged > 0,
            repoChanged,
            haSamples,
            repoSamples,
            haPaths,
            repoPaths,
            ahead,
            behind,
            string.IsNullOrWhiteSpace(remoteUrl) ? null : remoteUrl,
            stagingAheadOfMain,
            stagingHaChanges,
            mainAheadOfProdHa,
            mainHaChangesForProdHa);
    }

    static (int HaCount, int RepoCount, IReadOnlyList<string> HaSamples, IReadOnlyList<string> RepoSamples, IReadOnlyList<string> HaFiles, IReadOnlyList<string> RepoFiles) ClassifyGitStatus(
        string status)
    {
        if (string.IsNullOrWhiteSpace(status))
            return (0, 0, [], [], [], []);

        var haPaths = new List<string>();
        var repoPaths = new List<string>();

        foreach (var raw in status.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (raw.Length < 3)
                continue;

            var path = raw[2..].TrimStart();
            var arrow = path.IndexOf(" -> ", StringComparison.Ordinal);
            if (arrow >= 0)
                path = path[(arrow + 4)..].Trim();

            if (IsHaConfigPath(path))
                haPaths.Add(path);
            else
                repoPaths.Add(path);
        }

        return (
            haPaths.Count,
            repoPaths.Count,
            haPaths.Take(8).ToList(),
            repoPaths.Take(8).ToList(),
            haPaths,
            repoPaths);
    }

    static bool IsHaConfigPath(string path)
    {
        path = path.Replace('\\', '/').TrimStart('/');
        if (path.Length == 0)
            return false;

        if (path.StartsWith("packages/", StringComparison.OrdinalIgnoreCase)
            || string.Equals(path, "packages", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (path.StartsWith("themes/", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("blueprints/", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (path.Contains('/', StringComparison.Ordinal))
            return false;

        if (!path.EndsWith(".yaml", StringComparison.OrdinalIgnoreCase)
            && !path.EndsWith(".yml", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return !string.Equals(path, "secrets.yaml", StringComparison.OrdinalIgnoreCase);
    }

    // Broader check used for staging→main and main→prod HA diffs — matches what OperationsService deploys.
    static bool IsHaDeployPath(string path)
    {
        path = path.Replace('\\', '/').TrimStart('/');
        if (path.Length == 0) return false;

        foreach (var dir in (string[])["packages/", "python_scripts/", "custom_components/", "blueprints/", "www/", "themes/", "lovelace/"])
            if (path.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) return true;

        if (path.Contains('/')) return false;
        if (!path.EndsWith(".yaml", StringComparison.OrdinalIgnoreCase) && !path.EndsWith(".yml", StringComparison.OrdinalIgnoreCase)) return false;
        return !string.Equals(path, "secrets.yaml", StringComparison.OrdinalIgnoreCase);
    }

    string ReadLastDeployedSha()
    {
        try { return File.ReadAllText(paths.LastProdDeployShaFile).Trim(); }
        catch { return ""; }
    }

    public async Task<GitFileDiffResult?> GetGitFileDiffAsync(string relativePath, CancellationToken ct)
    {
        if (!Directory.Exists("/repo/.git"))
            return null;

        relativePath = relativePath.Replace('\\', '/').TrimStart('/');
        if (string.IsNullOrWhiteSpace(relativePath) || relativePath.Contains("..", StringComparison.Ordinal))
            return null;

        var fullPath = Path.GetFullPath(Path.Combine("/repo", relativePath));
        if (!fullPath.StartsWith("/repo/", StringComparison.Ordinal))
            return null;

        var porcelain = await RunGitAsync("/repo", "status", "--porcelain", "--", relativePath);
        if (string.IsNullOrWhiteSpace(porcelain))
            return null;

        var firstLine = porcelain.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)[0];
        var statusCode = firstLine.Length >= 2 ? firstLine[..2] : "??";
        var isUntracked = statusCode == "??";
        var isDeleted = statusCode is " D" or "D " or "DD";

        string diff;
        string status;
        if (isUntracked)
        {
            status = "added";
            diff = await RunGitAsync("/repo", "diff", "--no-index", "--", "/dev/null", relativePath);
            if (string.IsNullOrWhiteSpace(diff) && File.Exists(fullPath))
            {
                var content = await File.ReadAllTextAsync(fullPath, ct);
                diff = BuildNewFileDiff(relativePath, content);
            }
        }
        else
        {
            status = isDeleted ? "deleted" : "modified";
            diff = await RunGitAsync("/repo", "diff", "HEAD", "--", relativePath);
            if (string.IsNullOrWhiteSpace(diff))
                diff = await RunGitAsync("/repo", "diff", "--", relativePath);
        }

        if (string.IsNullOrWhiteSpace(diff))
            diff = "(No diff output for this file.)";

        const int maxChars = 120_000;
        if (diff.Length > maxChars)
            diff = diff[..maxChars] + "\n\n… diff truncated …";

        return new GitFileDiffResult(relativePath, status, diff);
    }

    public async Task<OperationResult> CommitChangedFilesAsync(string scope, string? message, CancellationToken ct)
    {
        if (!Directory.Exists("/repo/.git"))
        {
            return new OperationResult(
                false,
                "Git repo not configured — set the HA config repo path in Settings",
                null);
        }

        var normalizedScope = scope.Trim().ToLowerInvariant();
        if (normalizedScope is not ("ha" or "repo"))
            return new OperationResult(false, "Invalid scope — use ha or repo", null);

        var status = await RunGitAsync("/repo", "status", "--porcelain");
        var (_, _, _, _, haPaths, repoPaths) = ClassifyGitStatus(status);
        var paths = normalizedScope == "ha" ? haPaths : repoPaths;

        if (paths.Count == 0)
        {
            return new OperationResult(
                false,
                normalizedScope == "ha" ? "No HA YAML changes to commit" : "No docs/repo changes to commit",
                null);
        }

        var addArgs = new List<string> { "add", "--" };
        addArgs.AddRange(paths);
        var (addOk, _, addErr) = await RunGitCommandAsync("/repo", ct, [.. addArgs]);
        if (!addOk)
        {
            var detail = FormatGitError(addErr);
            return new OperationResult(false, detail, addErr);
        }

        var commitMessage = string.IsNullOrWhiteSpace(message)
            ? normalizedScope == "ha"
                ? "chore(ha): update Home Assistant config"
                : "chore: update docs and repo files"
            : message.Trim();

        var (authorName, authorEmail, identityError) = await ResolveGitIdentityAsync(ct);
        if (identityError is not null)
            return identityError;

        var (commitOk, commitOut, commitErr) = await RunGitCommandAsync(
            "/repo",
            ct,
            "-c",
            $"user.name={authorName}",
            "-c",
            $"user.email={authorEmail}",
            "commit",
            "-m",
            commitMessage);
        if (!commitOk)
            return new OperationResult(false, FormatGitError(commitErr), commitErr);

        var hash = await RunGitAsync("/repo", "rev-parse", "--short", "HEAD");
        var label = string.IsNullOrWhiteSpace(hash) ? "HEAD" : hash;
        return new OperationResult(true, $"Committed {paths.Count} file(s) as {label}", commitOut);
    }

    public async Task<OperationResult> PushBranchAsync(string? branch, CancellationToken ct)
    {
        if (!Directory.Exists("/repo/.git"))
        {
            return new OperationResult(
                false,
                "Git repo not configured — set the HA config repo path in Settings",
                null);
        }

        branch = string.IsNullOrWhiteSpace(branch)
            ? EnvFile.Get(paths.EnvFile, "HA_BRANCH") ?? "staging"
            : branch.Trim();

        var (ok, stdout, stderr) = await RunGitCommandAsync("/repo", ct, "push", "origin", branch);
        if (!ok)
            return new OperationResult(false, FormatGitError(stderr), stderr);

        var detail = string.IsNullOrWhiteSpace(stdout) ? $"Pushed {branch} to origin" : stdout;
        return new OperationResult(true, detail, stderr);
    }

    public async Task<OperationResult> PromoteStagingToMainAsync(CancellationToken ct)
    {
        if (!Directory.Exists("/repo/.git"))
        {
            return new OperationResult(
                false,
                "Git repo not configured — set the HA config repo path in Settings",
                null);
        }

        var stagingBranch = EnvFile.Get(paths.EnvFile, "HA_BRANCH") ?? "staging";
        var status = await RunGitAsync("/repo", "status", "--porcelain");
        if (!string.IsNullOrWhiteSpace(status))
        {
            return new OperationResult(
                false,
                "Working tree has uncommitted changes — commit or discard before promoting to prod",
                null);
        }

        var originalBranch = await RunGitAsync("/repo", "rev-parse", "--abbrev-ref", "HEAD");

        var (fetchOk, _, fetchErr) = await RunGitCommandAsync("/repo", ct, "fetch", "origin");
        if (!fetchOk)
            return new OperationResult(false, FormatGitError(fetchErr), fetchErr);

        var (checkoutMainOk, _, checkoutMainErr) = await RunGitCommandAsync("/repo", ct, "checkout", "main");
        if (!checkoutMainOk)
            return new OperationResult(false, FormatGitError(checkoutMainErr), checkoutMainErr);

        var (pullOk, _, pullErr) = await RunGitCommandAsync("/repo", ct, "pull", "--ff-only", "origin", "main");
        if (!pullOk)
        {
            await RunGitCommandAsync("/repo", ct, "checkout", originalBranch);
            return new OperationResult(false, FormatGitError(pullErr), pullErr);
        }

        var mergeMessage = "chore: promote staging to production";
        var (mergeOk, _, mergeErr) = await RunGitCommandAsync(
            "/repo",
            ct,
            "merge",
            $"origin/{stagingBranch}",
            "-m",
            mergeMessage);
        if (!mergeOk)
        {
            await RunGitCommandAsync("/repo", ct, "merge", "--abort");
            await RunGitCommandAsync("/repo", ct, "checkout", originalBranch);
            return new OperationResult(false, FormatGitError(mergeErr), mergeErr);
        }

        var (pushOk, pushOut, pushErr) = await RunGitCommandAsync("/repo", ct, "push", "origin", "main");
        if (!pushOk)
        {
            await RunGitCommandAsync("/repo", ct, "checkout", originalBranch);
            return new OperationResult(false, FormatGitError(pushErr), pushErr);
        }

        if (!string.IsNullOrWhiteSpace(originalBranch) && !string.Equals(originalBranch, "main", StringComparison.Ordinal))
            await RunGitCommandAsync("/repo", ct, "checkout", originalBranch);

        var hash = await RunGitAsync("/repo", "rev-parse", "--short", "HEAD");
        var label = string.IsNullOrWhiteSpace(hash) ? "main" : hash;
        return new OperationResult(
            true,
            $"Promoted staging → main ({label}). Pushing to prod HA…",
            pushOut);
    }

    async Task<(string Name, string Email, OperationResult? Error)> ResolveGitIdentityAsync(CancellationToken ct)
    {
        var name = await RunGitAsync("/repo", "config", "user.name");
        var email = await RunGitAsync("/repo", "config", "user.email");

        if (string.IsNullOrWhiteSpace(name))
        {
            name = FirstNonEmpty(
                EnvFile.Get(paths.EnvFile, "GIT_USER_NAME"),
                File.Exists(paths.HostEnvFile) ? EnvFile.Get(paths.HostEnvFile, "GIT_USER_NAME") : null);
        }

        if (string.IsNullOrWhiteSpace(email))
        {
            email = FirstNonEmpty(
                EnvFile.Get(paths.EnvFile, "GIT_USER_EMAIL"),
                File.Exists(paths.HostEnvFile) ? EnvFile.Get(paths.HostEnvFile, "GIT_USER_EMAIL") : null);
        }

        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(email))
        {
            return ("", "", new OperationResult(
                false,
                "Git author not configured — set GIT_USER_NAME and GIT_USER_EMAIL in kit .env, or git config user.name/user.email in the repo",
                null));
        }

        return (name.Trim(), email.Trim(), null);
    }

    static string FormatGitError(string stderr)
    {
        if (string.IsNullOrWhiteSpace(stderr))
            return "Git command failed";

        if (stderr.Contains("Read-only file system", StringComparison.OrdinalIgnoreCase))
        {
            return "Config repo is mounted read-only — recreate the kit container so /repo is read-write (:rw in docker-compose)";
        }

        if (stderr.Contains("tell me who you are", StringComparison.OrdinalIgnoreCase))
        {
            return "Git author not configured — set GIT_USER_NAME and GIT_USER_EMAIL in kit .env";
        }

        return stderr.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault()
            ?? "Git command failed";
    }

    static string? FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
                return value.Trim();
        }

        return null;
    }

    static string BuildNewFileDiff(string path, string content)
    {
        var lines = content.Replace("\r\n", "\n").Split('\n');
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("--- /dev/null");
        sb.AppendLine($"+++ b/{path}");
        sb.AppendLine($"@@ -0,0 +1,{Math.Max(lines.Length, 1)} @@");
        foreach (var line in lines)
            sb.AppendLine($"+{line}");
        return sb.ToString();
    }

    public ConfigDriftStatus GetConfigDrift(GitSnapshotStatus? git)
    {
        if (git is not { Configured: true } || string.IsNullOrWhiteSpace(git.CommitHash))
            return new ConfigDriftStatus(false, null, null, "Git repo not available");

        var marker = Path.Combine(paths.SidecarData, "last-applied-commit");
        if (!File.Exists(marker))
            return new ConfigDriftStatus(
                true,
                git.CommitHash,
                null,
                "Config has not been applied since tracking started — run Apply staging config");

        var applied = File.ReadAllText(marker).Trim();
        var appliedShort = applied.Length > 7 ? applied[..7] : applied;
        if (applied.StartsWith(git.CommitHash, StringComparison.OrdinalIgnoreCase)
            || git.CommitHash.StartsWith(appliedShort, StringComparison.OrdinalIgnoreCase))
        {
            return new ConfigDriftStatus(false, git.CommitHash, appliedShort, "Staging matches latest git commit");
        }

        return new ConfigDriftStatus(
            true,
            git.CommitHash,
            appliedShort,
            $"Git is at {git.CommitHash} but last apply was {appliedShort}");
    }

    public PersonSyncSnapshot ParsePersonSync(string logs)
    {
        Match? last = null;
        foreach (Match match in PersonSyncLinePattern().Matches(logs))
            last = match;

        if (last is null)
            return new PersonSyncSnapshot(null, null, null);

        var count = int.TryParse(last.Groups["count"].Value, out var n) ? n : (int?)null;
        DateTimeOffset? at = null;
        if (DateTimeOffset.TryParseExact(
                last.Groups["at"].Value,
                "yyyy-MM-dd HH:mm:ss",
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal,
                out var parsed))
        {
            at = parsed;
        }

        return new PersonSyncSnapshot(count, at, at is null ? null : FormatRelative(at.Value));
    }

    public SyncActivitySnapshot ParseSyncActivity(string logs, PersonSyncSnapshot personSync)
    {
        DateTimeOffset? applyAt = null;
        string? applyCommit = null;
        DateTimeOffset? storageAt = null;

        foreach (var line in logs.Split('\n'))
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0)
                continue;

            if (ApplyCompletePattern().IsMatch(trimmed) || RecordedCommitPattern().IsMatch(trimmed))
                applyAt = ParseLogTimestamp(trimmed) ?? applyAt;

            var commitMatch = RecordedCommitPattern().Match(trimmed);
            if (commitMatch.Success)
                applyCommit = commitMatch.Groups["commit"].Value;

            if (StorageCompletePattern().IsMatch(trimmed))
                storageAt = ParseLogTimestamp(trimmed) ?? storageAt;
        }

        return new SyncActivitySnapshot(
            personSync.LastAt,
            personSync.LastAtRelative,
            personSync.LastCount,
            applyAt,
            applyAt is null ? null : FormatRelative(applyAt.Value),
            applyCommit,
            storageAt,
            storageAt is null ? null : FormatRelative(storageAt.Value));
    }

    public ConfigInventoryStats GetConfigInventory()
    {
        const string repo = "/repo";
        if (!Directory.Exists(Path.Combine(repo, ".git")))
            return new ConfigInventoryStats(false, 0, 0, 0, 0);

        var automations = CountPattern(Path.Combine(repo, "automations.yaml"), "- id:");
        var packagesDir = Path.Combine(repo, "packages");
        var packageCount = 0;
        if (Directory.Exists(packagesDir))
        {
            foreach (var file in Directory.GetFiles(packagesDir, "*.yaml", SearchOption.AllDirectories))
            {
                packageCount++;
                automations += CountPattern(file, "- id:");
            }
        }

        var scripts = CountRootYamlKeys(Path.Combine(repo, "scripts.yaml"));
        var blueprintDir = Path.Combine(repo, "blueprints");
        var blueprints = Directory.Exists(blueprintDir)
            ? Directory.GetFiles(blueprintDir, "*.yaml", SearchOption.AllDirectories).Length
            : 0;

        return new ConfigInventoryStats(true, automations, scripts, packageCount, blueprints);
    }

    public async Task<HaMonitoringStats?> GetInstanceMonitoringAsync(string? url, string tokenFile, CancellationToken ct)
    {
        var (resolvedUrl, token) = TokenFile.Read(tokenFile);
        url = string.IsNullOrWhiteSpace(url) ? resolvedUrl : url;
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(token))
            return null;

        try
        {
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(15);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await client.GetAsync($"{url.TrimEnd('/')}/api/states", ct);
            if (!response.IsSuccessStatusCode)
                return null;

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                return null;

            var automation = 0;
            var script = 0;
            var person = 0;
            var mqtt = 0;
            var sensor = 0;
            var total = 0;

            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (!item.TryGetProperty("entity_id", out var idProp))
                    continue;
                var id = idProp.GetString();
                if (string.IsNullOrWhiteSpace(id))
                    continue;

                total++;
                var domain = id.Split('.', 2)[0];
                switch (domain)
                {
                    case "automation": automation++; break;
                    case "script": script++; break;
                    case "person": person++; break;
                    case "mqtt": mqtt++; break;
                    case "sensor": sensor++; break;
                }
            }

            return new HaMonitoringStats(true, automation, script, person, mqtt, sensor, total);
        }
        catch
        {
            return null;
        }
    }

    public async Task<EntityParitySnapshot?> GetEntityParityAsync(CancellationToken ct)
    {
        var (prodUrl, prodToken) = TokenFile.Read(paths.ProdTokenFile);
        var (stagingUrl, stagingToken) = TokenFile.Read(paths.StagingTokenFile);
        if (string.IsNullOrWhiteSpace(prodUrl) || string.IsNullOrWhiteSpace(prodToken)
            || string.IsNullOrWhiteSpace(stagingUrl) || string.IsNullOrWhiteSpace(stagingToken))
        {
            return null;
        }

        var prodIds = await FetchEntityIdsAsync(prodUrl, prodToken, ct);
        var stagingIds = await FetchEntityIdsAsync(stagingUrl, stagingToken, ct);
        if (prodIds is null || stagingIds is null)
            return null;

        var alignmentDomains = new[] { "automation", "script", "person", "mqtt" };
        var displayDomains = new[] { "automation", "script", "person", "mqtt", "sensor" };
        var diffs = new List<EntityDomainParity>();
        var unexpectedProdOnly = new List<string>();
        var unexpectedStagingOnly = new List<string>();
        var expectedStagingOnly = new List<string>();

        foreach (var domain in displayDomains)
        {
            var prodDomain = prodIds.Where(id => id.StartsWith($"{domain}.", StringComparison.Ordinal)).ToHashSet(StringComparer.Ordinal);
            var stagingDomain = stagingIds.Where(id => id.StartsWith($"{domain}.", StringComparison.Ordinal)).ToHashSet(StringComparer.Ordinal);
            var prodOnly = prodDomain.Except(stagingDomain).Order(StringComparer.Ordinal).ToList();
            var stagingOnly = stagingDomain.Except(prodDomain).Order(StringComparer.Ordinal).ToList();
            if (prodOnly.Count == 0 && stagingOnly.Count == 0)
                continue;

            var unexpectedProd = prodOnly.Where(id => !IsExpectedStagingOnly(id)).ToList();
            var unexpectedStaging = stagingOnly.Where(id => !IsExpectedStagingOnly(id)).ToList();
            var expectedStaging = stagingOnly.Where(IsExpectedStagingOnly).ToList();

            if (alignmentDomains.Contains(domain, StringComparer.Ordinal))
            {
                unexpectedProdOnly.AddRange(unexpectedProd);
                unexpectedStagingOnly.AddRange(unexpectedStaging);
            }

            expectedStagingOnly.AddRange(expectedStaging);

            diffs.Add(new EntityDomainParity(
                domain,
                prodOnly.Count,
                stagingOnly.Count,
                unexpectedProd.Count,
                unexpectedStaging.Count,
                prodOnly.Take(12).ToList(),
                stagingOnly.Take(12).ToList()));
        }

        var isAligned = unexpectedProdOnly.Count == 0 && unexpectedStagingOnly.Count == 0;
        return new EntityParitySnapshot(
            true,
            diffs.Count > 0,
            isAligned,
            unexpectedProdOnly.Count,
            unexpectedStagingOnly.Count,
            expectedStagingOnly.Count,
            unexpectedProdOnly.Take(16).ToList(),
            unexpectedStagingOnly.Take(16).ToList(),
            expectedStagingOnly.Take(8).ToList(),
            diffs);
    }

    public StagingRepresentationStatus BuildStagingRepresentation(
        GitSnapshotStatus? git,
        ConfigDriftStatus? drift,
        EntityParitySnapshot? entityParity,
        PresenceSummary? presence)
    {
        var issues = new List<RepresentationIssue>();
        var configMatches = drift is not { HasDrift: true };
        var gitClean = git is not { IsHaDirty: true };
        var entityAligned = entityParity is not { Available: true } || entityParity.IsAligned;
        var presenceMatches = presence is null
            || (presence.ProdPersonCount == presence.StagingPersonCount
                && presence.MatchedCount == presence.ProdPersonCount);

        if (drift is { HasDrift: true })
        {
            issues.Add(new RepresentationIssue(
                "error",
                "config",
                "Config not applied to staging",
                drift.Detail,
                []));
        }

        if (entityParity is { Available: true, IsAligned: false })
        {
            if (entityParity.UnexpectedProdOnlyCount > 0)
            {
                issues.Add(new RepresentationIssue(
                    "error",
                    "entity",
                    "Missing on staging",
                    $"{entityParity.UnexpectedProdOnlyCount} production entity(ies) are not on staging — registry or storage sync may be stale.",
                    entityParity.UnexpectedProdOnlySample));
            }

            if (entityParity.UnexpectedStagingOnlyCount > 0)
            {
                issues.Add(new RepresentationIssue(
                    "warn",
                    "entity",
                    "Extra on staging",
                    $"{entityParity.UnexpectedStagingOnlyCount} entity(ies) exist on staging but not production — review before promoting changes.",
                    entityParity.UnexpectedStagingOnlySample));
            }
        }

        if (!presenceMatches && presence is not null)
        {
            issues.Add(new RepresentationIssue(
                "warn",
                "presence",
                "Person states differ",
                presence.Detail,
                []));
        }

        if (git is { IsHaDirty: true })
        {
            issues.Add(new RepresentationIssue(
                "warn",
                "git-ha",
                "Uncommitted HA YAML",
                $"{git.HaChangedFileCount} Home Assistant config file(s) changed — commit and apply before staging matches git.",
                git.HaChangedSample));
        }

        if (git is { IsRepoDirty: true })
        {
            issues.Add(new RepresentationIssue(
                "info",
                "git-repo",
                "Docs/repo files uncommitted",
                $"{git.RepoChangedFileCount} doc, script, or tooling file(s) changed — does not affect prod vs staging parity until committed.",
                git.RepoChangedSample));
        }

        string verdict;
        string headline;
        string summary;

        if (issues.Any(i => i.Severity == "error"))
        {
            verdict = "drift";
            headline = "Staging does not match production";
            summary = "Fix the items below before trusting staging as a prod stand-in.";
        }
        else if (issues.Any(i => i.Severity == "warn"))
        {
            verdict = "review";
            headline = "Review staging differences";
            summary = "Staging mostly matches production but has changes worth checking before you accept them.";
        }
        else if (git is { IsHaDirty: true })
        {
            verdict = "review";
            headline = "Staging matches production — pending HA YAML commits";
            summary = "Applied staging config matches production today. Uncommitted automations/scripts are not on staging yet.";
        }
        else if (git is { IsRepoDirty: true } && configMatches && entityAligned && presenceMatches)
        {
            verdict = "aligned";
            headline = "Staging matches production";
            summary =
                $"Prod/staging parity is good. {git.RepoChangedFileCount} doc or tooling file(s) uncommitted in git — safe to ignore for HA testing.";
        }
        else if (entityParity is { Available: true, IsAligned: true } && configMatches && presenceMatches)
        {
            verdict = "aligned";
            headline = "Staging matches production";
            if (entityParity.ExpectedStagingOnlyCount > 0)
            {
                summary =
                    $"Config, entity registry, and presence align with production ({entityParity.ExpectedStagingOnlyCount} expected kit entity(ies) on staging only).";
            }
            else
            {
                summary = "Config applied, entity registry aligned, and person states match — safe to use staging as a prod stand-in.";
            }
        }
        else
        {
            verdict = "review";
            headline = "Staging parity unknown";
            summary = "Some parity signals are unavailable — check tokens and HA connectivity.";
        }

        return new StagingRepresentationStatus(
            true,
            verdict,
            headline,
            summary,
            configMatches,
            entityAligned,
            presenceMatches,
            gitClean,
            issues);
    }

    static bool IsExpectedStagingOnly(string entityId)
    {
        var dot = entityId.IndexOf('.');
        if (dot < 0)
            return false;

        var name = entityId[(dot + 1)..];
        return name.StartsWith("staging_", StringComparison.Ordinal)
            || name.Contains("staging_person_sync", StringComparison.Ordinal)
            || name.Contains("staging_disable", StringComparison.Ordinal);
    }

    public MqttBridgeStats? GetMqttBridgeStats(string? mirrorData, bool mirrorRunning)
    {
        if (string.IsNullOrWhiteSpace(mirrorData))
            return null;

        var logPath = Path.Combine(mirrorData, "log", "mosquitto.log");
        if (!File.Exists(logPath))
            return new MqttBridgeStats(true, false, 0, 0, []);

        try
        {
            var lines = File.ReadAllLines(logPath);
            var tail = lines.Length <= 2000 ? lines : lines[^2000..];
            var bridgeConnected = false;
            var clients = new HashSet<string>(StringComparer.Ordinal);
            var recentEvents = 0;
            var buckets = new Dictionary<long, int>();
            var cutoff = DateTimeOffset.UtcNow.AddHours(-1).ToUnixTimeSeconds();

            foreach (var raw in tail)
            {
                var line = raw.Trim();
                if (line.Length == 0)
                    continue;

                if (line.Contains("Connecting bridge", StringComparison.OrdinalIgnoreCase)
                    || line.Contains("Connection Accepted", StringComparison.OrdinalIgnoreCase)
                    || line.Contains("onnection complete", StringComparison.OrdinalIgnoreCase))
                {
                    bridgeConnected = true;
                }

                if (line.Contains("Bridge", StringComparison.OrdinalIgnoreCase)
                    && line.Contains("disconnected", StringComparison.OrdinalIgnoreCase))
                {
                    bridgeConnected = false;
                }

                var clientMatch = MosquittoClientPattern().Match(line);
                if (clientMatch.Success)
                    clients.Add(clientMatch.Groups["client"].Value);

                if (!TryParseMosquittoUnixTimestamp(line, out var ts))
                    continue;

                if (ts < cutoff)
                    continue;

                recentEvents++;
                var bucket = ts - (ts % 300);
                buckets[bucket] = buckets.GetValueOrDefault(bucket) + 1;
            }

            if (mirrorRunning)
                bridgeConnected = true;

            var activity = buckets
                .OrderBy(kv => kv.Key)
                .Select(kv => new MqttActivityBucket(DateTimeOffset.FromUnixTimeSeconds(kv.Key), kv.Value))
                .TakeLast(12)
                .ToList();

            return new MqttBridgeStats(true, bridgeConnected, clients.Count, recentEvents, activity);
        }
        catch
        {
            return null;
        }
    }

    static int CountPattern(string path, string pattern)
    {
        if (!File.Exists(path))
            return 0;

        var count = 0;
        foreach (var line in File.ReadLines(path))
        {
            if (line.Contains(pattern, StringComparison.Ordinal))
                count++;
        }

        return count;
    }

    static int CountRootYamlKeys(string path)
    {
        if (!File.Exists(path))
            return 0;

        var count = 0;
        foreach (var line in File.ReadLines(path))
        {
            if (line.Length == 0 || line.StartsWith('#'))
                continue;
            if (RootYamlKeyPattern().IsMatch(line))
                count++;
        }

        return count;
    }

    static DateTimeOffset? ParseLogTimestamp(string line)
    {
        var match = LogTimestampPattern().Match(line);
        if (!match.Success)
            return null;

        if (DateTimeOffset.TryParseExact(
                match.Groups["at"].Value,
                "yyyy-MM-dd HH:mm:ss",
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal,
                out var parsed))
        {
            return parsed;
        }

        return null;
    }

    static bool TryParseMosquittoUnixTimestamp(string line, out long unixTs)
    {
        unixTs = 0;
        var idx = line.IndexOf(':');
        if (idx <= 0)
            return false;
        return long.TryParse(line[..idx], out unixTs);
    }

    public IReadOnlyList<PollHistoryPoint> ParsePollHistory(string logs)
    {
        var points = new List<PollHistoryPoint>();
        foreach (Match match in PersonSyncLinePattern().Matches(logs))
        {
            if (!DateTimeOffset.TryParseExact(
                    match.Groups["at"].Value,
                    "yyyy-MM-dd HH:mm:ss",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeLocal,
                    out var at))
            {
                continue;
            }

            if (!int.TryParse(match.Groups["count"].Value, out var count))
                continue;

            points.Add(new PollHistoryPoint(at, count, count > 0));
        }

        return points.TakeLast(24).ToList();
    }

    public IReadOnlyList<string> TailSyncLog(string logs, int lines = 12) =>
        logs.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .TakeLast(lines)
            .ToList();

    public async Task<PresenceSummary?> GetPresenceSummaryAsync(CancellationToken ct)
    {
        var (prodUrl, prodToken) = TokenFile.Read(paths.ProdTokenFile);
        var (stagingUrl, stagingToken) = TokenFile.Read(paths.StagingTokenFile);
        if (string.IsNullOrWhiteSpace(prodUrl) || string.IsNullOrWhiteSpace(prodToken)
            || string.IsNullOrWhiteSpace(stagingUrl) || string.IsNullOrWhiteSpace(stagingToken))
        {
            return null;
        }

        var prodStates = await FetchPersonStatesAsync(prodUrl, prodToken, ct);
        var stagingStates = await FetchPersonStatesAsync(stagingUrl, stagingToken, ct);
        if (prodStates is null || stagingStates is null)
            return null;

        var matched = 0;
        foreach (var (entityId, prodState) in prodStates)
        {
            if (stagingStates.TryGetValue(entityId, out var stagingState)
                && string.Equals(prodState, stagingState, StringComparison.OrdinalIgnoreCase))
            {
                matched++;
            }
        }

        var detail = matched == prodStates.Count && prodStates.Count == stagingStates.Count
            ? "All person states match production"
            : $"{matched} of {prodStates.Count} prod persons match staging";

        return new PresenceSummary(prodStates.Count, stagingStates.Count, matched, detail);
    }

    public IReadOnlyList<ReadinessItem> BuildReadiness(
        OnboardingStatus onboarding,
        bool syncRunning,
        GitSnapshotStatus? git)
    {
        var items = new List<ReadinessItem>
        {
            new("onboarding", "Setup complete", onboarding.IsComplete, onboarding.IsComplete ? null : "Resume wizard"),
            new("prod-token", "Prod token", onboarding.Prod.HasToken, null),
            new("staging-token", "Staging token", onboarding.Staging.HasToken, null),
            new("ssh", "Prod SSH", onboarding.Prod.HasSshKey, null),
            new("git", "Git repo mounted", git?.Configured ?? onboarding.GitConfigured, null),
            new("sync", "Sync loop", syncRunning, syncRunning ? null : "See sync log"),
        };

        if (onboarding.Mirror.Enabled)
        {
            items.Add(new ReadinessItem(
                "mirror",
                "MQTT mirror",
                onboarding.MirrorConfigured,
                onboarding.MirrorConfigured ? null : "Deploy mirror"));
        }

        return items;
    }

    public SuggestedAction? BuildSuggestedAction(
        IReadOnlyList<ComponentIssue> issues,
        IReadOnlyList<SubsystemStatus> subsystems,
        ConfigDriftStatus? drift,
        MirrorRuntimeStatus? mirror,
        IReadOnlyList<ReadinessItem> readiness,
        SyncActivitySnapshot? activity)
    {
        if (mirror is { Configured: true } && string.Equals(mirror.Mode, "control", StringComparison.OrdinalIgnoreCase))
        {
            return new SuggestedAction(
                "Turn off MQTT control mode",
                "Real Zigbee hardware can actuate from staging while control mode is on — switch back to read-only when you are done testing.",
                "/operations",
                "Open Operations",
                "critical",
                "mirror-readonly");
        }

        if (mirror is { Configured: true, Running: false })
        {
            return new SuggestedAction(
                "Start the MQTT mirror broker",
                "Mirror config exists but Mosquitto is not running — staging device states will stay stale until the broker is up.",
                "/operations",
                "Deploy mirror",
                "warning",
                "refresh-mirror");
        }

        var notReady = readiness.FirstOrDefault(r => !r.Ok);
        if (notReady?.Id == "onboarding")
        {
            return new SuggestedAction(
                "Finish the setup wizard",
                notReady.Detail ?? "Complete first-run setup before relying on staging sync and mirror features.",
                "/onboarding",
                "Resume wizard",
                "warning");
        }

        foreach (var issue in issues.Where(i => i.Level == "error"))
        {
            var msg = issue.Message;
            if (msg.Contains("conf.d", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("include_dir", StringComparison.OrdinalIgnoreCase))
            {
                return new SuggestedAction(
                    "Redeploy the MQTT mirror",
                    "Mosquitto cannot read its config — redeploy to regenerate bridge files and restart the broker.",
                    "/operations",
                    "Deploy mirror",
                    "critical",
                    "refresh-mirror");
            }

            if (msg.Contains("Sync loop not running", StringComparison.OrdinalIgnoreCase))
            {
                return new SuggestedAction(
                    "Restart the kit sync loop",
                    "Background config sync and person polling are stopped — check sync.log or restart the ha-staging-kit container.",
                    "/operations",
                    "Open Operations",
                    "critical");
            }
        }

        if (drift is { HasDrift: true })
        {
            return new SuggestedAction(
                "Apply git config to staging",
                $"{drift.Detail} Run apply to rsync the latest staging branch YAML into staging HA.",
                "/operations",
                "Apply config",
                "warning",
                "apply-config");
        }

        if (activity?.LastStorageSyncAt is null && mirror is { Configured: true })
        {
            return new SuggestedAction(
                "Run a storage sync",
                "No prod .storage sync logged yet — entity registry, MQTT creds, and helpers may be missing on staging.",
                "/operations",
                "Run storage sync",
                "warning",
                "storage-sync");
        }

        var staging = subsystems.FirstOrDefault(s => s.Name == "Staging HA");
        if (staging?.Status is "fail")
        {
            return new SuggestedAction(
                "Fix staging HA connection",
                staging.Detail,
                "/settings",
                "Staging settings",
                "critical");
        }

        var prod = subsystems.FirstOrDefault(s => s.Name == "Production HA");
        if (prod?.Status is "fail")
        {
            return new SuggestedAction(
                "Fix production HA connection",
                prod.Detail,
                "/settings",
                "Production settings",
                "critical");
        }

        foreach (var issue in issues.Where(i => i.Level == "warn"))
        {
            if (issue.Message.Contains("git fetch", StringComparison.OrdinalIgnoreCase)
                || issue.Message.Contains("git pull", StringComparison.OrdinalIgnoreCase))
            {
                return new SuggestedAction(
                    "Check the git repo mount",
                    "The kit could not fetch the latest staging branch — verify HA config repo path in Settings.",
                    "/settings",
                    "Paths & git",
                    "warning");
            }
        }

        if (notReady is not null)
        {
            return new SuggestedAction(
                $"Complete setup: {notReady.Label}",
                notReady.Detail ?? "Finish configuration before relying on staging sync.",
                "/settings",
                "Open Settings",
                "info");
        }

        if (staging?.Status == "warn")
        {
            return new SuggestedAction(
                "Review staging HA status",
                staging.Detail,
                "/settings",
                "Staging settings",
                "info");
        }

        if (issues.Count > 0)
        {
            return new SuggestedAction(
                "Review active warnings",
                $"{issues.Count} component warning(s) in the log tail — open Diagnostics for details.",
                "/diagnostics",
                "Open Operations",
                "info");
        }

        return null;
    }

    public async Task<SubsystemStatus> CheckHaAsync(string name, string url, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(url))
            return new SubsystemStatus(name, "warn", "URL not configured");

        try
        {
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(10);
            var response = await client.GetAsync($"{url.TrimEnd('/')}/", ct);
            return response.IsSuccessStatusCode
                ? new SubsystemStatus(name, "pass", $"HTTP {(int)response.StatusCode}")
                : new SubsystemStatus(name, "warn", $"HTTP {(int)response.StatusCode}");
        }
        catch (Exception ex)
        {
            return new SubsystemStatus(name, "fail", ex.Message);
        }
    }

    async Task<HashSet<string>?> FetchEntityIdsAsync(string url, string token, CancellationToken ct)
    {
        try
        {
            var client = httpClientFactory.CreateClient();
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

    async Task<Dictionary<string, string>?> FetchPersonStatesAsync(string url, string token, CancellationToken ct)
    {
        try
        {
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(15);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await client.GetAsync($"{url.TrimEnd('/')}/api/states", ct);
            if (!response.IsSuccessStatusCode)
                return null;

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                return null;

            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (!item.TryGetProperty("entity_id", out var idProp))
                    continue;
                var id = idProp.GetString();
                if (string.IsNullOrWhiteSpace(id) || !id.StartsWith("person.", StringComparison.Ordinal))
                    continue;
                var state = item.TryGetProperty("state", out var stateProp) ? stateProp.GetString() ?? "" : "";
                map[id] = state;
            }

            return map;
        }
        catch
        {
            return null;
        }
    }

    public async Task<HaProbeResult> ProbeHaReachabilityAsync(string? url, string tokenFile, CancellationToken ct)
    {
        var (resolvedUrl, token) = TokenFile.Read(tokenFile);
        url = string.IsNullOrWhiteSpace(url) ? resolvedUrl : url;
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(token))
            return new HaProbeResult(false, false, null);

        try
        {
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(12);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            var sw = Stopwatch.StartNew();
            using var response = await client.GetAsync($"{url.TrimEnd('/')}/api/", ct);
            sw.Stop();
            return new HaProbeResult(true, response.IsSuccessStatusCode, (int)sw.ElapsedMilliseconds);
        }
        catch
        {
            return new HaProbeResult(true, false, null);
        }
    }

    public BridgeUptimeSnapshot? GetBridgeUptime(string? mirrorData, bool mirrorRunning, bool currentConnected)
    {
        if (string.IsNullOrWhiteSpace(mirrorData))
            return null;

        var logPath = Path.Combine(mirrorData, "log", "mosquitto.log");
        if (!File.Exists(logPath))
        {
            return new BridgeUptimeSnapshot(
                true,
                mirrorRunning && currentConnected,
                [],
                []);
        }

        try
        {
            var lines = File.ReadAllLines(logPath);
            var tail = lines.Length <= 3000 ? lines : lines[^3000..];
            var cutoff = DateTimeOffset.UtcNow.AddHours(-1).ToUnixTimeSeconds();
            var events = new List<(long Ts, bool Connected)>();

            foreach (var raw in tail)
            {
                var line = raw.Trim();
                if (line.Length == 0 || !TryParseMosquittoUnixTimestamp(line, out var ts))
                    continue;

                if (line.Contains("Connecting bridge", StringComparison.OrdinalIgnoreCase)
                    || line.Contains("Connection Accepted", StringComparison.OrdinalIgnoreCase)
                    || line.Contains("onnection complete", StringComparison.OrdinalIgnoreCase))
                {
                    events.Add((ts, true));
                }
                else if (line.Contains("Bridge", StringComparison.OrdinalIgnoreCase)
                    && line.Contains("disconnected", StringComparison.OrdinalIgnoreCase))
                {
                    events.Add((ts, false));
                }
            }

            events.Sort((a, b) => a.Ts.CompareTo(b.Ts));

            var initial = mirrorRunning && currentConnected;
            foreach (var evt in events)
            {
                if (evt.Ts < cutoff)
                    initial = evt.Connected;
            }

            var buckets = new List<BridgeUptimeBucket>();
            var state = initial;
            var eventIdx = 0;
            for (var i = 0; i < 12; i++)
            {
                var bucketEnd = cutoff + ((i + 1) * 300);
                while (eventIdx < events.Count && events[eventIdx].Ts <= bucketEnd)
                {
                    state = events[eventIdx].Connected;
                    eventIdx++;
                }

                buckets.Add(new BridgeUptimeBucket(
                    DateTimeOffset.FromUnixTimeSeconds(bucketEnd - 300),
                    state));
            }

            var connected = mirrorRunning && (events.Count == 0 ? currentConnected : events[^1].Connected);
            return new BridgeUptimeSnapshot(true, connected, buckets, []);
        }
        catch
        {
            return null;
        }
    }

    public async Task<AutomationActivitySnapshot?> GetAutomationActivityAsync(
        string? prodUrl,
        string? stagingUrl,
        CancellationToken ct)
    {
        var prodTask = FetchAutomationRunsAsync(prodUrl, paths.ProdTokenFile, ct);
        var stagingTask = FetchAutomationRunsAsync(stagingUrl, paths.StagingTokenFile, ct);
        await Task.WhenAll(prodTask, stagingTask);

        var prod = prodTask.Result;
        var staging = stagingTask.Result;
        if (prod is null && staging is null)
            return null;

        return new AutomationActivitySnapshot(
            prod is not null || staging is not null,
            prod?.Total ?? 0,
            staging?.Total ?? 0,
            prod?.Buckets ?? [],
            staging?.Buckets ?? []);
    }

    async Task<AutomationRunStats?> FetchAutomationRunsAsync(string? url, string tokenFile, CancellationToken ct)
    {
        var (resolvedUrl, token) = TokenFile.Read(tokenFile);
        url = string.IsNullOrWhiteSpace(url) ? resolvedUrl : url;
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(token))
            return null;

        try
        {
            var start = DateTimeOffset.Now.AddHours(-1);
            var stamp = Uri.EscapeDataString(start.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture));
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(20);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await client.GetAsync($"{url.TrimEnd('/')}/api/logbook/{stamp}", ct);
            if (!response.IsSuccessStatusCode)
                return null;

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                return null;

            var times = new List<DateTimeOffset>();
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (!item.TryGetProperty("entity_id", out var idProp))
                    continue;
                var entityId = idProp.GetString();
                if (string.IsNullOrWhiteSpace(entityId) || !entityId.StartsWith("automation.", StringComparison.Ordinal))
                    continue;

                if (!item.TryGetProperty("when", out var whenProp))
                    continue;

                if (DateTimeOffset.TryParse(whenProp.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var when))
                    times.Add(when);
            }

            return new AutomationRunStats(times.Count, BuildTimeBuckets(times));
        }
        catch
        {
            return null;
        }
    }

    static IReadOnlyList<AutomationActivityBucket> BuildTimeBuckets(IReadOnlyList<DateTimeOffset> times)
    {
        var cutoff = DateTimeOffset.UtcNow.AddHours(-1).ToUnixTimeSeconds();
        var buckets = new Dictionary<long, int>();
        for (var i = 0; i < 12; i++)
        {
            var bucket = cutoff + (i * 300);
            buckets[bucket] = 0;
        }

        foreach (var when in times)
        {
            var ts = when.ToUnixTimeSeconds();
            if (ts < cutoff)
                continue;

            var bucket = ts - (ts % 300);
            if (!buckets.ContainsKey(bucket))
                buckets[bucket] = 0;
            buckets[bucket]++;
        }

        return buckets
            .OrderBy(kv => kv.Key)
            .Select(kv => new AutomationActivityBucket(DateTimeOffset.FromUnixTimeSeconds(kv.Key), kv.Value))
            .TakeLast(12)
            .ToList();
    }

    sealed record AutomationRunStats(int Total, IReadOnlyList<AutomationActivityBucket> Buckets);

    async Task<string> RunGitAsync(string workDir, params string[] args)
    {
        var (_, stdout, _) = await RunGitCommandAsync(workDir, CancellationToken.None, args);
        return stdout;
    }

    async Task<(bool Ok, string Stdout, string Stderr)> RunGitCommandAsync(
        string workDir,
        CancellationToken ct,
        params string[] args)
    {
        var psi = new ProcessStartInfo("git")
        {
            WorkingDirectory = workDir,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var arg in args)
            psi.ArgumentList.Add(arg);

        ConfigureGitSsh(psi);

        using var process = Process.Start(psi);
        if (process is null)
            return (false, "", "Failed to start git");

        var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = process.StandardError.ReadToEndAsync(ct);
        await process.WaitForExitAsync(ct);
        var stdout = (await stdoutTask).Trim();
        var stderr = (await stderrTask).Trim();
        return (process.ExitCode == 0, stdout, stderr);
    }

    void ConfigureGitSsh(ProcessStartInfo psi)
    {
        if (!File.Exists(paths.SshKeyFile))
            return;

        var knownHosts = Path.Combine(paths.SecretsDir, "known_hosts");
        EnsureGitHubKnownHosts(knownHosts);
        var sshCommand =
            $"ssh -i {ShellQuote(paths.SshKeyFile)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile={ShellQuote(knownHosts)}";
        psi.Environment["GIT_SSH_COMMAND"] = sshCommand;
        psi.Environment["GIT_SSH"] = sshCommand;
    }

    static void EnsureGitHubKnownHosts(string knownHostsPath)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(knownHostsPath)!);
            if (File.Exists(knownHostsPath))
            {
                var existing = File.ReadAllText(knownHostsPath);
                if (existing.Contains("github.com", StringComparison.OrdinalIgnoreCase))
                    return;
            }

            var psi = new ProcessStartInfo("ssh-keyscan")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };
            psi.ArgumentList.Add("-t");
            psi.ArgumentList.Add("ed25519");
            psi.ArgumentList.Add("github.com");
            using var process = Process.Start(psi);
            if (process is null)
                return;

            var output = process.StandardOutput.ReadToEnd().Trim();
            process.WaitForExit();
            if (process.ExitCode != 0 || string.IsNullOrWhiteSpace(output))
                return;

            File.AppendAllText(knownHostsPath, output + Environment.NewLine);
        }
        catch
        {
            // Push will surface SSH errors if known_hosts cannot be prepared.
        }
    }

    static string ShellQuote(string value) => "'" + value.Replace("'", "'\\''") + "'";

    static string FormatRelative(DateTimeOffset at)
    {
        var delta = DateTimeOffset.Now - at;
        if (delta.TotalSeconds < 60)
            return "just now";
        if (delta.TotalMinutes < 60)
            return $"{(int)delta.TotalMinutes}m ago";
        if (delta.TotalHours < 48)
            return $"{(int)delta.TotalHours}h ago";
        return $"{(int)delta.TotalDays}d ago";
    }

    [GeneratedRegex(@"\[(?<at>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\].*Synced (?<count>\d+) person/tracker", RegexOptions.IgnoreCase)]
    private static partial Regex PersonSyncLinePattern();

    [GeneratedRegex(@"\[(?<at>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]")]
    private static partial Regex LogTimestampPattern();

    [GeneratedRegex("Apply complete", RegexOptions.IgnoreCase)]
    private static partial Regex ApplyCompletePattern();

    [GeneratedRegex("Recorded applied commit (?<commit>[0-9a-f]+)", RegexOptions.IgnoreCase)]
    private static partial Regex RecordedCommitPattern();

    [GeneratedRegex("Storage sync complete", RegexOptions.IgnoreCase)]
    private static partial Regex StorageCompletePattern();

    [GeneratedRegex(@"^[\w][\w0-9_]*:\s*$")]
    private static partial Regex RootYamlKeyPattern();

    [GeneratedRegex(@"New client connected from .* as (?<client>[^\s]+)", RegexOptions.IgnoreCase)]
    private static partial Regex MosquittoClientPattern();
}
