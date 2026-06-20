using System.Text;
using System.Text.RegularExpressions;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

sealed record MigrationManifestDraft(
    string Id,
    string Title,
    string Description,
    bool StopHomeAssistant,
    IReadOnlyList<MigrationPreconditionDraft> Preconditions,
    IReadOnlyList<MigrationStepDraft> Steps);

sealed record MigrationPreconditionDraft(string Type, string? EntityId = null, string? Path = null, string? Text = null);

sealed record MigrationStepDraft(string Name, string Action, IReadOnlyDictionary<string, object?> Params);

sealed record MigrationGitReplaceDraft(string FromEntityId, string ToEntityId, IReadOnlyList<string> Paths);

static partial class MigrationManifestBuilder
{
    [GeneratedRegex(@"[^a-z0-9]+", RegexOptions.CultureInvariant)]
    private static partial Regex NonSlugRegex();

    public static MigrationManifestDraft FromNamingIssue(ProdEntityNamingIssue issue, string repoRoot)
    {
        return issue.ProdFixAction switch
        {
            "suffix-collision" => BuildSuffixCollision(
                issue.ExpectedEntityId ?? issue.PrimaryEntityId,
                issue.WrongEntityId ?? issue.PrimaryEntityId,
                issue.BlockerEntityId,
                issue.Summary,
                issue.ManualFixSummary,
                repoRoot),
            "registry-rename" => BuildRegistryRename(
                issue.ExpectedEntityId ?? issue.PrimaryEntityId,
                issue.WrongEntityId ?? issue.PrimaryEntityId,
                issue.Kind == "cast_numeric_suffix",
                issue.Summary,
                issue.ManualFixSummary,
                repoRoot),
            _ => throw new InvalidOperationException(
                $"Naming issue `{issue.PrimaryEntityId}` has no exportable prod fix action."),
        };
    }

    public static MigrationManifestDraft FromDeployGateIssue(LovelaceMissingEntityIssue issue, string repoRoot)
    {
        var prodFixAction = issue.ProdContext?.ProdFixAction;
        if (prodFixAction == "suffix-collision")
        {
            var suffix = issue.ProdContext?.SimilarProdEntityId
                ?? throw new InvalidOperationException("Missing similar prod entity for suffix collision export.");
            return BuildSuffixCollision(
                issue.EntityId,
                suffix,
                issue.ProdContext?.EntityIdOccupiedBy,
                issue.Suggestion,
                issue.ManualFixSummary,
                repoRoot);
        }

        if (prodFixAction == "registry-rename")
        {
            var wrong = issue.ProdContext?.SimilarProdEntityId
                ?? throw new InvalidOperationException("Missing similar prod entity for registry rename export.");
            var relaxed = string.Equals(issue.ProdContext?.Platform, "cast", StringComparison.OrdinalIgnoreCase);
            return BuildRegistryRename(
                issue.EntityId,
                wrong,
                relaxed,
                issue.Suggestion,
                issue.ManualFixSummary,
                repoRoot);
        }

        if (issue.SuggestionKind == "rename"
            && !string.IsNullOrWhiteSpace(issue.SuggestedProdEntity)
            && !string.Equals(issue.SuggestedProdEntity, issue.EntityId, StringComparison.OrdinalIgnoreCase))
        {
            return BuildGitOnlyRename(
                issue.EntityId,
                issue.SuggestedProdEntity!,
                issue.Suggestion,
                issue.ManualFixSummary,
                repoRoot);
        }

        if (issue.ProdContext?.ExpectedEntityDeletedOnProd == true
            && issue.ProdContext.DeletedRegistryEntityIds.Count > 0)
        {
            return BuildTombstonePurge(issue.EntityId, issue.Suggestion, issue.ManualFixSummary);
        }

        throw new InvalidOperationException(
            $"Deploy gate issue `{issue.EntityId}` has no exportable migration path.");
    }

    public static IReadOnlyList<MigrationGitReplaceDraft> CollectGitReplacements(MigrationManifestDraft draft) =>
        draft.Steps
            .Where(s => s.Action == "config.replace_entity_id")
            .Select(s =>
            {
                var from = (string)s.Params["fromEntityId"]!;
                var to = (string)s.Params["toEntityId"]!;
                var paths = ((IEnumerable<object>)s.Params["paths"]!).Cast<string>().ToList();
                return new MigrationGitReplaceDraft(from, to, paths);
            })
            .ToList();

