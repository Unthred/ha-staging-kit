using System.Text.Json;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed record ProdEntityRegistryEntry(
    string EntityId,
    string? Platform,
    string? UniqueId,
    string? DeviceId,
    string? DisabledBy = null);

public sealed record ProdDeletedRegistryEntry(
    string EntityId,
    string? UniqueId,
    string? Platform,
    string? CreatedAt);

public sealed record ProdRegistrySnapshot(
    IReadOnlyDictionary<string, ProdEntityRegistryEntry> ActiveEntities,
    IReadOnlySet<string> DeletedEntityIds,
    IReadOnlyList<ProdDeletedRegistryEntry> DeletedEntities,
    IReadOnlyDictionary<string, string> DeviceNames);

public sealed class ProdRegistryReader(KitPaths paths, GitSshConfigurator gitSsh)
{
    public async Task<ProdRegistrySnapshot?> ReadAsync(CancellationToken ct)
    {
        var target = ParseProdTarget();
        if (target is null)
            return null;

        var (userHost, configPath) = target.Value;
        var sshBase = SshBase();

        var entityJson = await ReadRemoteFileAsync(userHost, sshBase, $"{configPath}/.storage/core.entity_registry", ct);
        if (string.IsNullOrWhiteSpace(entityJson))
            return null;

        var deviceJson = await ReadRemoteFileAsync(userHost, sshBase, $"{configPath}/.storage/core.device_registry", ct);
        return Parse(entityJson, deviceJson);
    }

    static ProdRegistrySnapshot Parse(string entityRegistryJson, string? deviceRegistryJson)
    {
        var active = new Dictionary<string, ProdEntityRegistryEntry>(StringComparer.Ordinal);
        var deletedIds = new HashSet<string>(StringComparer.Ordinal);
        var deletedEntries = new List<ProdDeletedRegistryEntry>();

        try
        {
            using var doc = JsonDocument.Parse(entityRegistryJson);
            if (doc.RootElement.TryGetProperty("data", out var data))
            {
                if (data.TryGetProperty("entities", out var entities) && entities.ValueKind == JsonValueKind.Array)
                    ParseEntityArray(entities, active);

                if (data.TryGetProperty("deleted_entities", out var deletedEntities)
                    && deletedEntities.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in deletedEntities.EnumerateArray())
                    {
                        var id = ReadEntityId(item);
                        if (string.IsNullOrWhiteSpace(id))
                            continue;

                        deletedIds.Add(id);
                        deletedEntries.Add(new ProdDeletedRegistryEntry(
                            id,
                            ReadString(item, "unique_id"),
                            ReadString(item, "platform"),
                            ReadString(item, "created_at")));
                    }
                }
            }
        }
        catch (JsonException)
        {
            return new ProdRegistrySnapshot(
                active,
                deletedIds,
                deletedEntries,
                new Dictionary<string, string>(StringComparer.Ordinal));
        }

