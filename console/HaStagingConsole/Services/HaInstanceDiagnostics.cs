using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed partial class HaInstanceDiagnostics(
    IHttpClientFactory httpClientFactory,
    DockerRunner docker,
    KitPaths paths)
{
    const int RecentTailLines = 400;
    const int MaxBlocksPerDomain = 4;
    const int MaxPickedLines = 2500;
    const int SshConnectTimeoutSeconds = 5;
    const int SshCommandTimeoutSeconds = 8;

    static readonly HashSet<string> ErrorStates = new(StringComparer.Ordinal)
    {
        "setup_error",
        "migration_error",
        "failed_unload",
    };

    static readonly HashSet<string> WarnStates = new(StringComparer.Ordinal)
    {
        "setup_retry",
        "not_loaded",
    };

    public async Task<HaInstanceDiagnosticsSnapshot> CollectIssuesAsync(
        string instanceLabel,
        string? url,
        string tokenFile,
        CancellationToken ct)
    {
        var (resolvedUrl, token) = TokenFile.Read(tokenFile);
        url = FirstNonEmpty(url, resolvedUrl);
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(token))
            return new HaInstanceDiagnosticsSnapshot(
                [UnavailableIssue(instanceLabel, "not configured — set URL and API token in Settings")],
                null);

        var (issues, unavailable) = await FetchConfigEntryIssuesAsync(instanceLabel, url, token, ct);
        if (unavailable is not null)
            return new HaInstanceDiagnosticsSnapshot([unavailable], url.Trim());

        return new HaInstanceDiagnosticsSnapshot(issues, url.Trim());
    }

    public async Task<HaLogSnapshot> FetchCoreLogAsync(
        string instanceLabel,
        string? url,
        string tokenFile,
        string installType,
        string? containerName,
        string? configPath,
        IReadOnlyList<string>? grepDomains,
        CancellationToken ct)
    {
        var domains = grepDomains?
            .Where(d => !string.IsNullOrWhiteSpace(d))
            .Select(d => d.Trim().ToLowerInvariant())
            .Distinct(StringComparer.Ordinal)
            .ToList() ?? [];

        var fileLines = await ReadPersistentLogLinesAsync(installType, configPath, ct);
        if (fileLines.Count > 0)
        {
            var picked = PickLogLines(fileLines, domains);
            var source = ResolveLogFilePath(configPath) is { } logPath
                ? $"home-assistant.log ({logPath})"
                : "home-assistant.log";
            return new HaLogSnapshot(instanceLabel, source, picked);
        }

        var (resolvedUrl, token) = TokenFile.Read(tokenFile);
        url = FirstNonEmpty(url, resolvedUrl);
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(token))
            return HaLogSnapshot.Empty(instanceLabel);

        if (string.Equals(installType, "ha_os", StringComparison.OrdinalIgnoreCase))
        {
            var text = await FetchSupervisorCoreLogAsync(url, token, ct);
            if (!string.IsNullOrWhiteSpace(text))
            {
                return new HaLogSnapshot(
                    instanceLabel,
                    "Home Assistant core log (Supervisor API — recent only)",
                    TailLogLines(text, 200));
            }
        }

        if (!string.IsNullOrWhiteSpace(containerName))
        {
            var running = await docker.IsContainerRunningAsync(containerName, ct);
            if (running)
            {
                var text = await docker.ContainerLogsTailAsync(containerName, 200, ct);
                if (!string.IsNullOrWhiteSpace(text))
                {
                    return new HaLogSnapshot(
                        instanceLabel,
                        $"Docker stdout ({containerName} — recent only)",
                        TailLogLines(text, 200));
                }
            }
        }

        return new HaLogSnapshot(
            instanceLabel,
            "Core log unavailable",
            []);
    }

    async Task<IReadOnlyList<string>> ReadPersistentLogLinesAsync(
        string installType,
        string? configPath,
        CancellationToken ct)
    {
        var logPath = ResolveLogFilePath(configPath);
        if (!string.IsNullOrWhiteSpace(logPath) && File.Exists(logPath))
            return await Task.Run(() => ReadAllLogLines(logPath), ct);

        if (string.Equals(installType, "ha_os", StringComparison.OrdinalIgnoreCase))
        {
            var sshText = await ReadProdLogTailViaSshAsync(RecentTailLines, ct);
            if (!string.IsNullOrWhiteSpace(sshText))
                return TailLogLines(sshText, RecentTailLines);
        }

        return [];
    }

    static string? ResolveLogFilePath(string? configPath)
    {
        foreach (var candidate in new[]
                 {
                     "/ha-config/home-assistant.log",
                     string.IsNullOrWhiteSpace(configPath) ? null : Path.Combine(configPath, "home-assistant.log"),
                 })
        {
            if (!string.IsNullOrWhiteSpace(candidate) && File.Exists(candidate))
                return candidate;
        }

        return null;
    }

    async Task<string?> ReadProdLogTailViaSshAsync(int lines, CancellationToken ct)
    {
        var target = ParseProdTarget();
        if (target is null || !File.Exists(paths.SshKeyFile))
            return null;

        var (userHost, configDir) = target.Value;
        var logFile = $"{configDir.TrimEnd('/')}/home-assistant.log";
        var remoteCmd = $"tail -n {lines} {ShQ(logFile)}";
        return await RunSshCommandAsync(userHost, remoteCmd, ct);
    }

    async Task<string?> RunSshCommandAsync(string userHost, string remoteCmd, CancellationToken ct)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(SshCommandTimeoutSeconds));

        var psi = new ProcessStartInfo("bash")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        psi.ArgumentList.Add("-lc");
        psi.ArgumentList.Add(
            $"nice -n 19 ssh {SshBase()} {ShQ(userHost)} {ShQ(remoteCmd)}");

        try
        {
            using var proc = Process.Start(psi);
            if (proc is null)
                return null;

            await using var _ = timeoutCts.Token.Register(() =>
            {
                try
                {
                    if (!proc.HasExited)
                        proc.Kill(entireProcessTree: true);
                }
                catch
                {
                    /* best effort */
                }
            });

            var stdout = await proc.StandardOutput.ReadToEndAsync(timeoutCts.Token);
            await proc.WaitForExitAsync(timeoutCts.Token);
            return proc.ExitCode == 0 ? stdout : null;
        }
        catch
        {
            return null;
        }
    }

    static IReadOnlyList<string> ReadAllLogLines(string path)
    {
        var lines = new List<string>();
        foreach (var raw in File.ReadLines(path))
        {
            var line = StripAnsi(raw.Trim());
            if (line.Length > 0)
                lines.Add(line);
        }

        return lines;
    }

    static IReadOnlyList<string> PickLogLines(IReadOnlyList<string> lines, IReadOnlyList<string> domains)
    {
        if (lines.Count == 0)
            return lines;

        var picked = new SortedSet<int>();
        var recentStart = Math.Max(0, lines.Count - RecentTailLines);
        for (var i = recentStart; i < lines.Count; i++)
            picked.Add(i);

        if (domains.Count > 0)
        {
            foreach (var domain in domains.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var matcher = new DomainLogMatcher(domain);
                var seeds = FindDomainSeeds(lines, [matcher]);
                if (seeds.Count == 0)
                    continue;

                var blocks = TakeLastBlocks(ExpandSeeds(lines, seeds), MaxBlocksPerDomain);
                foreach (var block in blocks)
                {
                    foreach (var i in block)
                        picked.Add(i);
                }
            }
        }

        return picked
            .TakeLast(MaxPickedLines)
            .Select(i => lines[i])
            .ToList();
    }

    static HashSet<int> FindDomainSeeds(IReadOnlyList<string> lines, IReadOnlyList<DomainLogMatcher> matchers)
    {
        var seeds = new HashSet<int>();
        for (var i = 0; i < lines.Count; i++)
        {
            var lower = lines[i].ToLowerInvariant();
            foreach (var matcher in matchers)
            {
                if (matcher.IsMatch(lower))
                {
                    seeds.Add(i);
                    break;
                }
            }
        }

        return seeds;
    }

    sealed class DomainLogMatcher
    {
        readonly Regex _configEntry;
        readonly (string Variant, bool WordBoundary)[] _variants;

        public DomainLogMatcher(string domain)
        {
            domain = domain.ToLowerInvariant();
            _configEntry = ConfigEntryLinePattern(domain);
            _variants = DomainVariants(domain)
                .Select(v => (v, !v.Contains('.') && !v.Contains(' ')))
                .ToArray();
        }

        public bool IsMatch(string lower)
        {
            foreach (var (variant, wordBoundary) in _variants)
            {
                if (wordBoundary)
                {
                    if (ContainsWholeWord(lower, variant))
                        return true;
                }
                else if (lower.Contains(variant, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return _configEntry.IsMatch(lower);
        }

        static bool ContainsWholeWord(string lower, string term)
        {
            var idx = 0;
            while ((idx = lower.IndexOf(term, idx, StringComparison.Ordinal)) >= 0)
            {
                var beforeOk = idx == 0 || !char.IsLetterOrDigit(lower[idx - 1]);
                var afterIdx = idx + term.Length;
                var afterOk = afterIdx >= lower.Length || !char.IsLetterOrDigit(lower[afterIdx]);
                if (beforeOk && afterOk)
                    return true;
                idx = afterIdx;
            }

            return false;
        }
    }

    static IEnumerable<string> DomainVariants(string domain)
    {
        domain = domain.ToLowerInvariant();
        yield return domain;
        yield return $"homeassistant.components.{domain}";
        yield return $"custom_components.{domain}";
        yield return $"{domain} integration";
        yield return $"[homeassistant.components.{domain}]";

        var underscore = domain.IndexOf('_');
        if (underscore > 0)
            yield return domain[..underscore];
    }

    static Regex ConfigEntryLinePattern(string domain) =>
        new(
            $@"error setting up entry .* for {Regex.Escape(domain)}\b|integration {Regex.Escape(domain)}\b|setting up {Regex.Escape(domain)}\b",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    static HashSet<int> ExpandSeeds(IReadOnlyList<string> lines, IReadOnlySet<int> seeds)
    {
        var expanded = new HashSet<int>();
        foreach (var i in seeds)
        {
            expanded.Add(i);
            for (var j = i - 1; j >= 0 && !IsHaLogRecordStart(lines[j]); j--)
                expanded.Add(j);
            for (var j = i + 1; j < lines.Count && !IsHaLogRecordStart(lines[j]); j++)
                expanded.Add(j);
        }

        return expanded;
    }

    static bool IsHaLogRecordStart(string line) =>
        HaLogStartPattern().IsMatch(line);

    static List<List<int>> TakeLastBlocks(IReadOnlySet<int> indices, int maxBlocks)
    {
        if (indices.Count == 0)
            return [];

        var sorted = indices.OrderBy(i => i).ToList();
        var blocks = new List<List<int>>();
        var current = new List<int> { sorted[0] };
        for (var i = 1; i < sorted.Count; i++)
        {
            if (sorted[i] == sorted[i - 1] + 1)
                current.Add(sorted[i]);
            else
            {
                blocks.Add(current);
                current = [sorted[i]];
            }
        }

        blocks.Add(current);
        return blocks.TakeLast(maxBlocks).ToList();
    }

    /// <summary>Fill config-entry issues with reasons parsed from home-assistant.log when the API omits them.</summary>
    public static IReadOnlyList<ComponentIssue> EnrichIssuesFromLogs(
        IReadOnlyList<ComponentIssue> issues,
        HaLogSnapshot prodLog,
        HaLogSnapshot stagingLog)
    {
        var result = new List<ComponentIssue>(issues.Count);
        foreach (var issue in issues)
        {
            if (!string.IsNullOrWhiteSpace(issue.Reason)
                || string.IsNullOrWhiteSpace(issue.Domain)
                || string.Equals(issue.Domain, "_kit", StringComparison.OrdinalIgnoreCase))
            {
                result.Add(issue);
                continue;
            }

            var lines = string.Equals(issue.Source, "Production HA", StringComparison.Ordinal)
                ? prodLog.Lines
                : stagingLog.Lines;
            var reason = ExtractReasonFromLog(lines, issue);
            if (string.IsNullOrWhiteSpace(reason))
            {
                result.Add(issue);
                continue;
            }

            var message = issue.Message.Contains(" — ", StringComparison.Ordinal)
                ? issue.Message
                : $"{issue.Message} — {reason}";
            result.Add(issue with { Reason = reason, Message = message });
        }

        return result;
    }

    static string? ExtractReasonFromLog(IReadOnlyList<string> lines, ComponentIssue issue)
    {
        if (lines.Count == 0 || string.IsNullOrWhiteSpace(issue.Domain))
            return null;

        var matcher = new DomainLogMatcher(issue.Domain);
        var seeds = FindDomainSeeds(lines, [matcher]);
        if (seeds.Count == 0 && TryParseEntryTitle(issue.Message) is { } title)
        {
            for (var i = 0; i < lines.Count; i++)
            {
                var lower = lines[i].ToLowerInvariant();
                if (lower.Contains(title, StringComparison.Ordinal)
                    && (lower.Contains(issue.Domain, StringComparison.Ordinal)
                        || lower.Contains("config entry", StringComparison.Ordinal)
                        || lower.Contains("error setting up entry", StringComparison.Ordinal)))
                {
                    seeds.Add(i);
                }
            }
        }

        if (seeds.Count == 0)
            return null;

        var blocks = TakeLastBlocks(ExpandSeeds(lines, seeds), 1);
        if (blocks.Count == 0)
            return null;

        return SummarizeFailureBlock(blocks[^1].Select(i => lines[i]).ToList());
    }

    static string? TryParseEntryTitle(string message)
    {
        var colon = message.IndexOf(':');
        if (colon <= 0)
            return null;

        var head = message[..colon].Trim();
        var paren = head.LastIndexOf('(');
        if (paren <= 0)
            return null;

        var title = head[..paren].Trim().ToLowerInvariant();
        return title.Length >= 3 ? title : null;
    }

    static string? SummarizeFailureBlock(IReadOnlyList<string> blockLines)
    {
        if (blockLines.Count == 0)
            return null;

        var full = string.Join('\n', blockLines);

        var authMatch = AuthFailurePattern().Match(full);
        if (authMatch.Success)
            return authMatch.Groups[1].Value.Trim();

        if (full.Contains("refresh_token/smartthings", StringComparison.OrdinalIgnoreCase)
            && full.Contains("ClientResponseError", StringComparison.Ordinal))
        {
            return full.Contains("400", StringComparison.Ordinal)
                ? "OAuth token refresh failed (Nabu Casa account link HTTP 400 Bad Request)"
                : "OAuth token refresh failed (Nabu Casa account link error)";
        }

        for (var i = blockLines.Count - 1; i >= 0; i--)
        {
            var line = blockLines[i].Trim();
            if (line.Length == 0)
                continue;

            if (line.Contains("ClientResponseError:", StringComparison.Ordinal))
                return SimplifyClientResponseError(line);
            if (line.Contains("ClientConnectorError:", StringComparison.Ordinal))
                return SimplifyConnectionError(line);
            if (line.Contains("TimeoutError", StringComparison.Ordinal))
                return "Connection timed out";
            if (line.Contains("could not authenticate:", StringComparison.OrdinalIgnoreCase))
            {
                var idx = line.IndexOf("could not authenticate:", StringComparison.OrdinalIgnoreCase);
                return line[(idx + "could not authenticate:".Length)..].Trim();
            }
        }

        var errorLine = blockLines
            .Select(l => l.Trim())
            .LastOrDefault(l => l.Contains("ERROR", StringComparison.Ordinal) && l.Contains(':'));
        if (!string.IsNullOrWhiteSpace(errorLine) && errorLine.Length <= 160)
            return errorLine;

        return null;
    }

    static string SimplifyClientResponseError(string line)
    {
        var match = ClientResponseErrorPattern().Match(line);
        if (!match.Success)
            return TruncateReason(line);

        var status = match.Groups[1].Value;
        var message = match.Groups[2].Value;
        var url = match.Groups[3].Success ? match.Groups[3].Value : null;

        if (url?.Contains("nabucasa", StringComparison.OrdinalIgnoreCase) == true
            || url?.Contains("account-link", StringComparison.OrdinalIgnoreCase) == true)
        {
            return $"OAuth token refresh failed (HTTP {status} {message})";
        }

        if (!string.IsNullOrWhiteSpace(url))
            return $"HTTP {status} {message} ({ShortUrl(url)})";

        return $"HTTP {status}: {message}";
    }

    static string SimplifyConnectionError(string line)
    {
        var urlMatch = UrlInLinePattern().Match(line);
        if (urlMatch.Success)
            return $"Cannot connect to {ShortUrl(urlMatch.Groups[1].Value)}";
        return TruncateReason(line);
    }

    static string ShortUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
            return TruncateReason(url, 80);

        return uri.Host + uri.AbsolutePath;
    }

    static string TruncateReason(string text, int max = 120) =>
        text.Length <= max ? text : text[..max] + "…";

    [GeneratedRegex(@"could not authenticate:\s*(.+?)(?:\r|\n|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex AuthFailurePattern();

    [GeneratedRegex(@"ClientResponseError:\s*(\d+),\s*message='([^']*)'(?:,\s*url='([^']*)')?", RegexOptions.CultureInvariant)]
    private static partial Regex ClientResponseErrorPattern();

    [GeneratedRegex(@"url='([^']+)'", RegexOptions.CultureInvariant)]
    private static partial Regex UrlInLinePattern();

    async Task<(IReadOnlyList<ComponentIssue> Issues, ComponentIssue? Unavailable)> FetchConfigEntryIssuesAsync(
        string instanceLabel,
        string url,
        string token,
        CancellationToken ct)
    {
        try
        {
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(8);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await client.GetAsync($"{url.TrimEnd('/')}/api/config/config_entries/entry", ct);
            if (!response.IsSuccessStatusCode)
            {
                var detail = response.StatusCode switch
                {
                    HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden =>
                        "API token rejected — see steps on the right to create a token in staging HA and save it in Settings",
                    _ => $"integration list unavailable — HTTP {(int)response.StatusCode}",
                };
                return ([], UnavailableIssue(instanceLabel, detail));
            }

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                return ([], UnavailableIssue(instanceLabel, "integration list unavailable — unexpected API response"));

            var issues = new List<ComponentIssue>();
            foreach (var entry in doc.RootElement.EnumerateArray())
            {
                var issue = ParseConfigEntryIssue(instanceLabel, entry);
                if (issue is not null)
                    issues.Add(issue);
            }

            return (issues
                .OrderByDescending(i => i.Level == "error")
                .ThenBy(i => i.Message, StringComparer.OrdinalIgnoreCase)
                .ToList(), null);
        }
        catch (Exception ex)
        {
            return ([], UnavailableIssue(instanceLabel, $"integration list unavailable — {ex.Message}"));
        }
    }

    static ComponentIssue UnavailableIssue(string instanceLabel, string detail) =>
        new(instanceLabel, "error", detail, "_kit", null, detail);

    static ComponentIssue? ParseConfigEntryIssue(string instanceLabel, JsonElement entry)
    {
        if (!entry.TryGetProperty("state", out var stateProp))
            return null;

        var state = stateProp.GetString() ?? "";
        if (state is "loaded" or "setup_in_progress" or "unload_in_progress")
            return null;

        if (entry.TryGetProperty("disabled_by", out var disabledProp)
            && disabledProp.ValueKind == JsonValueKind.String
            && !string.IsNullOrWhiteSpace(disabledProp.GetString()))
        {
            return null;
        }

        if (string.Equals(state, "not_loaded", StringComparison.Ordinal)
            && entry.TryGetProperty("source", out var sourceProp)
            && string.Equals(sourceProp.GetString(), "ignore", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (!ErrorStates.Contains(state) && !WarnStates.Contains(state))
            return null;

        var domain = entry.TryGetProperty("domain", out var domainProp) ? domainProp.GetString() ?? "integration" : "integration";
        var title = entry.TryGetProperty("title", out var titleProp) ? titleProp.GetString() : null;
        var reason = entry.TryGetProperty("reason", out var reasonProp) ? reasonProp.GetString() : null;
        var entryId = entry.TryGetProperty("entry_id", out var entryIdProp) ? entryIdProp.GetString() : null;
        var level = ErrorStates.Contains(state) ? "error" : "warn";
        var message = FormatEntryIssue(title, domain, state, reason);
        return new ComponentIssue(instanceLabel, level, message, domain, entryId, reason);
    }

    static string FormatEntryIssue(string? title, string domain, string state, string? reason)
    {
        var label = state switch
        {
            "setup_error" => "failed to initialize",
            "migration_error" => "migration failed",
            "setup_retry" => "setup retrying",
            "failed_unload" => "failed to unload",
            "not_loaded" => "not loaded",
            _ => state.Replace('_', ' '),
        };

        var name = string.IsNullOrWhiteSpace(title) ? domain : $"{title} ({domain})";
        return string.IsNullOrWhiteSpace(reason) ? $"{name}: {label}" : $"{name}: {label} — {reason}";
    }

    async Task<string?> FetchSupervisorCoreLogAsync(string url, string token, CancellationToken ct)
    {
        try
        {
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(10);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await client.GetAsync($"{url.TrimEnd('/')}/api/hassio/core/logs", ct);
            if (!response.IsSuccessStatusCode)
                return null;

            return await response.Content.ReadAsStringAsync(ct);
        }
        catch
        {
            return null;
        }
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
        $"-i {ShQ(paths.SshKeyFile)} -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout={SshConnectTimeoutSeconds}";

    static string ShQ(string s) => "'" + s.Replace("'", "'\\''") + "'";

    static IReadOnlyList<string> TailLogLines(string text, int maxLines)
    {
        var lines = text
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(StripAnsi)
            .Where(l => l.Length > 0)
            .TakeLast(maxLines)
            .ToList();
        return lines;
    }

    static string StripAnsi(string line) => AnsiEscapePattern().Replace(line, "");

    static string? FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
                return value.Trim();
        }

        return null;
    }

    [GeneratedRegex(@"\e\[[0-9;]*m")]
    private static partial Regex AnsiEscapePattern();

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}")]
    private static partial Regex HaLogStartPattern();
}