    static MigrationManifestDraft BuildSuffixCollision(
        string expectedEntityId,
        string suffixEntityId,
        string? blockerEntityId,
        string summary,
        string manualFixSummary,
        string repoRoot)
    {
        var id = $"{SlugFromEntityId(suffixEntityId)}-suffix-collision";
        var steps = new List<MigrationStepDraft>
        {
            new(
                "Remove blocker and rename suffix entity to base id",
                "registry.suffix_collision_fix",
                new Dictionary<string, object?>
                {
                    ["expectedEntityId"] = expectedEntityId,
                    ["suffixEntityId"] = suffixEntityId,
                }),
        };

        if (!string.IsNullOrWhiteSpace(blockerEntityId)
            && !string.Equals(blockerEntityId, expectedEntityId, StringComparison.Ordinal))
        {
            steps[0] = steps[0] with
            {
                Params = new Dictionary<string, object?>(steps[0].Params)
                {
                    ["blockerEntityId"] = blockerEntityId,
                },
            };
        }

        AddConfigReplaceSteps(steps, suffixEntityId, expectedEntityId, repoRoot);

        var preconditions = new List<MigrationPreconditionDraft>
        {
            new("entity_exists", EntityId: suffixEntityId),
        };

        foreach (var path in ConfigEntityFixer.FindPathsContaining(repoRoot, suffixEntityId))
        {
            preconditions.Add(new MigrationPreconditionDraft(
                "file_contains_entity",
                Path: path,
                Text: suffixEntityId));
        }

        return new MigrationManifestDraft(
            id,
            $"Suffix collision — {ObjectLabel(expectedEntityId)}",
            $"{summary.Trim()} {manualFixSummary.Trim()}",
            true,
            preconditions,
            steps);
    }

    static MigrationManifestDraft BuildRegistryRename(
        string expectedEntityId,
        string wrongEntityId,
        bool relaxedUniqueId,
        string summary,
        string manualFixSummary,
        string repoRoot)
    {
        var id = relaxedUniqueId
            ? $"{SlugFromEntityId(wrongEntityId)}-cast-rename"
            : $"{SlugFromEntityId(wrongEntityId)}-registry-rename";

        var renameParams = new Dictionary<string, object?>
        {
            ["fromEntityId"] = wrongEntityId,
            ["toEntityId"] = expectedEntityId,
        };
        if (relaxedUniqueId)
            renameParams["relaxedUniqueId"] = true;

        var steps = new List<MigrationStepDraft>
        {
            new(
                relaxedUniqueId ? "Rename cast entity to _cast id" : "Rename prod registry entity id",
                "registry.rename_entity",
                renameParams),
        };

        AddConfigReplaceSteps(steps, wrongEntityId, expectedEntityId, repoRoot);

        var preconditions = new List<MigrationPreconditionDraft>
        {
            new("entity_exists", EntityId: wrongEntityId),
            new("entity_not_exists", EntityId: expectedEntityId),
        };

        return new MigrationManifestDraft(
            id,
            relaxedUniqueId
                ? $"Cast rename — {ObjectLabel(wrongEntityId)} → {ObjectLabel(expectedEntityId)}"
                : $"Registry rename — {ObjectLabel(wrongEntityId)} → {ObjectLabel(expectedEntityId)}",
            $"{summary.Trim()} {manualFixSummary.Trim()}",
            true,
            preconditions,
            steps);
    }

    static MigrationManifestDraft BuildGitOnlyRename(
        string fromEntityId,
        string toEntityId,
        string summary,
        string manualFixSummary,
        string repoRoot)
    {
        var paths = ConfigEntityFixer.FindPathsContaining(repoRoot, fromEntityId);
        if (paths.Count == 0)
            throw new InvalidOperationException(
                $"No git references to `{fromEntityId}` — nothing to export.");

        var id = $"{SlugFromEntityId(fromEntityId)}-lovelace-rename";
        var steps = new List<MigrationStepDraft>
        {
            new(
                "Replace git/config entity references",
                "config.replace_entity_id",
                new Dictionary<string, object?>
                {
                    ["fromEntityId"] = fromEntityId,
                    ["toEntityId"] = toEntityId,
                    ["paths"] = paths.ToList(),
                }),
        };

        var preconditions = new List<MigrationPreconditionDraft>
        {
            new("entity_exists", EntityId: toEntityId),
            new("entity_not_exists", EntityId: fromEntityId),
        };
        foreach (var path in paths)
            preconditions.Add(new MigrationPreconditionDraft("file_contains_entity", Path: path, Text: fromEntityId));

        return new MigrationManifestDraft(
            id,
            $"Git entity rename — {ObjectLabel(fromEntityId)} → {ObjectLabel(toEntityId)}",
            $"{summary.Trim()} {manualFixSummary.Trim()}",
            false,
            preconditions,
            steps);
    }

    static MigrationManifestDraft BuildTombstonePurge(string expectedEntityId, string summary, string manualFixSummary)
    {
        var id = $"{SlugFromEntityId(expectedEntityId)}-purge-tombstones";
        return new MigrationManifestDraft(
            id,
            $"Purge registry tombstones — {ObjectLabel(expectedEntityId)}",
            $"{summary.Trim()} {manualFixSummary.Trim()}",
            true,
            [new MigrationPreconditionDraft("entity_not_exists", EntityId: expectedEntityId)],
            [
                new MigrationStepDraft(
                    "Remove deleted_entities rows blocking this id",
                    "registry.purge_deleted_tombstones",
                    new Dictionary<string, object?> { ["expectedEntityId"] = expectedEntityId }),
            ]);
    }

