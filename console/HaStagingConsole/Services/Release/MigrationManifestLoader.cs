using HaStagingConsole.Models;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace HaStagingConsole.Services.Release;

public sealed class MigrationManifestLoader
{
    static readonly IDeserializer Deserializer = new DeserializerBuilder()
        .WithNamingConvention(CamelCaseNamingConvention.Instance)
        .IgnoreUnmatchedProperties()
        .Build();

    public MigrationManifestDocument Parse(string yaml, string relativePath)
    {
        var root = Deserializer.Deserialize<Dictionary<string, object?>>(yaml)
            ?? throw new InvalidOperationException($"Empty manifest: {relativePath}");

        if (!string.Equals(root.GetValueOrDefault("apiVersion") as string, "ha-staging-kit/v1", StringComparison.Ordinal))
            throw new InvalidOperationException($"{relativePath}: apiVersion must be ha-staging-kit/v1");
        if (!string.Equals(root.GetValueOrDefault("kind") as string, "Migration", StringComparison.Ordinal))
            throw new InvalidOperationException($"{relativePath}: kind must be Migration");

        var metadata = AsDict(root.GetValueOrDefault("metadata"))
            ?? throw new InvalidOperationException($"{relativePath}: metadata required");
        var spec = AsDict(root.GetValueOrDefault("spec"))
            ?? throw new InvalidOperationException($"{relativePath}: spec required");

        var id = metadata.GetValueOrDefault("id") as string
            ?? throw new InvalidOperationException($"{relativePath}: metadata.id required");
        var title = metadata.GetValueOrDefault("title") as string
            ?? throw new InvalidOperationException($"{relativePath}: metadata.title required");
        var description = metadata.GetValueOrDefault("description") as string;
        var stop = spec.GetValueOrDefault("stopHomeAssistant") as bool? ?? false;

        var preconditions = ParsePreconditions(spec.GetValueOrDefault("preconditions"), relativePath);
        var steps = ParseSteps(spec.GetValueOrDefault("steps"), relativePath);

        return new MigrationManifestDocument(
            id,
            title,
            description,
            stop,
            preconditions,
            steps,
            relativePath);
    }

    static IReadOnlyList<MigrationPreconditionDocument> ParsePreconditions(object? raw, string relativePath)
    {
        if (raw is not IList<object?> list)
            return [];

        var result = new List<MigrationPreconditionDocument>();
        for (var i = 0; i < list.Count; i++)
        {
            var item = AsDict(list[i]) ?? throw new InvalidOperationException($"{relativePath}: preconditions[{i}] invalid");
            var type = item.GetValueOrDefault("type") as string
                ?? throw new InvalidOperationException($"{relativePath}: preconditions[{i}].type required");
            result.Add(new MigrationPreconditionDocument(
                type,
                item.GetValueOrDefault("entityId") as string,
                item.GetValueOrDefault("path") as string,
                item.GetValueOrDefault("text") as string));
        }

        return result;
    }

    static IReadOnlyList<MigrationStepDocument> ParseSteps(object? raw, string relativePath)
    {
        if (raw is not IList<object?> list || list.Count == 0)
            throw new InvalidOperationException($"{relativePath}: spec.steps must contain at least one step");

        var result = new List<MigrationStepDocument>();
        for (var i = 0; i < list.Count; i++)
        {
            var item = AsDict(list[i]) ?? throw new InvalidOperationException($"{relativePath}: steps[{i}] invalid");
            var name = item.GetValueOrDefault("name") as string
                ?? throw new InvalidOperationException($"{relativePath}: steps[{i}].name required");
            var action = item.GetValueOrDefault("action") as string
                ?? throw new InvalidOperationException($"{relativePath}: steps[{i}].action required");
            var paramDict = AsDict(item.GetValueOrDefault("params")) ?? new Dictionary<string, object?>();
            result.Add(new MigrationStepDocument(name, action, paramDict));
        }

        return result;
    }

    static Dictionary<string, object?>? AsDict(object? value) => value as Dictionary<string, object?>;
}
