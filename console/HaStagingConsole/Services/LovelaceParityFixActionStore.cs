using System.Text.Json;

namespace HaStagingConsole.Services;

public sealed record LovelaceParityFixActionEntry(
    string Action,
    string? ReplacementEntityId,
    DateTimeOffset FixedAt);

/// <summary>Persists kit fix actions for awaiting-publish labels in the deploy gate.</summary>
public sealed class LovelaceParityFixActionStore(KitPaths paths)
{
    static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    string ActionsFile => Path.Combine(paths.SidecarData, "lovelace-parity-fix-actions.json");

    public IReadOnlyDictionary<string, LovelaceParityFixActionEntry> Load()
    {
        try
        {
            if (!File.Exists(ActionsFile))
                return new Dictionary<string, LovelaceParityFixActionEntry>(StringComparer.Ordinal);

            using var doc = JsonDocument.Parse(File.ReadAllText(ActionsFile));
            if (!doc.RootElement.TryGetProperty("actions", out var actions)
                || actions.ValueKind != JsonValueKind.Object)
            {
                return new Dictionary<string, LovelaceParityFixActionEntry>(StringComparer.Ordinal);
            }

            var map = new Dictionary<string, LovelaceParityFixActionEntry>(StringComparer.Ordinal);
            foreach (var item in actions.EnumerateObject())
            {
                var action = item.Value.TryGetProperty("action", out var actionProp)
                    ? actionProp.GetString()
                    : null;
                if (string.IsNullOrWhiteSpace(action))
                    continue;

                var replacement = item.Value.TryGetProperty("replacementEntityId", out var replacementProp)
                    ? replacementProp.GetString()
                    : null;
                var fixedAt = item.Value.TryGetProperty("fixedAt", out var fixedAtProp)
                    && DateTimeOffset.TryParse(fixedAtProp.GetString(), out var parsed)
                    ? parsed
                    : DateTimeOffset.UtcNow;

                map[item.Name] = new LovelaceParityFixActionEntry(
                    action.Trim(),
                    string.IsNullOrWhiteSpace(replacement) ? null : replacement.Trim(),
                    fixedAt);
            }

            return map;
        }
        catch
        {
            return new Dictionary<string, LovelaceParityFixActionEntry>(StringComparer.Ordinal);
        }
    }

    public void Record(string entityId, string action, string? replacementEntityId = null)
    {
        var id = entityId.Trim();
        if (string.IsNullOrWhiteSpace(id))
            return;

        var map = new Dictionary<string, LovelaceParityFixActionEntry>(Load(), StringComparer.Ordinal);
        map[id] = new LovelaceParityFixActionEntry(
            action.Trim(),
            string.IsNullOrWhiteSpace(replacementEntityId) ? null : replacementEntityId.Trim(),
            DateTimeOffset.UtcNow);
        Save(map);
    }

    public void Remove(string entityId)
    {
        var id = entityId.Trim();
        if (string.IsNullOrWhiteSpace(id))
            return;

        var map = new Dictionary<string, LovelaceParityFixActionEntry>(Load(), StringComparer.Ordinal);
        if (!map.Remove(id))
            return;
        Save(map);
    }

    public void Clear() => Save(new Dictionary<string, LovelaceParityFixActionEntry>(StringComparer.Ordinal));

    void Save(IReadOnlyDictionary<string, LovelaceParityFixActionEntry> map)
    {
        Directory.CreateDirectory(paths.SidecarData);
        var payload = new
        {
            actions = map.ToDictionary(
                pair => pair.Key,
                pair => new
                {
                    action = pair.Value.Action,
                    replacementEntityId = pair.Value.ReplacementEntityId,
                    fixedAt = pair.Value.FixedAt.UtcDateTime.ToString("O"),
                },
                StringComparer.Ordinal),
        };
        File.WriteAllText(ActionsFile, JsonSerializer.Serialize(payload, JsonOptions) + "\n");
    }
}