    static void AddConfigReplaceSteps(
        List<MigrationStepDraft> steps,
        string fromEntityId,
        string toEntityId,
        string repoRoot)
    {
        var paths = ConfigEntityFixer.FindPathsContaining(repoRoot, fromEntityId);
        if (paths.Count == 0)
            return;

        var byKind = paths
            .GroupBy(p => p is "scripts.yaml" or "automations.yaml" ? "yaml" : "lovelace")
            .ToList();

        foreach (var group in byKind)
        {
            var groupPaths = group.Order(StringComparer.Ordinal).ToList();
            steps.Add(new MigrationStepDraft(
                group.Key == "yaml"
                    ? "Update scripts/automations entity references"
                    : "Update Lovelace entity references",
                "config.replace_entity_id",
                new Dictionary<string, object?>
                {
                    ["fromEntityId"] = fromEntityId,
                    ["toEntityId"] = toEntityId,
                    ["paths"] = groupPaths,
                }));
        }
    }

    static string SlugFromEntityId(string entityId)
    {
        var dot = entityId.IndexOf('.');
        var objectId = dot > 0 ? entityId[(dot + 1)..] : entityId;
        var slug = NonSlugRegex().Replace(objectId.ToLowerInvariant(), "-").Trim('-');
        if (slug.Length < 2)
            slug = "entity";
        if (slug.Length > 48)
            slug = slug[..48].Trim('-');
        return slug;
    }

    static string ObjectLabel(string entityId)
    {
        var dot = entityId.IndexOf('.');
        return dot > 0 ? entityId[(dot + 1)..] : entityId;
    }
}

static class MigrationManifestYamlWriter
{
    public static string Write(MigrationManifestDraft draft)
    {
        var sb = new StringBuilder();
        sb.AppendLine("apiVersion: ha-staging-kit/v1");
        sb.AppendLine("kind: Migration");
        sb.AppendLine("metadata:");
        sb.AppendLine($"  id: {draft.Id}");
        sb.AppendLine($"  title: {YamlQuote(draft.Title)}");
        WriteDescription(sb, draft.Description);
        sb.AppendLine("  issue: https://github.com/Unthred/ha-staging-kit/issues/11");
        sb.AppendLine("spec:");
        sb.AppendLine($"  stopHomeAssistant: {(draft.StopHomeAssistant ? "true" : "false")}");
        if (draft.Preconditions.Count > 0)
        {
            sb.AppendLine("  preconditions:");
            foreach (var pre in draft.Preconditions)
            {
                sb.AppendLine($"    - type: {pre.Type}");
                if (!string.IsNullOrWhiteSpace(pre.EntityId))
                    sb.AppendLine($"      entityId: {pre.EntityId}");
                if (!string.IsNullOrWhiteSpace(pre.Path))
                    sb.AppendLine($"      path: {pre.Path}");
                if (!string.IsNullOrWhiteSpace(pre.Text))
                    sb.AppendLine($"      text: {pre.Text}");
            }
        }

        sb.AppendLine("  steps:");
        foreach (var step in draft.Steps)
        {
            sb.AppendLine($"    - name: {YamlQuote(step.Name)}");
            sb.AppendLine($"      action: {step.Action}");
            sb.AppendLine("      params:");
            WriteParams(sb, step.Params, indent: 8);
        }

        return sb.ToString();
    }

    static void WriteDescription(StringBuilder sb, string description)
    {
        var trimmed = description.Trim();
        if (trimmed.Contains('\n', StringComparison.Ordinal))
        {
            sb.AppendLine("  description: |");
            foreach (var line in trimmed.Split('\n'))
                sb.AppendLine($"    {line.TrimEnd()}");
            return;
        }

        sb.AppendLine($"  description: {YamlQuote(trimmed)}");
    }

    static void WriteParams(StringBuilder sb, IReadOnlyDictionary<string, object?> parameters, int indent)
    {
        var pad = new string(' ', indent);
        foreach (var (key, value) in parameters)
        {
            switch (value)
            {
                case null:
                    continue;
                case bool b:
                    sb.AppendLine($"{pad}{key}: {(b ? "true" : "false")}");
                    break;
                case IList<string> paths:
                    sb.AppendLine($"{pad}{key}:");
                    foreach (var path in paths)
                        sb.AppendLine($"{pad}  - {path}");
                    break;
                default:
                    sb.AppendLine($"{pad}{key}: {value}");
                    break;
            }
        }
    }

    static string YamlQuote(string value)
    {
        if (value.Contains(':')
            || value.Contains('"')
            || value.Contains('#')
            || value.StartsWith(' ')
            || value.EndsWith(' '))
        {
            return $"\"{value.Replace("\"", "\\\"")}\"";
        }

        return value;
    }
}
