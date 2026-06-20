using System.Text.RegularExpressions;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

/// <summary>
/// Detects prod entity ids with numeric suffixes (_2, _3) that usually mean a stale duplicate
/// was not removed or a second platform (cast) was not given a descriptive _cast name.
/// </summary>
static partial class ProdEntityNamingAnalysis
{
    [GeneratedRegex(@"\b[a-z_][a-z0-9_]*\.[a-z0-9_]+\b", RegexOptions.IgnoreCase)]
    private static partial Regex GitEntityRefRegex();

    public static HashSet<string> CollectGitEntityReferences(
        IEnumerable<string> lovelaceEntityIds,
        string repoRoot = "/repo")
    {
        var refs = lovelaceEntityIds.ToHashSet(StringComparer.Ordinal);
        foreach (var yaml in new[] { "scripts.yaml", "automations.yaml" })
        {
            var path = Path.Combine(repoRoot, yaml);
            if (!File.Exists(path))
                continue;

            foreach (Match match in GitEntityRefRegex().Matches(File.ReadAllText(path)))
            {
                refs.Add(match.Value);
            }
        }

        return refs;
    }

    public static IReadOnlyList<ProdEntityNamingIssue> BuildIssues(
        ProdRegistrySnapshot registry,
        IReadOnlySet<string> prodLiveIds,
        IReadOnlySet<string> gitEntityRefs)
    {
        var issues = new List<ProdEntityNamingIssue>();
        var reportedCastRenames = new HashSet<string>(StringComparer.Ordinal);

        foreach (var (entityId, live) in registry.ActiveEntities)
        {
            if (!TryParseNumericSuffix(entityId, out var baseId, out var suffixNum) || suffixNum != 2)
                continue;

            if (!registry.ActiveEntities.TryGetValue(baseId, out var blocker))
                continue;

            if (!IsSafeSuffixCollision(blocker, live, prodLiveIds))
                continue;

            issues.Add(BuildSuffixCollisionIssue(baseId, entityId, blocker, live, registry, gitEntityRefs));
        }

        foreach (var (entityId, entry) in registry.ActiveEntities)
        {
            if (!string.Equals(entry.Platform, "cast", StringComparison.OrdinalIgnoreCase))
                continue;

            if (!TryParseNumericSuffix(entityId, out var baseId, out var suffixNum) || suffixNum < 2)
                continue;

            var castTarget = $"{Domain(baseId)}.{ObjectId(baseId)}_cast";
            if (registry.ActiveEntities.ContainsKey(castTarget))
                continue;

            if (reportedCastRenames.Contains(castTarget))
                continue;

            if (!IsCastSiblingOfPrimary(baseId, entry, registry))
                continue;

            issues.Add(BuildCastSuffixIssue(entityId, castTarget, entry, registry, gitEntityRefs));
            reportedCastRenames.Add(castTarget);
        }

        return issues
            .OrderBy(i => i.PrimaryEntityId, StringComparer.Ordinal)
            .ToList();
    }

    static ProdEntityNamingIssue BuildSuffixCollisionIssue(
        string expectedEntityId,
        string suffixEntityId,
        ProdEntityRegistryEntry blocker,
        ProdEntityRegistryEntry live,
        ProdRegistrySnapshot registry,
        IReadOnlySet<string> gitEntityRefs)
    {
        var blockerLabel = FormatEntityLabel(blocker);
        var liveLabel = FormatEntityLabel(live, suffixEntityId);
        var deviceName = DeviceName(live, registry);
        var gitRefs = FindGitReferences(expectedEntityId, suffixEntityId, blocker.EntityId, gitEntityRefs);

        var summary =
            $"`{suffixEntityId}` is the live entity but `{expectedEntityId}` is still registered as {blockerLabel}. "
            + "Numeric `_2` suffixes usually mean the base name was not freed.";

        var manualFix =
            $"Proper fix: delete {blockerLabel}, rename {liveLabel} → `{expectedEntityId}`. "
            + (gitRefs.Count > 0
                ? $"Update {gitRefs.Count} git reference(s) still using `{suffixEntityId}` after the prod rename."
                : "No git references to the `_2` id — prod registry fix only.");

        var steps = new List<string>
        {
            "Click **Fix entity id on prod** below (stops prod HA briefly, removes the blocker, renames the live entity, restarts).",
            $"Or manually: delete {blockerLabel} in Settings → Entities.",
            $"Then rename {liveLabel} → `{expectedEntityId}` on prod.",
        };

        if (gitRefs.Count > 0)
        {
            steps.Add($"Search git for `{suffixEntityId}` and update to `{expectedEntityId}` (scripts, automations, dashboard).");
        }

        steps.Add("Click Recheck when finished.");

        return new ProdEntityNamingIssue(
            expectedEntityId,
            "suffix_collision",
            summary,
            manualFix,
            expectedEntityId,
            suffixEntityId,
            blocker.EntityId,
            blocker.Platform,
            blocker.DisabledBy,
            live.Platform,
            deviceName,
            steps,
            "suffix-collision",
            gitRefs);
    }