        var deviceNames = ParseDeviceNames(deviceRegistryJson);
        return new ProdRegistrySnapshot(active, deletedIds, deletedEntries, deviceNames);
    }

    /// <summary>
    /// Deleted registry tombstones for the same physical device as the git-expected entity id
    /// (matched by Zigbee/MQTT unique_id prefix). Invisible in HA UI but blocks reusing entity ids.
    /// </summary>
    public static IReadOnlyList<string> FindRelatedDeletedEntityIds(
        string gitEntityId,
        ProdRegistrySnapshot? registry) =>
        FindRelatedDeletedEntries(gitEntityId, registry).Select(e => e.EntityId).ToList();

    public static IReadOnlyList<ProdRegistryTombstoneDetail> FindRelatedDeletedEntries(
        string expectedEntityId,
        ProdRegistrySnapshot? registry)
    {
        if (registry is null || !registry.DeletedEntityIds.Contains(expectedEntityId))
            return [];

        var anchor = registry.DeletedEntities
            .FirstOrDefault(e => string.Equals(e.EntityId, expectedEntityId, StringComparison.Ordinal));
        var prefix = ExtractDeviceUniquePrefix(anchor?.UniqueId);
        if (string.IsNullOrWhiteSpace(prefix))
        {
            return
            [
                ToTombstoneDetail(new ProdDeletedRegistryEntry(
                    expectedEntityId,
                    anchor?.UniqueId,
                    anchor?.Platform,
                    anchor?.CreatedAt)),
            ];
        }

        return registry.DeletedEntities
            .Where(e => string.Equals(ExtractDeviceUniquePrefix(e.UniqueId), prefix, StringComparison.OrdinalIgnoreCase))
            .Select(e => ToTombstoneDetail(e))
            .OrderBy(e => e.EntityId, StringComparer.Ordinal)
            .ToList();
    }

    public static string? TombstoneDevicePrefix(string expectedEntityId, ProdRegistrySnapshot? registry)
    {
        if (registry is null || !registry.DeletedEntityIds.Contains(expectedEntityId))
            return null;

        var anchor = registry.DeletedEntities
            .FirstOrDefault(e => string.Equals(e.EntityId, expectedEntityId, StringComparison.Ordinal));
        return ExtractDeviceUniquePrefix(anchor?.UniqueId);
    }

    static ProdRegistryTombstoneDetail ToTombstoneDetail(ProdDeletedRegistryEntry entry) =>
        new(
            entry.EntityId,
            entry.UniqueId,
            entry.Platform,
            FormatCreatedAt(entry.CreatedAt),
            HumanizeEntityId(entry.EntityId));

    static string? FormatCreatedAt(string? createdAt)
    {
        if (string.IsNullOrWhiteSpace(createdAt))
            return null;
        if (DateTimeOffset.TryParse(createdAt, out var parsed))
            return parsed.ToString("d MMM yyyy");
        return createdAt;
    }

    static string HumanizeEntityId(string entityId)
    {
        var dot = entityId.IndexOf('.');
        var objectId = dot > 0 ? entityId[(dot + 1)..] : entityId;
        var tail = objectId.Contains('_')
            ? objectId[(objectId.LastIndexOf('_') + 1)..]
            : objectId;
        return tail switch
        {
            "contact" => "Door contact",
            "battery" => "Battery",
            "battery_low" => "Battery low",
            "voltage" => "Voltage",
            "linkquality" => "Link quality",
            "device_temperature" => "Device temperature",
            "power_outage_count" => "Power outage count",
            "trigger_count" => "Trigger count",
            _ => tail.Replace('_', ' '),
        };
    }

    static string? ExtractDeviceUniquePrefix(string? uniqueId)
    {
        if (string.IsNullOrWhiteSpace(uniqueId))
            return null;

        var idx = uniqueId.IndexOf('_', StringComparison.Ordinal);
        return idx > 0 ? uniqueId[..idx] : uniqueId;
    }

    public static string? ExtractDeviceUniquePrefixPublic(string? uniqueId) =>
        ExtractDeviceUniquePrefix(uniqueId);

    static void ParseEntityArray(JsonElement entities, IDictionary<string, ProdEntityRegistryEntry> active)
    {
        foreach (var item in entities.EnumerateArray())
        {
            var entityId = ReadEntityId(item);
            if (string.IsNullOrWhiteSpace(entityId))
                continue;

            active[entityId] = new ProdEntityRegistryEntry(
                entityId,
                ReadString(item, "platform"),
                ReadString(item, "unique_id"),
                ReadString(item, "device_id"),
                ReadString(item, "disabled_by"));
        }
    }

    static Dictionary<string, string> ParseDeviceNames(string? deviceRegistryJson)
    {
        var names = new Dictionary<string, string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(deviceRegistryJson))
            return names;

        try
        {
            using var doc = JsonDocument.Parse(deviceRegistryJson);
            if (!doc.RootElement.TryGetProperty("data", out var data)
                || !data.TryGetProperty("devices", out var devices)
                || devices.ValueKind != JsonValueKind.Array)
            {
                return names;
            }

            foreach (var device in devices.EnumerateArray())
            {
                var id = ReadString(device, "id");
                var name = ReadString(device, "name");
                if (!string.IsNullOrWhiteSpace(id) && !string.IsNullOrWhiteSpace(name))
                    names[id] = name!;
            }
        }
        catch (JsonException)
        {
            /* best effort */
        }

        return names;
    }

    async Task<string?> ReadRemoteFileAsync(
        string userHost,
        string sshBase,
        string remotePath,
        CancellationToken ct)
    {
        var remoteCmd = ShQ($"sudo cat {remotePath} 2>/dev/null");
        var (ok, stdout, _) = await RunBashAsync($"ssh {sshBase} {ShQ(userHost)} {remoteCmd}", ct);
        return ok && !string.IsNullOrWhiteSpace(stdout) ? stdout : null;
    }

    (string UserHost, string ConfigPath)? ParseProdTarget()
    {
        var haSecrets = EnvFile.Get(paths.EnvFile, "HA_SECRETS") ?? "";
        if (string.IsNullOrWhiteSpace(haSecrets))
            return null;

        var colonIdx = haSecrets.IndexOf(':');
        var userHost = colonIdx > 0 ? haSecrets[..colonIdx] : haSecrets;
        var remotePath = colonIdx > 0 ? haSecrets[(colonIdx + 1)..] : "";
        var configPath = remotePath.EndsWith("/secrets.yaml", StringComparison.OrdinalIgnoreCase)
            ? remotePath[..^"/secrets.yaml".Length]
            : remotePath.TrimEnd('/');

        if (string.IsNullOrWhiteSpace(configPath))
            configPath = "/config";
        if (!userHost.Contains('@'))
            userHost = $"root@{userHost}";
        return (userHost, configPath);
    }

    string SshBase() =>
        $"-i {ShQ(paths.SshKeyFile)} -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30";

    static string ShQ(string s) => "'" + s.Replace("'", "'\\''") + "'";

    async Task<(bool Ok, string Stdout, string Stderr)> RunBashAsync(string script, CancellationToken ct)
    {
        var psi = new System.Diagnostics.ProcessStartInfo("bash")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        psi.ArgumentList.Add("-c");
        psi.ArgumentList.Add(script);
        gitSsh.Apply(psi);
        using var proc = System.Diagnostics.Process.Start(psi)
            ?? throw new InvalidOperationException("Failed to start bash");
        var stdoutTask = proc.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        return (proc.ExitCode == 0, (await stdoutTask).Trim(), (await stderrTask).Trim());
    }

    static string? ReadEntityId(JsonElement item) => ReadString(item, "entity_id");

    static string? ReadString(JsonElement item, string property) =>
        item.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}

