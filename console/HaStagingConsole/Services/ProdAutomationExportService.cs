using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using YamlDotNet.Serialization;

namespace HaStagingConsole.Services;

/// <summary>
/// Export all prod HA automations (including UI-only) into git automations.yaml during baseline.
/// </summary>
public sealed class ProdAutomationExportService(
    KitPaths paths,
    HaWebSocketClient webSocket,
    IHttpClientFactory httpClientFactory,
    ILogger<ProdAutomationExportService> logger)
{
    const string RepoAutomationsPath = "/repo/automations.yaml";

    public async Task<(bool Ok, string Message)> ExportToRepoAsync(CancellationToken ct)
    {
        if (!File.Exists(RepoAutomationsPath))
            return (false, "automations.yaml missing in git repo after prod rsync");

        var (url, token) = TokenFile.Read(paths.ProdTokenFile);
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(token))
            return (false, "Prod API token not configured — cannot export UI automations");

        var automations = await FetchProdAutomationConfigsAsync(url, token, ct);
        if (automations.Count == 0)
            return (true, "No prod automations returned from HA — kept rsynced automations.yaml");

        var merged = MergeAutomationConfigs(automations);
        var yaml = SerializeAutomations(merged);
        await File.WriteAllTextAsync(RepoAutomationsPath, yaml, ct);
        logger.LogInformation("Exported {Count} prod automation(s) into {Path}", merged.Count, RepoAutomationsPath);
        return (true, $"Exported {merged.Count} automation(s) from prod HA into git (includes UI-only automations)");
    }

    async Task<List<Dictionary<string, object?>>> FetchProdAutomationConfigsAsync(
        string url,
        string token,
        CancellationToken ct)
    {
        var entities = await ListAutomationEntitiesAsync(url, token, ct);
        var configs = new List<Dictionary<string, object?>>();

        foreach (var (entityId, automationId) in entities)
        {
            var config = await TryFetchAutomationConfigAsync(url, token, entityId, automationId, ct);
            if (config is null)
            {
                logger.LogWarning("Could not export automation config for {EntityId} (id={AutomationId})", entityId, automationId);
                continue;
            }

            if (!config.ContainsKey("id"))
                config["id"] = automationId;
            configs.Add(config);
        }

        return configs;
    }

    async Task<List<(string EntityId, string AutomationId)>> ListAutomationEntitiesAsync(
        string url,
        string token,
        CancellationToken ct)
    {
        var rows = new List<(string, string)>();
        try
        {
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(30);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await client.GetAsync($"{url.TrimEnd('/')}/api/states", ct);
            if (!response.IsSuccessStatusCode)
                return rows;

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                return rows;

            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (!item.TryGetProperty("entity_id", out var idProp))
                    continue;
                var entityId = idProp.GetString();
                if (string.IsNullOrWhiteSpace(entityId) || !entityId.StartsWith("automation.", StringComparison.Ordinal))
                    continue;

                var attrs = item.TryGetProperty("attributes", out var attrsProp) ? attrsProp : default;
                var automationId = entityId["automation.".Length..];
                if (attrs.ValueKind == JsonValueKind.Object && attrs.TryGetProperty("id", out var autoIdProp))
                {
                    var fromAttr = autoIdProp.ToString();
                    if (!string.IsNullOrWhiteSpace(fromAttr))
                        automationId = fromAttr.Trim('"');
                }

                rows.Add((entityId, automationId));
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "List prod automation entities failed");
        }

        return rows;
    }

    async Task<Dictionary<string, object?>?> TryFetchAutomationConfigAsync(
        string url,
        string token,
        string entityId,
        string automationId,
        CancellationToken ct)
    {
        var attempts = new (string Type, Dictionary<string, object?> Payload)[]
        {
            ("automation/config", new Dictionary<string, object?> { ["entity_id"] = entityId }),
            ("config/automation/config", new Dictionary<string, object?> { ["entity_id"] = entityId }),
            ("automation/config", new Dictionary<string, object?> { ["automation_id"] = automationId }),
            ("config/automation/config", new Dictionary<string, object?> { ["automation_id"] = automationId }),
            ("config/automation/config", new Dictionary<string, object?> { ["id"] = automationId }),
        };

        foreach (var (type, payload) in attempts)
        {
            var result = await webSocket.RequestAsync(url, token, type, payload, ct);
            if (result is null || result.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
                continue;

            var config = JsonElementToDictionary(result.Value);
            if (config.Count > 0)
                return config;
        }

        return null;
    }

    static List<Dictionary<string, object?>> MergeAutomationConfigs(IReadOnlyList<Dictionary<string, object?>> prodConfigs)
    {
        var byId = new Dictionary<string, Dictionary<string, object?>>(StringComparer.Ordinal);
        if (File.Exists(RepoAutomationsPath))
        {
            foreach (var existing in DeserializeAutomations(File.ReadAllText(RepoAutomationsPath)))
            {
                var id = GetAutomationId(existing);
                if (!string.IsNullOrWhiteSpace(id))
                    byId[id] = existing;
            }
        }

        foreach (var config in prodConfigs)
        {
            var id = GetAutomationId(config);
            if (string.IsNullOrWhiteSpace(id))
                continue;
            byId[id] = config;
        }

        return byId.Values
            .OrderBy(c => GetAutomationAlias(c), StringComparer.OrdinalIgnoreCase)
            .ThenBy(c => GetAutomationId(c), StringComparer.Ordinal)
            .ToList();
    }

    static string SerializeAutomations(IReadOnlyList<Dictionary<string, object?>> automations)
    {
        var serializer = new SerializerBuilder()
            .ConfigureDefaultValuesHandling(DefaultValuesHandling.OmitNull)
            .Build();
        var sb = new StringBuilder();
        foreach (var automation in automations)
        {
            var block = serializer.Serialize(automation).TrimEnd();
            sb.Append("- ");
            sb.AppendLine(block.Replace("\n", "\n  ", StringComparison.Ordinal));
        }

        return sb.ToString().TrimEnd() + Environment.NewLine;
    }

    static List<Dictionary<string, object?>> DeserializeAutomations(string yaml)
    {
        if (string.IsNullOrWhiteSpace(yaml))
            return [];

        try
        {
            var deserializer = new DeserializerBuilder()
                .IgnoreUnmatchedProperties()
                .Build();
            var parsed = deserializer.Deserialize<object?>(yaml);
            if (parsed is List<object?> list)
            {
                return list
                    .Select(JsonElementToDictionaryFromObject)
                    .Where(d => d.Count > 0)
                    .ToList();
            }
        }
        catch
        {
            /* fall through — prod export replaces on failure */
        }

        return [];
    }

    static Dictionary<string, object?> JsonElementToDictionary(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty("config", out var configProp))
            return JsonElementToDictionary(configProp);

        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty("raw_config", out var rawProp))
            return JsonElementToDictionary(rawProp);

        return JsonElementToDictionaryFromObject(JsonSerializer.Deserialize<object?>(element.GetRawText()));
    }

    static Dictionary<string, object?> JsonElementToDictionaryFromObject(object? value)
    {
        var json = JsonSerializer.Serialize(value);
        using var doc = JsonDocument.Parse(json);
        return FlattenDictionary(doc.RootElement);
    }

    static Dictionary<string, object?> FlattenDictionary(JsonElement element)
    {
        var dict = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        if (element.ValueKind != JsonValueKind.Object)
            return dict;

        foreach (var prop in element.EnumerateObject())
            dict[prop.Name] = JsonElementToObject(prop.Value);

        return dict;
    }

    static object? JsonElementToObject(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Object => FlattenDictionary(element),
        JsonValueKind.Array => element.EnumerateArray().Select(JsonElementToObject).ToList(),
        JsonValueKind.String => element.GetString(),
        JsonValueKind.Number => element.TryGetInt64(out var l) ? l : element.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => null,
        _ => element.GetRawText(),
    };

    static string? GetAutomationId(IReadOnlyDictionary<string, object?> config)
    {
        if (!config.TryGetValue("id", out var id) || id is null)
            return null;
        return id.ToString();
    }

    static string GetAutomationAlias(IReadOnlyDictionary<string, object?> config) =>
        config.TryGetValue("alias", out var alias) && alias is not null ? alias.ToString() ?? "" : "";
}
