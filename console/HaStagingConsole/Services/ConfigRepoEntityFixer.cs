namespace HaStagingConsole.Services;

static class ConfigRepoEntityFixer
{
    static readonly string[] ConfigDirectoryPrefixes =
    [
        "packages/",
        "python_scripts/",
        "custom_components/",
        "blueprints/",
        "themes/",
        "lovelace/",
    ];

    static readonly HashSet<string> HelperStoragePaths =
        ProdStorageDeployService.HelperBundlePaths
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

    static readonly HashSet<string> ExcludedDirectoryPrefixes = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git/",
        "scripts/unraid/",
        "docs/",
        ".github/",
        ".cursor/",
    };

    public static LovelaceFixApplyResult ApplyTypoFix(
        string repoRoot,
        string typoEntityId,
        string correctEntityId)
    {
        if (!IsEntityId(typoEntityId))
            throw new ArgumentException($"Invalid typo entity id: {typoEntityId}");
        if (!IsEntityId(correctEntityId))
            throw new ArgumentException($"Invalid correct entity id: {correctEntityId}");
        if (string.Equals(typoEntityId, correctEntityId, StringComparison.Ordinal))
            throw new ArgumentException("Typo and correct entity ids are the same");

        var modified = new List<string>();
        var changeCount = 0;

        foreach (var relativePath in EnumerateScanPaths(repoRoot))
        {
            var diskPath = Path.Combine(repoRoot, relativePath);
            if (!File.Exists(diskPath))
                continue;

            var text = File.ReadAllText(diskPath);
            var fileChanges = 0;

            fileChanges += CountAndReplace(ref text, typoEntityId, correctEntityId);

            if (HelperStoragePaths.Contains(relativePath)
                && TryObjectId(typoEntityId, out var typoObjectId)
                && TryObjectId(correctEntityId, out var correctObjectId)
                && !string.Equals(typoObjectId, correctObjectId, StringComparison.Ordinal))
            {
                var idLiteral = $"\"id\": \"{typoObjectId}\"";
                var idReplacement = $"\"id\": \"{correctObjectId}\"";
                fileChanges += CountAndReplace(ref text, idLiteral, idReplacement);
            }

            if (fileChanges <= 0)
                continue;

            File.WriteAllText(diskPath, text);
            modified.Add(relativePath);
            changeCount += fileChanges;
        }

        return new LovelaceFixApplyResult(changeCount, modified);
    }

    static IEnumerable<string> EnumerateScanPaths(string repoRoot)
    {
        if (!Directory.Exists(repoRoot))
            return [];

        var paths = new List<string>();
        foreach (var file in Directory.EnumerateFiles(repoRoot, "*.*", SearchOption.AllDirectories))
        {
            var relativePath = Path.GetRelativePath(repoRoot, file).Replace('\\', '/');
            if (ExcludedDirectoryPrefixes.Any(prefix =>
                    relativePath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            if (!ShouldScanFile(relativePath))
                continue;

            paths.Add(relativePath);
        }

        return paths.Order(StringComparer.Ordinal);
    }

    static bool ShouldScanFile(string relativePath)
    {
        if (ProdStorageDeployService.IsLovelacePath(relativePath)
            || ProdStorageDeployService.IsHelperPath(relativePath))
        {
            return true;
        }

        foreach (var prefix in ConfigDirectoryPrefixes)
        {
            if (!relativePath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                continue;

            return relativePath.EndsWith(".yaml", StringComparison.OrdinalIgnoreCase)
                || relativePath.EndsWith(".yml", StringComparison.OrdinalIgnoreCase)
                || relativePath.EndsWith(".json", StringComparison.OrdinalIgnoreCase)
                || relativePath.EndsWith(".py", StringComparison.OrdinalIgnoreCase);
        }

        if (relativePath.Contains('/', StringComparison.Ordinal))
            return false;

        if (string.Equals(relativePath, "secrets.yaml", StringComparison.OrdinalIgnoreCase))
            return false;

        return relativePath.EndsWith(".yaml", StringComparison.OrdinalIgnoreCase)
            || relativePath.EndsWith(".yml", StringComparison.OrdinalIgnoreCase);
    }

    static int CountAndReplace(ref string text, string from, string to)
    {
        if (string.IsNullOrEmpty(from) || !text.Contains(from, StringComparison.Ordinal))
            return 0;

        var count = 0;
        var index = 0;
        while ((index = text.IndexOf(from, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += from.Length;
        }

        if (count > 0)
            text = text.Replace(from, to, StringComparison.Ordinal);

        return count;
    }

    static bool TryObjectId(string entityId, out string objectId)
    {
        var dot = entityId.IndexOf('.');
        if (dot <= 0 || dot >= entityId.Length - 1)
        {
            objectId = "";
            return false;
        }

        objectId = entityId[(dot + 1)..];
        return true;
    }

    static bool IsEntityId(string? value) =>
        !string.IsNullOrWhiteSpace(value)
        && value.Contains('.', StringComparison.Ordinal)
        && !value.StartsWith("custom:", StringComparison.OrdinalIgnoreCase)
        && !value.StartsWith("ui-", StringComparison.OrdinalIgnoreCase);
}
