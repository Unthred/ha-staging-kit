using System.Text.Json;

namespace HaStagingConsole.Services;

public sealed class LovelaceParityDeferStore(KitPaths paths)
{
    static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    string DeferFile => Path.Combine(paths.SidecarData, "lovelace-parity-deferred.json");

    public HashSet<string> Load()
    {
        try
        {
            if (!File.Exists(DeferFile))
                return new HashSet<string>(StringComparer.Ordinal);

            var json = File.ReadAllText(DeferFile);
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("entityIds", out var ids)
                || ids.ValueKind != JsonValueKind.Array)
            {
                return new HashSet<string>(StringComparer.Ordinal);
            }

            var set = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in ids.EnumerateArray())
            {
                var id = item.GetString();
                if (!string.IsNullOrWhiteSpace(id))
                    set.Add(id.Trim());
            }

            return set;
        }
        catch
        {
            return new HashSet<string>(StringComparer.Ordinal);
        }
    }

    public void Save(IReadOnlySet<string> entityIds)
    {
        Directory.CreateDirectory(paths.SidecarData);
        var payload = new { entityIds = entityIds.Order(StringComparer.Ordinal).ToArray() };
        File.WriteAllText(DeferFile, JsonSerializer.Serialize(payload, JsonOptions) + "\n");
    }

    public bool SetDeferred(string entityId, bool deferred)
    {
        if (string.IsNullOrWhiteSpace(entityId))
            return false;

        var ids = Load();
        var changed = deferred
            ? ids.Add(entityId.Trim())
            : ids.Remove(entityId.Trim());
        if (changed)
            Save(ids);
        return changed;
    }

    public void PruneStale(IEnumerable<string> stillMissingEntityIds)
    {
        var stillMissing = stillMissingEntityIds.ToHashSet(StringComparer.Ordinal);
        var ids = Load();
        var pruned = ids.Where(stillMissing.Contains).ToHashSet(StringComparer.Ordinal);
        if (pruned.Count != ids.Count)
            Save(pruned);
    }

    public void Clear()
    {
        try
        {
            if (File.Exists(DeferFile))
                File.Delete(DeferFile);
        }
        catch
        {
            Save(new HashSet<string>(StringComparer.Ordinal));
        }
    }
}
