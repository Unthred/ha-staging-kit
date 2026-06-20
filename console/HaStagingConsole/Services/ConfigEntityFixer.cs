namespace HaStagingConsole.Services;

static class ConfigEntityFixer
{
    public static readonly string[] ConfigSearchPaths =
    [
        "scripts.yaml",
        "automations.yaml",
        ..ProdStorageDeployService.LovelaceBundlePaths,
    ];

    public static IReadOnlyList<string> FindPathsContaining(string repoRoot, string entityId)
    {
        if (string.IsNullOrWhiteSpace(entityId))
            return [];

        var hits = new List<string>();
        foreach (var relativePath in ConfigSearchPaths)
        {
            var diskPath = Path.Combine(repoRoot, relativePath);
            if (!File.Exists(diskPath))
                continue;

            if (File.ReadAllText(diskPath).Contains(entityId, StringComparison.Ordinal))
                hits.Add(relativePath);
        }

        return hits;
    }

    public static LovelaceFixApplyResult ApplyReplaceInPaths(
        string repoRoot,
        string fromEntityId,
        string toEntityId,
        IEnumerable<string> relativePaths)
    {
        if (!LovelaceEntityFixer.IsEntityIdPublic(fromEntityId))
            throw new ArgumentException($"Invalid entity id: {fromEntityId}");
        if (!LovelaceEntityFixer.IsEntityIdPublic(toEntityId))
            throw new ArgumentException($"Invalid replacement entity id: {toEntityId}");

        var modified = new List<string>();
        var changeCount = 0;

        foreach (var relativePath in relativePaths.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var diskPath = Path.Combine(repoRoot, relativePath);
            if (!File.Exists(diskPath))
                continue;

            var text = File.ReadAllText(diskPath);
            var fileChanges = CountOccurrences(text, fromEntityId);
            if (fileChanges <= 0)
                continue;

            File.WriteAllText(diskPath, text.Replace(fromEntityId, toEntityId, StringComparison.Ordinal));
            modified.Add(relativePath);
            changeCount += fileChanges;
        }

        return new LovelaceFixApplyResult(changeCount, modified);
    }

    static int CountOccurrences(string text, string needle)
    {
        var count = 0;
        var index = 0;
        while ((index = text.IndexOf(needle, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += needle.Length;
        }

        return count;
    }
}