    static ProdEntityNamingIssue BuildCastSuffixIssue(
        string wrongEntityId,
        string expectedEntityId,
        ProdEntityRegistryEntry castEntry,
        ProdRegistrySnapshot registry,
        IReadOnlySet<string> gitEntityRefs)
    {
        var deviceName = DeviceName(castEntry, registry);
        var gitRefs = FindGitReferences(expectedEntityId, wrongEntityId, null, gitEntityRefs);
        var suffix = ObjectId(wrongEntityId).Split('_').LastOrDefault() ?? "?";

        var summary =
            $"`{wrongEntityId}` is a cast entity for the same device as `{ObjectId(expectedEntityId).Replace("_cast", "", StringComparison.Ordinal)}`. "
            + $"Use `{expectedEntityId}` instead of a numeric `_{suffix}` suffix (see `zaphod_shield_cast` as the pattern).";

        var manualFix =
            $"Rename {FormatEntityLabel(castEntry, wrongEntityId)} → `{expectedEntityId}` on prod. "
            + "This is a second platform for the same physical device, not a third separate player.";

        var steps = new List<string>
        {
            "Click **Fix entity id on prod** below (stops prod HA briefly, renames in core.entity_registry, restarts).",
            $"Or manually rename `{wrongEntityId}` → `{expectedEntityId}` in Settings → Entities on prod.",
        };

        if (gitRefs.Count > 0)
        {
            steps.Add($"Update git references from `{wrongEntityId}` to `{expectedEntityId}`.");
        }

        steps.Add("Click Recheck when finished.");

        return new ProdEntityNamingIssue(
            wrongEntityId,
            "cast_numeric_suffix",
            summary,
            manualFix,
            expectedEntityId,
            wrongEntityId,
            null,
            null,
            null,
            castEntry.Platform,
            deviceName,
            steps,
            "registry-rename",
            gitRefs);
    }

    static bool IsSafeSuffixCollision(
        ProdEntityRegistryEntry blocker,
        ProdEntityRegistryEntry live,
        IReadOnlySet<string> prodLiveIds)
    {
        if (string.Equals(blocker.EntityId, live.EntityId, StringComparison.Ordinal))
            return false;

        var platformsDiffer = !string.Equals(blocker.Platform, live.Platform, StringComparison.OrdinalIgnoreCase);
        var blockerDisabled = !string.IsNullOrWhiteSpace(blocker.DisabledBy);
        var blockerStaleCast = string.Equals(blocker.Platform, "cast", StringComparison.OrdinalIgnoreCase)
            && !prodLiveIds.Contains(blocker.EntityId);

        return platformsDiffer || blockerDisabled || blockerStaleCast;
    }

    static bool IsCastSiblingOfPrimary(
        string baseEntityId,
        ProdEntityRegistryEntry castEntry,
        ProdRegistrySnapshot registry)
    {
        var castDeviceName = DeviceName(castEntry, registry);
        if (string.IsNullOrWhiteSpace(castDeviceName))
            return false;

        var domain = Domain(baseEntityId);
        var baseObject = ObjectId(baseEntityId);

        foreach (var (entityId, entry) in registry.ActiveEntities)
        {
            if (!entityId.StartsWith($"{domain}.", StringComparison.Ordinal))
                continue;

            if (string.Equals(entry.Platform, "cast", StringComparison.OrdinalIgnoreCase))
                continue;

            var obj = ObjectId(entityId);
            if (!obj.StartsWith(baseObject, StringComparison.OrdinalIgnoreCase))
                continue;

            if (!IsPrimaryPlatform(entry.Platform))
                continue;

            var primaryName = DeviceName(entry, registry);
            if (string.Equals(primaryName, castDeviceName, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    static bool IsPrimaryPlatform(string? platform) =>
        platform is "androidtv_remote" or "smartthings" or "androidtv";

    static IReadOnlyList<string> FindGitReferences(
        string expectedEntityId,
        string wrongEntityId,
        string? blockerEntityId,
        IReadOnlySet<string> gitEntityRefs)
    {
        var hits = new HashSet<string>(StringComparer.Ordinal);
        foreach (var id in new[] { expectedEntityId, wrongEntityId, blockerEntityId })
        {
            if (string.IsNullOrWhiteSpace(id))
                continue;

            if (gitEntityRefs.Contains(id))
                hits.Add(id);
        }

        return hits.Order(StringComparer.Ordinal).ToList();
    }

    static string? DeviceName(ProdEntityRegistryEntry entry, ProdRegistrySnapshot registry)
    {
        if (entry.DeviceId is null)
            return null;

        return registry.DeviceNames.TryGetValue(entry.DeviceId, out var name) ? name : null;
    }

    static string FormatEntityLabel(ProdEntityRegistryEntry entry, string? entityId = null)
    {
        var id = entityId ?? entry.EntityId;
        if (string.IsNullOrWhiteSpace(entry.Platform))
            return $"`{id}`";

        return string.IsNullOrWhiteSpace(entry.DisabledBy)
            ? $"`{id}` ({entry.Platform})"
            : $"`{id}` ({entry.Platform}, {entry.DisabledBy})";
    }

    static bool TryParseNumericSuffix(string entityId, out string baseEntityId, out int suffixNum)
    {
        baseEntityId = "";
        suffixNum = 0;

        var dot = entityId.IndexOf('.');
        if (dot <= 0)
            return false;

        var domain = entityId[..dot];
        var objectId = entityId[(dot + 1)..];
        var lastUnderscore = objectId.LastIndexOf('_');
        if (lastUnderscore <= 0 || lastUnderscore >= objectId.Length - 1)
            return false;

        var suffixPart = objectId[(lastUnderscore + 1)..];
        if (!int.TryParse(suffixPart, out suffixNum) || suffixNum < 2)
            return false;

        var baseObject = objectId[..lastUnderscore];
        if (string.IsNullOrWhiteSpace(baseObject))
            return false;

        baseEntityId = $"{domain}.{baseObject}";
        return true;
    }

    static string Domain(string entityId)
    {
        var dot = entityId.IndexOf('.');
        return dot > 0 ? entityId[..dot] : entityId;
    }

    static string ObjectId(string entityId)
    {
        var dot = entityId.IndexOf('.');
        return dot > 0 ? entityId[(dot + 1)..] : entityId;
    }
}
