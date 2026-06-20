using System.Text.Json;
using System.Text.Json.Serialization;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services.Release;

public sealed class ReleaseHistoryStore(KitPaths paths)
{
    static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public ReleaseHistoryDocument LoadHistory()
    {
        if (!File.Exists(paths.ReleaseHistoryFile))
            return new ReleaseHistoryDocument(null, [], 0);

        try
        {
            var doc = JsonSerializer.Deserialize<ReleaseHistoryDocument>(File.ReadAllText(paths.ReleaseHistoryFile), JsonOptions);
            return doc ?? new ReleaseHistoryDocument(null, [], 0);
        }
        catch
        {
            return new ReleaseHistoryDocument(null, [], 0);
        }
    }

    public void SaveHistory(ReleaseHistoryDocument doc)
    {
        Directory.CreateDirectory(paths.SidecarData);
        File.WriteAllText(paths.ReleaseHistoryFile, JsonSerializer.Serialize(doc, JsonOptions));
        SyncCompatShaFiles(doc);
    }

    public MigrationsAppliedDocument LoadMigrationsApplied()
    {
        if (!File.Exists(paths.MigrationsAppliedFile))
            return new MigrationsAppliedDocument(null, []);

        try
        {
            var doc = JsonSerializer.Deserialize<MigrationsAppliedDocument>(File.ReadAllText(paths.MigrationsAppliedFile), JsonOptions);
            return doc ?? new MigrationsAppliedDocument(null, []);
        }
        catch
        {
            return new MigrationsAppliedDocument(null, []);
        }
    }

    public void SaveMigrationsApplied(MigrationsAppliedDocument doc) =>
        File.WriteAllText(paths.MigrationsAppliedFile, JsonSerializer.Serialize(doc, JsonOptions));

    public bool IsMigrationApplied(string migrationId) =>
        LoadMigrationsApplied().Entries.Any(e => string.Equals(e.Id, migrationId, StringComparison.OrdinalIgnoreCase));

    public void AppendMigrationApplied(string migrationId, string gitSha, string manifestPath)
    {
        var doc = LoadMigrationsApplied();
        if (doc.Entries.Any(e => string.Equals(e.Id, migrationId, StringComparison.OrdinalIgnoreCase)))
            return;

        var entries = doc.Entries.ToList();
        entries.Add(new MigrationAppliedEntry(migrationId, gitSha, DateTimeOffset.UtcNow, manifestPath));
        SaveMigrationsApplied(doc with { Entries = entries });
    }

    public void TrimMigrationsAppliedAfterReleaseIndex(int targetIndex)
    {
        var history = LoadHistory();
        var allowed = history.Releases
            .Where(r => r.Index <= targetIndex)
            .SelectMany(r => r.MigrationsApplied)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var doc = LoadMigrationsApplied();
        var trimmed = doc.Entries.Where(e => allowed.Contains(e.Id)).ToList();
        SaveMigrationsApplied(doc with { Entries = trimmed });
    }

    public void AppendRelease(ReleaseHistoryEntry entry)
    {
        var doc = LoadHistory();
        var releases = doc.Releases.ToList();
        releases.Add(entry);
        SaveHistory(doc with { Releases = releases, CurrentIndex = entry.Index });
    }

    public void TruncateToReleaseIndex(int targetIndex)
    {
        var doc = LoadHistory();
        var releases = doc.Releases.Where(r => r.Index <= targetIndex).ToList();
        SaveHistory(doc with { Releases = releases, CurrentIndex = targetIndex });
        TrimMigrationsAppliedAfterReleaseIndex(targetIndex);
    }

    public ReleaseHistoryEntry? FindRelease(int? index, string? sha)
    {
        var doc = LoadHistory();
        if (index is > 0)
            return doc.Releases.FirstOrDefault(r => r.Index == index.Value);

        if (!string.IsNullOrWhiteSpace(sha))
        {
            var normalized = sha.Trim();
            return doc.Releases.LastOrDefault(r =>
                string.Equals(r.Sha, normalized, StringComparison.OrdinalIgnoreCase)
                || string.Equals(r.ShortSha, normalized, StringComparison.OrdinalIgnoreCase)
                || r.Sha.StartsWith(normalized, StringComparison.OrdinalIgnoreCase));
        }

        return null;
    }

    public ReleaseHistoryEntry? CurrentRelease()
    {
        var doc = LoadHistory();
        return doc.Releases.LastOrDefault(r => r.Index == doc.CurrentIndex)
            ?? doc.Releases.LastOrDefault();
    }

    void SyncCompatShaFiles(ReleaseHistoryDocument doc)
    {
        var current = doc.Releases.LastOrDefault(r => r.Index == doc.CurrentIndex) ?? doc.Releases.LastOrDefault();
        var previous = doc.Releases.Where(r => current is null || r.Index < current.Index).MaxBy(r => r.Index);

        if (current is not null)
            File.WriteAllText(paths.LastProdDeployShaFile, current.Sha);

        if (previous is not null)
            File.WriteAllText(paths.LastProdDeployPreviousShaFile, previous.Sha);
    }
}
