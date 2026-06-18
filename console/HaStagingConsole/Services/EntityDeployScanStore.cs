using System.Text.Json;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class EntityDeployScanStore(KitPaths paths)
{
    static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    string ScanFile => Path.Combine(paths.SidecarData, "entity-deploy-scan-last.json");

    public EntityDeployRecheckDelta RecordScan(IReadOnlyList<string> blockingEntityIds)
    {
        var previous = Load();
        var current = blockingEntityIds
            .Order(StringComparer.Ordinal)
            .ToList();
        var previousSet = previous.EntityIds.ToHashSet(StringComparer.Ordinal);
        var currentSet = current.ToHashSet(StringComparer.Ordinal);

        var resolved = previous.EntityIds
            .Where(id => !currentSet.Contains(id))
            .Order(StringComparer.Ordinal)
            .ToList();
        var added = current
            .Where(id => !previousSet.Contains(id))
            .Order(StringComparer.Ordinal)
            .ToList();

        Save(current);

        return new EntityDeployRecheckDelta(resolved, added, previous.ScannedAt);
    }

    (DateTimeOffset? ScannedAt, IReadOnlyList<string> EntityIds) Load()
    {
        try
        {
            if (!File.Exists(ScanFile))
                return (null, []);

            using var doc = JsonDocument.Parse(File.ReadAllText(ScanFile));
            var root = doc.RootElement;
            var ids = new List<string>();
            if (root.TryGetProperty("blockingEntityIds", out var arr)
                && arr.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in arr.EnumerateArray())
                {
                    var id = item.GetString();
                    if (!string.IsNullOrWhiteSpace(id))
                        ids.Add(id.Trim());
                }
            }

            DateTimeOffset? at = null;
            if (root.TryGetProperty("scannedAt", out var atProp)
                && DateTimeOffset.TryParse(atProp.GetString(), out var parsed))
            {
                at = parsed;
            }

            return (at, ids.Order(StringComparer.Ordinal).ToList());
        }
        catch
        {
            return (null, []);
        }
    }

    void Save(IReadOnlyList<string> blockingEntityIds)
    {
        Directory.CreateDirectory(paths.SidecarData);
        var payload = new
        {
            scannedAt = DateTimeOffset.UtcNow.UtcDateTime.ToString("O"),
            blockingEntityIds = blockingEntityIds.Order(StringComparer.Ordinal).ToArray(),
        };
        File.WriteAllText(ScanFile, JsonSerializer.Serialize(payload, JsonOptions) + "\n");
    }

    public void ClearLastScan()
    {
        try
        {
            if (File.Exists(ScanFile))
                File.Delete(ScanFile);
        }
        catch
        {
            /* best effort */
        }
    }
}
