using HaStagingConsole.Models;

namespace HaStagingConsole.Services.Release;

public sealed class MigrationRunner(
    ProdEntitySuffixFixService entitySuffixFix,
    ProdDeletedRegistryPurgeService deletedRegistryPurge,
    ProdRegistryReader prodRegistry)
{
    public async Task<OperationResult> RunAsync(MigrationManifestDocument manifest, CancellationToken ct)
    {
        var logs = new List<string> { $"Migration `{manifest.Id}` — {manifest.Title}" };

        foreach (var step in manifest.Steps)
        {
            var result = step.Action switch
            {
                "registry.suffix_collision_fix" => await RunSuffixFix(step, ct),
                "registry.rename_entity" => await RunRename(step, ct),
                "registry.purge_deleted_tombstones" => await RunPurge(step, ct),
                "config.replace_entity_id" => SkipGitReplace(step),
                _ => new OperationResult(false, $"Unknown migration action `{step.Action}`", null),
            };

            logs.Add(result.Message);
            if (!result.Ok)
                return new OperationResult(false, $"Migration `{manifest.Id}` failed at step `{step.Name}`", Join(logs, result.LogTail));
        }

        return new OperationResult(true, $"Migration `{manifest.Id}` completed", Join(logs, null));
    }

    public bool RequiresRegistryStop(MigrationManifestDocument manifest) =>
        manifest.StopHomeAssistant
        || manifest.Steps.Any(s => s.Action.StartsWith("registry.", StringComparison.Ordinal));

    static OperationResult SkipGitReplace(MigrationStepDocument step) =>
        new(
            true,
            $"Step `{step.Name}` — config.replace_entity_id deferred to git deploy (already in tree at release SHA)",
            null);

    async Task<OperationResult> RunSuffixFix(MigrationStepDocument step, CancellationToken ct)
    {
        var expected = GetString(step.Params, "expectedEntityId");
        var suffix = GetString(step.Params, "suffixEntityId");
        return await entitySuffixFix.FixSuffixCollisionAsync(expected, suffix, ct);
    }

    async Task<OperationResult> RunRename(MigrationStepDocument step, CancellationToken ct)
    {
        var from = GetString(step.Params, "fromEntityId");
        var to = GetString(step.Params, "toEntityId");
        var relaxed = GetBool(step.Params, "relaxedUniqueId");
        return await entitySuffixFix.FixWrongEntityIdAsync(to, from, ct, relaxed);
    }

    async Task<OperationResult> RunPurge(MigrationStepDocument step, CancellationToken ct)
    {
        var expected = GetString(step.Params, "expectedEntityId");
        var similar = GetOptionalString(step.Params, "uniqueIdPrefix");
        return await deletedRegistryPurge.PurgeDeletedEntitiesAsync(expected, similar, ct);
    }

    public async Task<OperationResult> ValidatePreconditionsAsync(
        MigrationManifestDocument manifest,
        CancellationToken ct)
    {
        var registry = await prodRegistry.ReadAsync(ct);
        if (registry is null)
            return new OperationResult(false, "Could not read prod entity registry for preconditions", null);

        foreach (var pre in manifest.Preconditions)
        {
            switch (pre.Type)
            {
                case "entity_exists":
                    if (string.IsNullOrWhiteSpace(pre.EntityId)
                        || !registry.ActiveEntities.ContainsKey(pre.EntityId))
                    {
                        return new OperationResult(
                            false,
                            $"Precondition failed: entity_exists `{pre.EntityId}`",
                            null);
                    }
                    break;
                case "entity_not_exists":
                    if (!string.IsNullOrWhiteSpace(pre.EntityId)
                        && registry.ActiveEntities.ContainsKey(pre.EntityId))
                    {
                        return new OperationResult(
                            false,
                            $"Precondition failed: entity_not_exists `{pre.EntityId}`",
                            null);
                    }
                    break;
            }
        }

        return new OperationResult(true, "Preconditions passed", null);
    }

    static string GetString(IReadOnlyDictionary<string, object?> dict, string key) =>
        dict.TryGetValue(key, out var value) && value is not null
            ? value.ToString()!.Trim()
            : throw new InvalidOperationException($"Missing param `{key}`");

    static string? GetOptionalString(IReadOnlyDictionary<string, object?> dict, string key) =>
        dict.TryGetValue(key, out var value) ? value?.ToString()?.Trim() : null;

    static bool GetBool(IReadOnlyDictionary<string, object?> dict, string key) =>
        dict.TryGetValue(key, out var value) && value switch
        {
            bool b => b,
            string s => bool.TryParse(s, out var parsed) && parsed,
            _ => false,
        };

    static string? Join(IEnumerable<string> lines, string? tail) =>
        string.Join("\n", lines.Concat(string.IsNullOrWhiteSpace(tail) ? [] : [tail!]));
}
