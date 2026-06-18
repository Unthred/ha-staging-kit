using System.Text.RegularExpressions;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class Zigbee2MqttConfigFixService
{
    const string ConfigRelativePath = "zigbee2mqtt/configuration.yaml";
    const string RepoRoot = "/repo";

    public Task<LovelaceParityFixResult> ApplyGitFixAsync(Z2mConfigFixRequest request, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if (!Directory.Exists(Path.Combine(RepoRoot, ".git")))
        {
            return Task.FromResult(new LovelaceParityFixResult(
                false,
                "Git repo not configured — set the HA config repo path in Settings",
                [],
                0));
        }

        var liveIeee = (request.LiveIeee ?? "").Trim().ToLowerInvariant();
        var expectedName = (request.ExpectedFriendlyName ?? "").Trim();
        if (string.IsNullOrWhiteSpace(liveIeee) || string.IsNullOrWhiteSpace(expectedName))
        {
            return Task.FromResult(new LovelaceParityFixResult(
                false,
                "Live ieee and expected friendly name are required",
                [],
                0));
        }

        var path = Path.Combine(RepoRoot, ConfigRelativePath);
        if (!File.Exists(path))
        {
            return Task.FromResult(new LovelaceParityFixResult(
                false,
                $"{ConfigRelativePath} not found in kit repo",
                [],
                0));
        }

        var staleIpees = (request.StaleIpees ?? [])
            .Select(i => i.Trim().ToLowerInvariant())
            .Where(i => i.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var original = File.ReadAllText(path);
        var updated = RemoveIeeeBlocks(original, staleIpees);
        updated = SetFriendlyName(updated, liveIeee, expectedName);

        if (string.Equals(original, updated, StringComparison.Ordinal))
        {
            return Task.FromResult(new LovelaceParityFixResult(
                false,
                "No changes needed in zigbee2mqtt/configuration.yaml",
                [],
                0));
        }

        File.WriteAllText(path, updated);
        var removed = staleIpees.Count;
        return Task.FromResult(new LovelaceParityFixResult(
            true,
            removed > 0
                ? $"Updated {ConfigRelativePath}: removed {removed} stale device block(s), set {liveIeee} → “{expectedName}”. Commit → deploy → restart Z2M."
                : $"Updated {ConfigRelativePath}: set {liveIeee} → “{expectedName}”. Commit → deploy → restart Z2M.",
            [ConfigRelativePath],
            1));
    }

    static string RemoveIeeeBlocks(string yaml, IReadOnlySet<string> staleIpees)
    {
        if (staleIpees.Count == 0)
            return yaml;

        var lines = yaml.Split('\n').ToList();
        for (var i = lines.Count - 1; i >= 0; i--)
        {
            var match = Regex.Match(lines[i], @"^\s*['""]?(0x[0-9a-fA-F]+)['""]?\s*:\s*$");
            if (!match.Success)
                continue;

            var ieee = match.Groups[1].Value.ToLowerInvariant();
            if (!staleIpees.Contains(ieee))
                continue;

            var end = i + 1;
            while (end < lines.Count && (lines[end].StartsWith(' ') || lines[end].StartsWith('\t')))
                end++;

            lines.RemoveRange(i, end - i);
        }

        return string.Join('\n', lines).TrimEnd() + '\n';
    }

    static string SetFriendlyName(string yaml, string ieee, string friendlyName)
    {
        var lines = yaml.Split('\n').ToList();
        string? currentIeee = null;
        for (var i = 0; i < lines.Count; i++)
        {
            var ieeeMatch = Regex.Match(lines[i], @"^\s*['""]?(0x[0-9a-fA-F]+)['""]?\s*:\s*$");
            if (ieeeMatch.Success)
            {
                currentIeee = ieeeMatch.Groups[1].Value.ToLowerInvariant();
                continue;
            }

            if (!string.Equals(currentIeee, ieee, StringComparison.OrdinalIgnoreCase))
                continue;

            var nameMatch = Regex.Match(lines[i], @"^(\s*friendly_name\s*:\s*)(.+?)\s*$");
            if (!nameMatch.Success)
                continue;

            lines[i] = $"{nameMatch.Groups[1].Value}{friendlyName}";
            break;
        }

        return string.Join('\n', lines).TrimEnd() + '\n';
    }
}
