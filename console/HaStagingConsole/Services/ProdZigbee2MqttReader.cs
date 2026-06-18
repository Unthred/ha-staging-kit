using System.Text.Json;
using System.Text.RegularExpressions;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed record Zigbee2MqttDeviceConfig(string Ieee, string FriendlyName);

public sealed record Zigbee2MqttProdSnapshot(
    IReadOnlyDictionary<string, Zigbee2MqttDeviceConfig> ConfigByIeee,
    IReadOnlySet<string> LiveIpees);

public sealed class ProdZigbee2MqttReader(KitPaths paths, GitSshConfigurator gitSsh)
{
    static readonly Regex IeeeLine = new(
        @"^\s*['""]?(0x[0-9a-fA-F]+)['""]?\s*:\s*$",
        RegexOptions.Compiled);
    static readonly Regex FriendlyNameLine = new(
        @"^\s*friendly_name\s*:\s*(.+?)\s*$",
        RegexOptions.Compiled);

    public async Task<Zigbee2MqttProdSnapshot?> ReadProdSnapshotAsync(CancellationToken ct)
    {
        var target = ParseProdTarget();
        if (target is null)
            return null;

        var (userHost, configPath) = target.Value;
        var sshBase = SshBase();
        var configYaml = await ReadRemoteFileAsync(
            userHost, sshBase, $"{configPath}/zigbee2mqtt/configuration.yaml", ct);
        if (string.IsNullOrWhiteSpace(configYaml))
            return null;

        var stateJson = await ReadRemoteFileAsync(
            userHost, sshBase, $"{configPath}/zigbee2mqtt/state.json", ct);
        var liveIpees = ParseStateIpees(stateJson);
        var configByIeee = ParseConfigurationYaml(configYaml);
        return new Zigbee2MqttProdSnapshot(configByIeee, liveIpees);
    }

    public static IReadOnlyDictionary<string, Zigbee2MqttDeviceConfig> ParseConfigurationYaml(string yaml)
    {
        var map = new Dictionary<string, Zigbee2MqttDeviceConfig>(StringComparer.OrdinalIgnoreCase);
        string? currentIeee = null;
        foreach (var rawLine in yaml.Split('\n'))
        {
            var line = rawLine.TrimEnd('\r');
            var ieeeMatch = IeeeLine.Match(line);
            if (ieeeMatch.Success)
            {
                currentIeee = ieeeMatch.Groups[1].Value.ToLowerInvariant();
                continue;
            }

            if (currentIeee is null)
                continue;

            var nameMatch = FriendlyNameLine.Match(line);
            if (!nameMatch.Success)
                continue;

            var friendlyName = nameMatch.Groups[1].Value.Trim().Trim('\'', '"');
            map[currentIeee] = new Zigbee2MqttDeviceConfig(currentIeee, friendlyName);
            currentIeee = null;
        }

        return map;
    }

    static HashSet<string> ParseStateIpees(string? stateJson)
    {
        var live = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(stateJson))
            return live;

        try
        {
            using var doc = JsonDocument.Parse(stateJson);
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                if (prop.Name.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
                    live.Add(prop.Name.ToLowerInvariant());
            }
        }
        catch (JsonException)
        {
            /* best effort */
        }

        return live;
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
}
