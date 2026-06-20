using System.Text.Json;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

/// <summary>
/// Frees a prod entity id blocked by a stale duplicate (e.g. disabled DLNA) and renames the live `_2` entity.
/// Stops prod HA before editing core.entity_registry — same persistence rules as tombstone purge.
/// </summary>
public sealed class ProdEntitySuffixFixService(
    KitPaths paths,
    ProdRegistryReader prodRegistry,
    GitSshConfigurator gitSsh,
    IHttpClientFactory httpClientFactory)
{
    public async Task<OperationResult> FixSuffixCollisionAsync(
        string expectedEntityId,
        string suffixProdEntityId,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(expectedEntityId) || string.IsNullOrWhiteSpace(suffixProdEntityId))
            return new OperationResult(false, "Expected and suffix prod entity ids are required", null);

        var expected = expectedEntityId.Trim();
        var suffix = suffixProdEntityId.Trim();
        if (!suffix.StartsWith($"{expected}_", StringComparison.Ordinal))
        {
            return new OperationResult(
                false,
                $"Suffix entity `{suffix}` does not match expected pattern `{expected}_*`",
                null);
        }

        var registry = await prodRegistry.ReadAsync(ct);
        if (registry is null)
            return new OperationResult(false, "Could not read prod entity registry — check prod SSH settings", null);

        if (!registry.ActiveEntities.TryGetValue(expected, out var blocker))
        {
            return new OperationResult(
                false,
                $"Prod does not have an active entity occupying `{expected}` — nothing to free",
                null);
        }

        if (!registry.ActiveEntities.TryGetValue(suffix, out var live))
        {
            return new OperationResult(
                false,
                $"Prod entity `{suffix}` not found in registry",
                null);
        }

        if (string.Equals(blocker.EntityId, suffix, StringComparison.Ordinal))
        {
            return new OperationResult(false, "Blocker and suffix entity are the same — refusing", null);
        }

        var platformsDiffer = !string.Equals(blocker.Platform, live.Platform, StringComparison.OrdinalIgnoreCase);
        var blockerDisabled = !string.IsNullOrWhiteSpace(blocker.DisabledBy);
        if (!platformsDiffer && !blockerDisabled)
        {
            return new OperationResult(
                false,
                $"Refusing — `{expected}` is an active {blocker.Platform} entity, not a safe stale duplicate to remove automatically",
                null);
        }

        var target = ParseProdTarget();
        if (target is null)
            return new OperationResult(false, "Prod SSH not configured — set SSH target in Settings", null);
        if (!File.Exists(paths.SshKeyFile))
            return new OperationResult(false, "SSH key not found — add id_ed25519 to the kit secrets directory", null);

        var (userHost, configPath) = target.Value;
        var registryPath = $"{configPath}/.storage/core.entity_registry";
        var sshBase = SshBase();
        var payload = JsonSerializer.Serialize(new { expected, suffix, blocker = expected });

        var stop = await StopProdHaAsync(ct);
        if (!stop.Ok)
            return new OperationResult(false, "Could not stop prod HA before registry edit", stop.LogTail);

        var waitDown = await WaitForProdHaDownAsync(ct);
        if (!waitDown.Ok)
            return new OperationResult(false, waitDown.Message, waitDown.LogTail);

        var remoteScript =
            "import json, shutil, copy\n" +
            "from datetime import datetime, timezone\n" +
            $"args = json.loads({JsonSerializer.Serialize(payload)})\n" +
            $"path = {JsonSerializer.Serialize(registryPath)}\n" +
            "expected = args['expected']\n" +
            "suffix = args['suffix']\n" +
            "blocker = args['blocker']\n" +
            "backup = path + '.bak-kit-suffix-fix'\n" +
            "shutil.copy2(path, backup)\n" +
            "data = json.load(open(path))\n" +
            "entities = data.get('data', {}).get('entities', [])\n" +
            "deleted = data.get('data', {}).get('deleted_entities', [])\n" +
            "if sum(1 for e in entities if e.get('entity_id') == expected) != 1:\n" +
            "    raise SystemExit('UNEXPECTED_BLOCKER_COUNT')\n" +
            "if sum(1 for e in entities if e.get('entity_id') == suffix) != 1:\n" +
            "    raise SystemExit('SUFFIX_NOT_UNIQUE')\n" +
            "blocker_entry = None\n" +
            "suffix_found = False\n" +
            "new_entities = []\n" +
            "for entry in entities:\n" +
            "    eid = entry.get('entity_id')\n" +
            "    if eid == blocker:\n" +
            "        blocker_entry = entry\n" +
            "        continue\n" +
            "    if eid == suffix:\n" +
            "        suffix_found = True\n" +
            "        entry = copy.deepcopy(entry)\n" +
            "        entry['entity_id'] = expected\n" +
            "        entry['previous_entity_id'] = suffix\n" +
            "    new_entities.append(entry)\n" +
            "if blocker_entry is None:\n" +
            "    raise SystemExit('BLOCKER_NOT_FOUND')\n" +
            "if not suffix_found:\n" +
            "    raise SystemExit('SUFFIX_NOT_FOUND')\n" +
            "tombstone = copy.deepcopy(blocker_entry)\n" +
            "tombstone['created_at'] = datetime.now(timezone.utc).isoformat()\n" +
            "deleted.append(tombstone)\n" +
            "data['data']['entities'] = new_entities\n" +
            "data['data']['deleted_entities'] = deleted\n" +
            "with open(path, 'w', encoding='utf-8') as f:\n" +
            "    json.dump(data, f, indent=2)\n" +
            "    f.write('\\n')\n" +
            "print(f'RENAMED={suffix}->{expected}')\n" +
            "print(f'REMOVED_BLOCKER={blocker}')\n" +
            "print(f'BACKUP={backup}')\n";

        var remoteCmd = ShQ($"sudo python3 -c {ShQ(remoteScript)}");
        var (fixOk, fixOut, fixErr) = await RunBashAsync(
            $"ssh {sshBase} {ShQ(userHost)} {remoteCmd}",
            ct);
        if (!fixOk)
        {
            await StartProdHaAsync(userHost, sshBase, ct);
            return new OperationResult(
                false,
                "Failed to fix prod entity suffix collision",
                string.IsNullOrWhiteSpace(fixErr) ? fixOut : fixErr);
        }

        var start = await StartProdHaAsync(userHost, sshBase, ct);
        var logs = new List<string>
        {
            "Stopped prod HA before editing entity registry (required for .storage changes to persist).",
            $"Removed stale blocker `{expected}` ({blocker.Platform}) from prod registry.",
            $"Renamed `{suffix}` ({live.Platform}) → `{expected}` on prod.",
            fixOut.Trim(),
            start.Message,
        };

        if (!start.Ok)
        {
            return new OperationResult(
                false,
                "Registry updated but prod HA start failed — start core manually from HA OS terminal",
                JoinLogs(logs, start.LogTail));
        }

        return new OperationResult(
            true,
            $"Prod entity id fixed: `{suffix}` is now `{expected}`. Click Recheck, then publish/deploy the dashboard bundle.",
            JoinLogs(logs, start.LogTail));
    }

    /// <summary>
    /// Renames a prod entity_id when the expected id is free and registry unique_id matches the dashboard.
    /// Used for timer and other entities that cannot be renamed in the HA UI.
    /// </summary>
    public async Task<OperationResult> FixWrongEntityIdAsync(
        string expectedEntityId,
        string wrongProdEntityId,
        CancellationToken ct,
        bool relaxedUniqueId = false)
    {
        if (string.IsNullOrWhiteSpace(expectedEntityId) || string.IsNullOrWhiteSpace(wrongProdEntityId))
            return new OperationResult(false, "Expected and wrong prod entity ids are required", null);

        var expected = expectedEntityId.Trim();
        var wrong = wrongProdEntityId.Trim();
        if (string.Equals(expected, wrong, StringComparison.OrdinalIgnoreCase))
            return new OperationResult(false, "Expected and wrong entity ids are the same — nothing to do", null);

        var registry = await prodRegistry.ReadAsync(ct);
        if (registry is null)
            return new OperationResult(false, "Could not read prod entity registry — check prod SSH settings", null);

        if (registry.ActiveEntities.ContainsKey(expected))
        {
            return new OperationResult(
                false,
                $"Prod already has an active entity `{expected}` — refusing registry rename",
                null);
        }

        if (!registry.ActiveEntities.TryGetValue(wrong, out var live))
        {
            return new OperationResult(
                false,
                $"Prod entity `{wrong}` not found in registry",
                null);
        }

        var expectedObject = expected.Contains('.', StringComparison.Ordinal)
            ? expected[(expected.IndexOf('.') + 1)..]
            : expected;
        if (!relaxedUniqueId
            && !string.IsNullOrWhiteSpace(live.UniqueId)
            && !string.Equals(live.UniqueId, expectedObject, StringComparison.OrdinalIgnoreCase))
        {
            return new OperationResult(
                false,
                $"Refusing — prod unique_id `{live.UniqueId}` does not match expected `{expectedObject}`",
                null);
        }

        var target = ParseProdTarget();
        if (target is null)
            return new OperationResult(false, "Prod SSH not configured — set SSH target in Settings", null);
        if (!File.Exists(paths.SshKeyFile))
            return new OperationResult(false, "SSH key not found — add id_ed25519 to the kit secrets directory", null);

        var (userHost, configPath) = target.Value;
        var registryPath = $"{configPath}/.storage/core.entity_registry";
        var sshBase = SshBase();
        var payload = JsonSerializer.Serialize(new { expected, wrong });

        var stop = await StopProdHaAsync(ct);
        if (!stop.Ok)
            return new OperationResult(false, "Could not stop prod HA before registry edit", stop.LogTail);

        var waitDown = await WaitForProdHaDownAsync(ct);
        if (!waitDown.Ok)
            return new OperationResult(false, waitDown.Message, waitDown.LogTail);

        var remoteScript =
            "import json, shutil, copy\n" +
            $"args = json.loads({JsonSerializer.Serialize(payload)})\n" +
            $"path = {JsonSerializer.Serialize(registryPath)}\n" +
            "expected = args['expected']\n" +
            "wrong = args['wrong']\n" +
            "backup = path + '.bak-kit-entity-rename'\n" +
            "shutil.copy2(path, backup)\n" +
            "data = json.load(open(path))\n" +
            "entities = data.get('data', {}).get('entities', [])\n" +
            "if any(e.get('entity_id') == expected for e in entities):\n" +
            "    raise SystemExit('EXPECTED_ALREADY_EXISTS')\n" +
            "if sum(1 for e in entities if e.get('entity_id') == wrong) != 1:\n" +
            "    raise SystemExit('WRONG_NOT_UNIQUE')\n" +
            "renamed = False\n" +
            "new_entities = []\n" +
            "for entry in entities:\n" +
            "    if entry.get('entity_id') == wrong:\n" +
            "        entry = copy.deepcopy(entry)\n" +
            "        entry['entity_id'] = expected\n" +
            "        entry['previous_entity_id'] = wrong\n" +
            "        renamed = True\n" +
            "    new_entities.append(entry)\n" +
            "if not renamed:\n" +
            "    raise SystemExit('WRONG_NOT_FOUND')\n" +
            "data['data']['entities'] = new_entities\n" +
            "with open(path, 'w', encoding='utf-8') as f:\n" +
            "    json.dump(data, f, indent=2)\n" +
            "    f.write('\\n')\n" +
            "print(f'RENAMED={wrong}->{expected}')\n" +
            "print(f'BACKUP={backup}')\n";

        var remoteCmd = ShQ($"sudo python3 -c {ShQ(remoteScript)}");
        var (fixOk, fixOut, fixErr) = await RunBashAsync(
            $"ssh {sshBase} {ShQ(userHost)} {remoteCmd}",
            ct);
        if (!fixOk)
        {
            await StartProdHaAsync(userHost, sshBase, ct);
            return new OperationResult(
                false,
                "Failed to rename prod entity id in registry",
                string.IsNullOrWhiteSpace(fixErr) ? fixOut : fixErr);
        }

        var start = await StartProdHaAsync(userHost, sshBase, ct);
        var logs = new List<string>
        {
            "Stopped prod HA before editing entity registry (required for .storage changes to persist).",
            $"Renamed `{wrong}` ({live.Platform}) → `{expected}` on prod.",
            fixOut.Trim(),
            start.Message,
        };

        if (!start.Ok)
        {
            return new OperationResult(
                false,
                "Registry updated but prod HA start failed — start core manually from HA OS terminal",
                JoinLogs(logs, start.LogTail));
        }

        return new OperationResult(
            true,
            $"Prod entity id fixed: `{wrong}` is now `{expected}`. Click Recheck, then publish/deploy the dashboard bundle.",
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