static class IntegrationFixHints
{
    public static string Build(
        string issueClass,
        string gitEntityId,
        string? similarProdEntity,
        ProdEntityRegistryEntry? prodEntry,
        ProdRegistrySnapshot? registry)
    {
        if (issueClass == "git_wrong_name")
        {
            return similarProdEntity is null
                ? "Rename this entity on the dashboard to match prod."
                : $"Dashboard uses `{gitEntityId}` but prod has `{similarProdEntity}`. Use **Rename** below.";
        }

        if (issueClass is "prod_typo" or "missing_on_prod")
        {
            var prodId = similarProdEntity ?? prodEntry?.EntityId;
            var parts = new List<string>
            {
                $"The deploy dashboard expects `{gitEntityId}` but prod does not expose that entity yet.",
            };

            if (!string.IsNullOrWhiteSpace(prodId))
                parts.Add($"Prod currently has `{prodId}`.");

            if (prodEntry?.UniqueId is not null
                && string.Equals(
                    prodEntry.UniqueId,
                    EntityObjectId(gitEntityId),
                    StringComparison.OrdinalIgnoreCase))
            {
                parts.Add(
                    $"Prod **entity_id** is wrong — registry **unique_id** `{prodEntry.UniqueId}` matches the dashboard. Use **Fix entity id on prod** below (HA Settings → Entities cannot rename this entity).");
            }
            else if (registry?.DeletedEntityIds.Contains(gitEntityId) == true)
            {
                parts.Add(
                    "An old removed sensor still reserves that name in prod's hidden registry — use **Purge removed sensor records** below, then rename the live prod entity. (Storage sync only updates staging; it will not clear this.)");
            }

            parts.Add(BuildIntegrationHint(prodEntry, gitEntityId));
            parts.Add("When finished, click **Recheck**.");
            return string.Join(" ", parts);
        }

        if (issueClass == "staging_only")
        {
            return "On staging but not on prod. Remove the dashboard card, add the device on prod then sync storage, or defer.";
        }

        return "Review this entity reference before deploying.";
    }

    public static string BuildIntegrationHint(ProdEntityRegistryEntry? entry, string? expectedEntityId = null)
    {
        if (entry is null)
        {
            return "Fix on prod Home Assistant (Settings → Entities) and in whichever integration created this device.";
        }

        var platform = entry.Platform?.Trim().ToLowerInvariant() ?? "unknown";
        var uniqueId = entry.UniqueId ?? "";
        var expectedObject = string.IsNullOrWhiteSpace(expectedEntityId)
            ? null
            : EntityObjectId(expectedEntityId);
        if (!string.IsNullOrWhiteSpace(uniqueId)
            && !string.IsNullOrWhiteSpace(expectedObject)
            && string.Equals(uniqueId, expectedObject, StringComparison.OrdinalIgnoreCase))
        {
            return platform switch
            {
                "timer" =>
                    "Timer platform — entity_id is fixed in core.entity_registry (use **Fix entity id on prod** above; not available in Settings → Entities).",
                _ =>
                    $"Platform `{platform}` — entity_id mismatch; use **Fix entity id on prod** above if Settings → Entities has no rename.",
            };
        }

        if (platform == "mqtt" && uniqueId.Contains("zigbee2mqtt", StringComparison.OrdinalIgnoreCase))
        {
            return "Likely **Zigbee2MQTT** — rename the device/friendly name there first, then confirm under prod HA → Settings → Entities.";
        }

        if (platform == "mqtt")
        {
            return "Likely an **MQTT** device — rename it in your MQTT integration or published discovery name, then confirm in prod HA.";
        }

        if (platform == "zha")
            return "Likely **ZHA** — rename under ZHA → Manage devices, then confirm in prod HA.";

        if (platform == "esphome")
            return "Likely **ESPHome** — update the device name/id in ESPHome, reload or reflash, then confirm in prod HA.";

        if (platform == "tasmota")
            return "Likely **Tasmota** — fix FriendlyName/topic at the device or bridge, then confirm in prod HA.";

        return $"Platform `{platform}` — fix the device name in that integration and prod HA (Settings → Entities).";
    }

    static string EntityObjectId(string entityId)
    {
        var dot = entityId.IndexOf('.');
        return dot > 0 ? entityId[(dot + 1)..] : entityId;
    }
}
