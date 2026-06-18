using System.Text.Json;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed record LovelaceParityUndoEntry(
    string Action,
    string EntityId,
    string? ReplacementEntityId,
    IReadOnlyDictionary<string, string> FileSnapshots,
    DateTimeOffset CreatedAt);

public sealed class LovelaceParityUndoStore(KitPaths paths)
{
    static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
    const int MaxEntries = 60;

    string StackFile => Path.Combine(paths.SidecarData, "lovelace-parity-undo-stack.json");

    public LovelaceParityUndoEntry? Peek()
    {
        var stack = LoadStack();
        return stack.Count == 0 ? null : stack[^1];
    }

    public IReadOnlyList<LovelaceParityUndoEntry> GetEntries() => LoadStack();

    public void Push(LovelaceParityUndoEntry entry)
    {
        var stack = LoadStack();
        stack.Add(entry);
        if (stack.Count > MaxEntries)
            stack.RemoveRange(0, stack.Count - MaxEntries);
        Save(stack);
    }

    public LovelaceParityUndoEntry? Pop()
    {
        var stack = LoadStack();
        if (stack.Count == 0)
            return null;

        var last = stack[^1];
        stack.RemoveAt(stack.Count - 1);
        Save(stack);
        return last;
    }

    public void Clear() => Save([]);

    List<LovelaceParityUndoEntry> LoadStack()
    {
        try
        {
            if (!File.Exists(StackFile))
                return [];

            var json = File.ReadAllText(StackFile);
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("entries", out var entries)
                || entries.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            var stack = new List<LovelaceParityUndoEntry>();
            foreach (var item in entries.EnumerateArray())
            {
                var action = item.TryGetProperty("action", out var actionProp)
                    ? actionProp.GetString()
                    : null;
                var entityId = item.TryGetProperty("entityId", out var entityProp)
                    ? entityProp.GetString()
                    : null;
                if (string.IsNullOrWhiteSpace(action) || string.IsNullOrWhiteSpace(entityId))
                    continue;

                var replacement = item.TryGetProperty("replacementEntityId", out var replacementProp)
                    ? replacementProp.GetString()
                    : null;

                var snapshots = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                if (item.TryGetProperty("fileSnapshots", out var filesProp)
                    && filesProp.ValueKind == JsonValueKind.Object)
                {
                    foreach (var file in filesProp.EnumerateObject())
                    {
                        var content = file.Value.GetString();
                        if (content is not null)
                            snapshots[file.Name] = content;
                    }
                }

                var createdAt = item.TryGetProperty("createdAt", out var createdProp)
                    && DateTimeOffset.TryParse(createdProp.GetString(), out var parsed)
                    ? parsed
                    : DateTimeOffset.UtcNow;

                stack.Add(new LovelaceParityUndoEntry(
                    action,
                    entityId.Trim(),
                    string.IsNullOrWhiteSpace(replacement) ? null : replacement.Trim(),
                    snapshots,
                    createdAt));
            }

            return stack;
        }
        catch
        {
            return [];
        }
    }

    void Save(IReadOnlyList<LovelaceParityUndoEntry> stack)
    {
        Directory.CreateDirectory(paths.SidecarData);
        var payload = new
        {
            entries = stack.Select(entry => new
            {
                action = entry.Action,
                entityId = entry.EntityId,
                replacementEntityId = entry.ReplacementEntityId,
                fileSnapshots = entry.FileSnapshots,
                createdAt = entry.CreatedAt.UtcDateTime.ToString("O"),
            }).ToArray(),
        };
        File.WriteAllText(StackFile, JsonSerializer.Serialize(payload, JsonOptions) + "\n");
    }
}

static class LovelaceParitySnapshotHelper
{
    public static Dictionary<string, string> SnapshotLovelaceFilesContaining(string repoRoot, string needle)
    {
        var snapshots = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var relativePath in ProdStorageDeployService.LovelaceBundlePaths)
            TryAddSnapshot(repoRoot, relativePath, needle, snapshots);
        return snapshots;
    }

    public static Dictionary<string, string> SnapshotConfigFilesContaining(string repoRoot, string needle)
    {
        var snapshots = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var relativePath in EnumerateConfigScanPaths(repoRoot))
            TryAddSnapshot(repoRoot, relativePath, needle, snapshots);
        return snapshots;
    }

    static IEnumerable<string> EnumerateConfigScanPaths(string repoRoot)
    {
        if (!Directory.Exists(repoRoot))
            return [];

        var paths = new List<string>();
        foreach (var file in Directory.EnumerateFiles(repoRoot, "*.*", SearchOption.AllDirectories))
        {
            var relativePath = Path.GetRelativePath(repoRoot, file).Replace('\\', '/');
            if (relativePath.StartsWith(".git/", StringComparison.OrdinalIgnoreCase)
                || relativePath.StartsWith("scripts/unraid/", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (ProdStorageDeployService.IsLovelacePath(relativePath)
                || ProdStorageDeployService.IsHelperPath(relativePath))
            {
                paths.Add(relativePath);
                continue;
            }

            if (relativePath.StartsWith("packages/", StringComparison.OrdinalIgnoreCase)
                && (relativePath.EndsWith(".yaml", StringComparison.OrdinalIgnoreCase)
                    || relativePath.EndsWith(".yml", StringComparison.OrdinalIgnoreCase)
                    || relativePath.EndsWith(".json", StringComparison.OrdinalIgnoreCase)))
            {
                paths.Add(relativePath);
                continue;
            }

            if (!relativePath.Contains('/', StringComparison.Ordinal)
                && !string.Equals(relativePath, "secrets.yaml", StringComparison.OrdinalIgnoreCase)
                && (relativePath.EndsWith(".yaml", StringComparison.OrdinalIgnoreCase)
                    || relativePath.EndsWith(".yml", StringComparison.OrdinalIgnoreCase)))
            {
                paths.Add(relativePath);
            }
        }

        return paths;
    }

    static void TryAddSnapshot(
        string repoRoot,
        string relativePath,
        string needle,
        IDictionary<string, string> snapshots)
    {
        var diskPath = Path.Combine(repoRoot, relativePath);
        if (!File.Exists(diskPath))
            return;

        var text = File.ReadAllText(diskPath);
        if (!text.Contains(needle, StringComparison.Ordinal))
            return;

        snapshots[relativePath] = text;
    }
}
