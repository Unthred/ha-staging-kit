using System.Net.Http.Headers;
using System.Text.Json;

namespace HaStagingConsole.Services;

/// <summary>
/// After staging HA restart: disable LAN integrations (preserve registry) and remove broken domains.
/// </summary>
public sealed class StagingQuiesceService(
    KitPaths paths,
    HaConfigEntryAdminClient configEntryAdmin,
    IHttpClientFactory httpClientFactory,
    ILogger<StagingQuiesceService> logger)
{
    static readonly string[] DisableDomains =
    [
        "esphome", "cast", "broadlink", "androidtv", "androidtv_remote", "reolink",
        "govee_light_local", "fing", "heatmiserneo", "dlna_dmr", "dlna_dms", "ipp",
        "syncthru", "volumio", "go2rtc", "homekit_controller", "tasmota", "yamaha",
        "yamaha_musiccast"
    ];

    static readonly string[] DeleteDomains =
    [
        "analytics", "wyoming", "zwave_js", "homeassistant_sky_connect", "localtuya"
    ];

    public async Task<(bool Ok, string LogTail)> QuiesceAsync(CancellationToken ct)
    {
        var logs = new List<string>();
        var (url, token) = TokenFile.Read(paths.StagingTokenFile);
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(token))
        {
            logs.Add("WARN: missing staging API token — skip integration quiesce");
            return (true, string.Join('\n', logs));
        }

        if (!await WaitForHaAsync(url, ct))
        {
            logs.Add("WARN: staging HA not reachable — skip integration quiesce");
            return (true, string.Join('\n', logs));
        }

        await Task.Delay(TimeSpan.FromSeconds(5), ct);

        var entries = await ListConfigEntriesAsync(url, token, ct);
        if (entries is null)
        {
            logs.Add("WARN: could not list staging config entries");
            return (true, string.Join('\n', logs));
        }

        var oauthDomains = (EnvFile.Get(paths.ConfigEnvFile, "OAUTH_PRESERVE_DOMAINS") ?? "smartthings tuya")
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var toDisable = entries
            .Where(e => DisableDomains.Contains(e.Domain, StringComparer.OrdinalIgnoreCase)
                        && !oauthDomains.Contains(e.Domain)
                        && e.State is "loaded" or "setup" or "setup_retry" or "setup_error" or "setup_in_progress")
            .Select(e => e.EntryId)
            .Distinct()
            .ToList();

        if (toDisable.Count > 0)
        {
            var (disabled, disableLogs) = await configEntryAdmin.DisableConfigEntriesAsync(url, token, toDisable, ct);
            logs.AddRange(disableLogs);
            logs.Add($"Disabled {disabled} LAN config entr(y/ies) on staging (registry preserved)");
        }
        else
        {
            logs.Add("No LAN config entries need disable on staging");
        }

        var removed = 0;
        foreach (var entry in entries)
        {
            if (!DeleteDomains.Contains(entry.Domain, StringComparer.OrdinalIgnoreCase)
                || oauthDomains.Contains(entry.Domain))
                continue;

            if (await DeleteConfigEntryAsync(url, token, entry.EntryId, ct))
            {
                logs.Add($"Removed config entry {entry.EntryId} ({entry.Domain})");
                removed++;
            }
            else
                logs.Add($"WARN: failed to remove config entry {entry.EntryId} ({entry.Domain})");
        }

        if (removed > 0)
            logs.Add($"Removed {removed} staging-unsafe config entr(y/ies) via API");

        logger.LogInformation("Staging quiesce complete — disabled {Disable}, removed {Remove}", toDisable.Count, removed);
        return (true, string.Join('\n', logs));
    }

    async Task<bool> WaitForHaAsync(string url, CancellationToken ct)
    {
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(3);
        for (var i = 0; i < 90; i++)
        {
            try
            {
                using var response = await client.GetAsync($"{url.TrimEnd('/')}/", ct);
                if (response.IsSuccessStatusCode)
                    return true;
            }
            catch
            {
                /* retry */
            }

            await Task.Delay(TimeSpan.FromSeconds(2), ct);
        }

        return false;
    }

    async Task<IReadOnlyList<ConfigEntryRow>?> ListConfigEntriesAsync(string url, string token, CancellationToken ct)
    {
        try
        {
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(15);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await client.GetAsync($"{url.TrimEnd('/')}/api/config/config_entries/entry", ct);
            if (!response.IsSuccessStatusCode)
                return null;

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                return null;

            var rows = new List<ConfigEntryRow>();
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                var entryId = item.TryGetProperty("entry_id", out var idProp) ? idProp.GetString() : null;
                var domain = item.TryGetProperty("domain", out var domainProp) ? domainProp.GetString() : null;
                var state = item.TryGetProperty("state", out var stateProp) ? stateProp.GetString() : null;
                if (string.IsNullOrWhiteSpace(entryId) || string.IsNullOrWhiteSpace(domain))
                    continue;
                rows.Add(new ConfigEntryRow(entryId, domain, state ?? ""));
            }

            return rows;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "List staging config entries failed");
            return null;
        }
    }

    async Task<bool> DeleteConfigEntryAsync(string url, string token, string entryId, CancellationToken ct)
    {
        try
        {
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(15);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await client.DeleteAsync($"{url.TrimEnd('/')}/api/config/config_entries/entry/{entryId}", ct);
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    sealed record ConfigEntryRow(string EntryId, string Domain, string State);
}
