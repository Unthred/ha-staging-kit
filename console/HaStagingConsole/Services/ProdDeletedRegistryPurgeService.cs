using System.Text.Json;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

/// <summary>
/// Removes tombstoned entries from prod core.entity_registry deleted_entities only.
/// User-initiated fix when a replaced device blocks reusing an entity id.
/// Must stop HA before editing .storage — in-memory registry overwrites file on shutdown.
/// </summary>
public sealed class ProdDeletedRegistryPurgeService(
    KitPaths paths,
    ProdRegistryReader prodRegistry,
    GitSshConfigurator gitSsh,
    IHttpClientFactory httpClientFactory)
{
    public async Task<OperationResult> PurgeDeletedEntitiesAsync(
        string expectedEntityId,
        string? similarProdEntityId,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(expectedEntityId))
            return new OperationResult(false, "Entity id is required", null);

        var registry = await prodRegistry.ReadAsync(ct);
        if (registry is null)
            return new OperationResult(false, "Could not read prod entity registry — check prod SSH settings", null);

        var trimmed = expectedEntityId.Trim();
        var toRemove = ProdRegistryReader.FindRelatedDeletedEntityIds(trimmed, registry);
        if (toRemove.Count == 0)
        {
            return new OperationResult(
                false,
                $"No deleted registry tombstones found for `{trimmed}` on prod",
                null);
        }

        var tombstonePrefix = ProdRegistryReader.TombstoneDevicePrefix(trimmed, registry);
        string? livePrefix = null;
        if (!string.IsNullOrWhiteSpace(similarProdEntityId)
            && registry.ActiveEntities.TryGetValue(similarProdEntityId.Trim(), out var liveEntry))
        {
            livePrefix = ProdRegistryReader.ExtractDeviceUniquePrefixPublic(liveEntry.UniqueId);
        }

        if (!string.IsNullOrWhiteSpace(livePrefix)
            && !string.IsNullOrWhiteSpace(tombstonePrefix)
            && string.Equals(livePrefix, tombstonePrefix, StringComparison.OrdinalIgnoreCase))
        {
            return new OperationResult(
                false,
                "Refusing to purge — tombstones share the same hardware id as the live prod sensor. Verify the expected entity id before purging.",
                null);
        }

        foreach (var entityId in toRemove)
        {
            if (registry.ActiveEntities.ContainsKey(entityId))
            {
                return new OperationResult(
                    false,
                    $"Refusing to purge `{entityId}` — it is an active prod entity, not deleted",
                    null);
            }
        }

        var target = ParseProdTarget();
        if (target is null)
            return new OperationResult(false, "Prod SSH not configured — set SSH target in Settings", null);
        if (!File.Exists(paths.SshKeyFile))
            return new OperationResult(false, "SSH key not found — add id_ed25519 to the kit secrets directory", null);

        var (userHost, configPath) = target.Value;
        var registryPath = $"{configPath}/.storage/core.entity_registry";
        var sshBase = SshBase();
        var idsJson = JsonSerializer.Serialize(toRemove);

        var stop = await StopProdHaAsync(ct);
        if (!stop.Ok)
            return new OperationResult(false, "Could not stop prod HA before registry edit", stop.LogTail);

        var waitDown = await WaitForProdHaDownAsync(ct);
        if (!waitDown.Ok)
            return new OperationResult(false, waitDown.Message, waitDown.LogTail);

        var remoteScript =
            "import json, shutil\n" +
            $"path = {JsonSerializer.Serialize(registryPath)}\n" +
            $"ids = set(json.loads({JsonSerializer.Serialize(idsJson)}))\n" +
            "backup = path + '.bak-kit-purge'\n" +
            "shutil.copy2(path, backup)\n" +
            "data = json.load(open(path))\n" +
            "active_ids = {e.get('entity_id') for e in data.get('data', {}).get('entities', []) if e.get('entity_id')}\n" +
            "deleted = data.get('data', {}).get('deleted_entities', [])\n" +
            "before = len(deleted)\n" +
            "data['data']['deleted_entities'] = [\n" +
            "    e for e in deleted\n" +
            "    if e.get('entity_id') not in ids and e.get('entity_id') not in active_ids\n" +
            "]\n" +
            "removed = before - len(data['data']['deleted_entities'])\n" +
            "with open(path, 'w', encoding='utf-8') as f:\n" +
            "    json.dump(data, f, indent=2)\n" +
            "    f.write('\\n')\n" +
            "print(f'REMOVED={removed}')\n" +
            "print(f'BACKUP={backup}')\n";

        var remoteCmd = ShQ($"sudo python3 -c {ShQ(remoteScript)}");
        var (purgeOk, purgeOut, purgeErr) = await RunBashAsync(
            $"ssh {sshBase} {ShQ(userHost)} {remoteCmd}",
            ct);
        if (!purgeOk)
        {
            await StartProdHaAsync(userHost, sshBase, ct);
            return new OperationResult(
                false,
                "Failed to purge deleted entities on prod",
                string.IsNullOrWhiteSpace(purgeErr) ? purgeOut : purgeErr);
        }

        var start = await StartProdHaAsync(userHost, sshBase, ct);
        var logs = new List<string>
        {
            "Stopped prod HA before editing entity registry (required for .storage changes to persist).",
            $"Purged {toRemove.Count} deleted registry tombstone(s) from prod:",
            string.Join(", ", toRemove),
            purgeOut.Trim(),
            start.Message,
        };

        if (!start.Ok)
            return new OperationResult(false, "Purged registry but prod HA start failed — start core manually from HA OS terminal", JoinLogs(logs, start.LogTail));

        return new OperationResult(
            true,
            $"Purged {toRemove.Count} deleted registry tombstone(s) on prod and restarted HA. Next: rename the live prod entity to `{trimmed}` in Settings → Entities (or Z2M with Update HA entity id), then Recheck.",
            JoinLogs(logs, start.LogTail));
    }

    async Task<OperationResult> StopProdHaAsync(CancellationToken ct)
    {
        var (prodUrl, prodToken) = TokenFile.Read(paths.ProdTokenFile);
        if (string.IsNullOrWhiteSpace(prodUrl) || string.IsNullOrWhiteSpace(prodToken))
            return new OperationResult(false, "Prod HA token not configured — add prod.token to kit secrets", null);

        try
        {
            using var http = httpClientFactory.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(120);
            using var req = new HttpRequestMessage(
                HttpMethod.Post,
                $"{prodUrl.TrimEnd('/')}/api/services/homeassistant/stop");
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", prodToken);
            req.Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
            using var resp = await http.SendAsync(req, ct);
            if (resp.IsSuccessStatusCode || (int)resp.StatusCode == 504)
                return new OperationResult(true, "Prod HA stop requested", null);
            return new OperationResult(false, $"Prod HA stop returned HTTP {(int)resp.StatusCode}", null);
        }
        catch (Exception ex) when (ex is TaskCanceledException or HttpRequestException)
        {
            return new OperationResult(true, "Prod HA stop requested (connection dropped — normal during stop)", null);
        }
        catch (Exception ex)
        {
            return new OperationResult(false, $"Prod HA stop failed: {ex.Message}", null);
        }
    }

    async Task<OperationResult> WaitForProdHaDownAsync(CancellationToken ct)
    {
        var (prodUrl, prodToken) = TokenFile.Read(paths.ProdTokenFile);
        if (string.IsNullOrWhiteSpace(prodUrl))
            return new OperationResult(false, "Prod HA URL not configured", null);

        for (var attempt = 0; attempt < 30; attempt++)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                using var http = httpClientFactory.CreateClient();
                http.Timeout = TimeSpan.FromSeconds(3);
                using var req = new HttpRequestMessage(HttpMethod.Get, $"{prodUrl.TrimEnd('/')}/api/");
                if (!string.IsNullOrWhiteSpace(prodToken))
                    req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", prodToken);
                using var resp = await http.SendAsync(req, ct);
                if (!resp.IsSuccessStatusCode)
                    return new OperationResult(true, "Prod HA API is down — safe to edit registry", null);
            }
            catch (Exception) when (attempt < 29)
            {
                return new OperationResult(true, "Prod HA API is down — safe to edit registry", null);
            }

            await Task.Delay(TimeSpan.FromSeconds(2), ct);
        }

        return new OperationResult(false, "Timed out waiting for prod HA to stop — registry was not edited", null);
    }

    async Task<OperationResult> StartProdHaAsync(string userHost, string sshBase, CancellationToken ct)
    {
        // HA OS host shell (not the SSH add-on) — required for ha core start without a CLI token.
        var (startOk, startOut, startErr) = await RunBashAsync(
            $"ssh {sshBase} {ShQ(userHost)} {ShQ("sudo bash -lc \"ha core start\"")}",
            ct);
        if (!startOk)
        {
            return new OperationResult(
                false,
                "Failed to start prod HA core",
                string.IsNullOrWhiteSpace(startErr) ? startOut : startErr);
        }

        var (prodUrl, prodToken) = TokenFile.Read(paths.ProdTokenFile);
        if (string.IsNullOrWhiteSpace(prodUrl))
            return new OperationResult(true, "Prod HA core start requested", startOut);

        for (var attempt = 0; attempt < 60; attempt++)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                using var http = httpClientFactory.CreateClient();
                http.Timeout = TimeSpan.FromSeconds(5);
                using var req = new HttpRequestMessage(HttpMethod.Get, $"{prodUrl.TrimEnd('/')}/api/");
                if (!string.IsNullOrWhiteSpace(prodToken))
                    req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", prodToken);
                using var resp = await http.SendAsync(req, ct);
                if (resp.IsSuccessStatusCode)
                    return new OperationResult(true, "Prod HA restarted to load registry changes", startOut);
            }
            catch (Exception) when (attempt < 59)
            {
                // still booting
            }

            await Task.Delay(TimeSpan.FromSeconds(3), ct);
        }

        return new OperationResult(false, "Prod HA core start was issued but API did not come back in time", startOut);
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

    static string JoinLogs(IReadOnlyList<string> logs, string? tail)
    {
        var parts = logs.Where(l => !string.IsNullOrWhiteSpace(l)).ToList();
        if (!string.IsNullOrWhiteSpace(tail))
            parts.Add(tail.Trim());
        return parts.Count == 0 ? null! : string.Join("\n", parts);
    }

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
}
