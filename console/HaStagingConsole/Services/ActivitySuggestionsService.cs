using System.Net.Http.Headers;
using System.Text.Json;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class ActivitySuggestionsService(
    KitPaths paths,
    OnboardingBootstrap bootstrap,
    IHttpClientFactory httpClientFactory,
    ILogger<ActivitySuggestionsService> logger)
{
    static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(5);
    static readonly string[] Domains = ["automation", "script"];

    readonly object _cacheLock = new();
    ActivitySuggestionsSnapshot? _cached;
    DateTimeOffset _cachedAt;

    public async Task<ActivitySuggestionsSnapshot> GetSuggestionsAsync(CancellationToken ct)
    {
        lock (_cacheLock)
        {
            if (_cached is not null && DateTimeOffset.UtcNow - _cachedAt < CacheTtl)
                return _cached;
        }

        var snapshot = await FetchAsync(ct).ConfigureAwait(false);
        lock (_cacheLock)
        {
            _cached = snapshot;
            _cachedAt = DateTimeOffset.UtcNow;
        }

        return snapshot;
    }

    async Task<ActivitySuggestionsSnapshot> FetchAsync(CancellationToken ct)
    {
        var env = EnvFile.Read(paths.EnvFile);
        var state = bootstrap.LoadOrBootstrap();

        var prodTask = FetchInstanceEntitiesAsync(
            FirstNonEmpty(env.GetValueOrDefault("PROD_HA_URL"), state.Prod.Url),
            paths.ProdTokenFile,
            "prod",
            ct);
        var stagingTask = FetchInstanceEntitiesAsync(
            FirstNonEmpty(env.GetValueOrDefault("STAGING_HA_URL"), state.Staging.Url),
            paths.StagingTokenFile,
            "staging",
            ct);

        await Task.WhenAll(prodTask, stagingTask).ConfigureAwait(false);

        var prod = prodTask.Result;
        var staging = stagingTask.Result;
        var merged = new Dictionary<string, (string Name, string Domain, HashSet<string> Instances)>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in prod.Items.Concat(staging.Items))
        {
            if (!merged.TryGetValue(item.EntityId, out var existing))
            {
                merged[item.EntityId] = (item.Name, item.Domain, [item.Instance]);
                continue;
            }

            existing.Instances.Add(item.Instance);
            if (existing.Name == item.EntityId && item.Name != item.EntityId)
                merged[item.EntityId] = (item.Name, item.Domain, existing.Instances);
        }

        var suggestions = merged
            .Select(pair => new ActivityEntitySuggestion(
                pair.Key,
                pair.Value.Name,
                pair.Value.Domain,
                pair.Value.Instances.Order(StringComparer.Ordinal).ToList()))
            .OrderBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(s => s.EntityId, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new ActivitySuggestionsSnapshot(
            suggestions,
            suggestions.Count(s => s.Domain == "automation"),
            suggestions.Count(s => s.Domain == "script"),
            prod.Available,
            staging.Available,
            DateTimeOffset.UtcNow);
    }

    async Task<(bool Available, List<(string EntityId, string Name, string Domain, string Instance)> Items)> FetchInstanceEntitiesAsync(
        string? url,
        string tokenFile,
        string instance,
        CancellationToken ct)
    {
        var items = new List<(string EntityId, string Name, string Domain, string Instance)>();
        if (string.IsNullOrWhiteSpace(url))
            return (false, items);

        var (tokenUrl, token) = TokenFile.Read(tokenFile);
        url = FirstNonEmpty(url, tokenUrl);
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(token))
            return (false, items);

        try
        {
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(8);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await client.GetAsync($"{url.TrimEnd('/')}/api/states", ct).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
                return (false, items);

            await using var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct).ConfigureAwait(false);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                return (false, items);

            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (!item.TryGetProperty("entity_id", out var idProp))
                    continue;
                var entityId = idProp.GetString();
                if (string.IsNullOrWhiteSpace(entityId))
                    continue;

                var domain = entityId.Split('.', 2)[0];
                if (!Domains.Contains(domain, StringComparer.OrdinalIgnoreCase))
                    continue;

                var name = entityId;
                if (item.TryGetProperty("attributes", out var attrs)
                    && attrs.TryGetProperty("friendly_name", out var nameProp)
                    && nameProp.ValueKind == JsonValueKind.String)
                {
                    var friendly = nameProp.GetString();
                    if (!string.IsNullOrWhiteSpace(friendly))
                        name = friendly.Trim();
                }

                items.Add((entityId, name, domain, instance));
            }

            return (true, items);
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "Failed to fetch activity suggestions from {Instance}", instance);
            return (false, items);
        }
    }

    static string? FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
                return value.Trim();
        }

        return null;
    }
}
