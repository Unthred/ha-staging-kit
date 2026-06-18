using System.Text.RegularExpressions;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

static class Zigbee2MqttStaleConfigAnalysis
{
    public static IReadOnlyList<Z2mStaleConfigIssue> DetectIssues(
        Zigbee2MqttProdSnapshot? snapshot,
        IReadOnlyDictionary<string, ProdEntityRegistryEntry>? activeEntities)
    {
        if (snapshot is null || snapshot.ConfigByIeee.Count == 0)
            return [];

        var issues = new List<Z2mStaleConfigIssue>();
        var staleEntries = snapshot.ConfigByIeee.Values
            .Where(d => !snapshot.LiveIpees.Contains(d.Ieee))
            .ToList();

        foreach (var group in snapshot.ConfigByIeee.Values
                     .Where(d => snapshot.LiveIpees.Contains(d.Ieee))
                     .GroupBy(d => NormalizeFriendlyName(d.FriendlyName), StringComparer.OrdinalIgnoreCase)
                     .Where(g => g.Count() > 1))
        {
            issues.Add(BuildDuplicateLiveNameIssue(group.Key, group.ToList(), staleEntries));
        }

        foreach (var live in snapshot.ConfigByIeee.Values.Where(d => snapshot.LiveIpees.Contains(d.Ieee)))
        {
            var expectedNames = InferExpectedFriendlyNames(live, activeEntities);
            foreach (var expected in expectedNames)
            {
                var staleBlocking = staleEntries
                    .Where(s => string.Equals(
                        NormalizeFriendlyName(s.FriendlyName),
                        NormalizeFriendlyName(expected),
                        StringComparison.OrdinalIgnoreCase))
                    .ToList();
                if (staleBlocking.Count == 0)
                    continue;

                if (string.Equals(
                        NormalizeFriendlyName(live.FriendlyName),
                        NormalizeFriendlyName(expected),
                        StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                issues.Add(new Z2mStaleConfigIssue(
                    expected,
                    live.Ieee,
                    live.FriendlyName,
                    staleBlocking.Select(s => new Z2mStaleConfigEntry(
                        s.Ieee,
                        s.FriendlyName,
                        false)).ToList(),
                    BuildSummary(expected, live, staleBlocking),
                    BuildFixOptions()));
            }
        }

        return ApplyGitFixStatus(
                issues
                    .GroupBy(i => $"{i.LiveIeee}|{i.ExpectedFriendlyName}", StringComparer.OrdinalIgnoreCase)
                    .Select(g => g.First())
                    .OrderBy(i => i.ExpectedFriendlyName, StringComparer.Ordinal)
                    .ToList(),
                null)
            .ToList();
    }

    public static IReadOnlyList<Z2mStaleConfigIssue> ApplyGitFixStatus(
        IReadOnlyList<Z2mStaleConfigIssue> prodIssues,
        IReadOnlyDictionary<string, Zigbee2MqttDeviceConfig>? gitConfigByIeee)
    {
        if (gitConfigByIeee is null || gitConfigByIeee.Count == 0)
            return prodIssues;

        return prodIssues
            .Select(issue =>
            {
                if (!GitContainsFix(issue, gitConfigByIeee))
                    return issue;

                return issue with
                {
                    BlocksDeploy = false,
                    Summary =
                        $"Fix is in git for `{issue.LiveIeee}` → “{issue.ExpectedFriendlyName}”. " +
                        "Deploy to prod, restart Zigbee2MQTT, then Recheck.",
                    FixOptions = [],
                };
            })
            .ToList();
    }

    static bool GitContainsFix(
        Z2mStaleConfigIssue issue,
        IReadOnlyDictionary<string, Zigbee2MqttDeviceConfig> gitConfigByIeee)
    {
        if (!gitConfigByIeee.TryGetValue(issue.LiveIeee, out var liveGit))
            return false;

        if (!string.Equals(
                NormalizeFriendlyName(liveGit.FriendlyName),
                NormalizeFriendlyName(issue.ExpectedFriendlyName),
                StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return issue.StaleEntries.All(stale => !gitConfigByIeee.ContainsKey(stale.Ieee));
    }

    static Z2mStaleConfigIssue BuildDuplicateLiveNameIssue(
        string friendlyName,
        IReadOnlyList<Zigbee2MqttDeviceConfig> liveDevices,
        IReadOnlyList<Zigbee2MqttDeviceConfig> staleEntries)
    {
        var first = liveDevices[0];
        return new Z2mStaleConfigIssue(
            friendlyName,
            first.Ieee,
            first.FriendlyName,
            staleEntries
                .Where(s => string.Equals(
                    NormalizeFriendlyName(s.FriendlyName),
                    friendlyName,
                    StringComparison.OrdinalIgnoreCase))
                .Select(s => new Z2mStaleConfigEntry(s.Ieee, s.FriendlyName, false))
                .ToList(),
            $"Zigbee2MQTT has {liveDevices.Count} live devices named “{friendlyName}”. Resolve naming in git before deploy.",
            BuildFixOptions());
    }

    static string BuildSummary(
        string expectedFriendlyName,
        Zigbee2MqttDeviceConfig live,
        IReadOnlyList<Zigbee2MqttDeviceConfig> staleBlocking)
    {
        var staleList = string.Join(
            ", ",
            staleBlocking.Select(s => $"`{s.Ieee}`"));
        return
            $"Live sensor `{live.Ieee}` is “{live.FriendlyName}” but git/HA expect “{expectedFriendlyName}”. " +
            $"Stale Z2M config ({staleList}) still reserves that friendly name — fix in git, deploy, then restart Z2M.";
    }

    static IReadOnlyList<LovelaceFixOption> BuildFixOptions() =>
    [
        new LovelaceFixOption(
            "fix-z2m-git",
            "Fix in git (Z2M config)",
            "fix-z2m-config",
            null,
            "Remove stale ieee block(s) and set the live device friendly name in zigbee2mqtt/configuration.yaml. Commit → deploy → restart Z2M."),
    ];

    static IEnumerable<string> InferExpectedFriendlyNames(
        Zigbee2MqttDeviceConfig live,
        IReadOnlyDictionary<string, ProdEntityRegistryEntry>? activeEntities)
    {
        if (activeEntities is null)
            yield break;

        var prefix = live.Ieee + "_";
        var related = activeEntities.Values
            .Where(e => e.UniqueId?.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) == true
                        || e.UniqueId?.Contains(live.Ieee, StringComparison.OrdinalIgnoreCase) == true)
            .Select(e => e.EntityId)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        foreach (var entityId in related)
        {
            var inferred = InferFriendlyNameFromEntityId(entityId, live.FriendlyName);
            if (!string.IsNullOrWhiteSpace(inferred))
                yield return inferred;
        }

        if (related.Count == 0 && live.FriendlyName.Contains("Tbree", StringComparison.OrdinalIgnoreCase))
            yield return Regex.Replace(live.FriendlyName, "Tbree", "Three", RegexOptions.IgnoreCase);
    }

    static string? InferFriendlyNameFromEntityId(string entityId, string currentFriendlyName)
    {
        var dot = entityId.IndexOf('.');
        var objectId = dot > 0 ? entityId[(dot + 1)..] : entityId;
        if (!objectId.Contains("three", StringComparison.OrdinalIgnoreCase))
            return null;

        if (currentFriendlyName.Contains("Tbree", StringComparison.OrdinalIgnoreCase))
            return Regex.Replace(currentFriendlyName, "Tbree", "Three", RegexOptions.IgnoreCase);

        var parts = objectId.Split('_');
        if (parts.Length < 2)
            return null;

        var words = parts
            .Take(parts.Length - 1)
            .Select(static w => char.ToUpperInvariant(w[0]) + w[1..]);
        return string.Join(' ', words);
    }

    static string NormalizeFriendlyName(string name) => name.Trim();
}
