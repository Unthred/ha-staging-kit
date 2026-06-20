using System.Diagnostics;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

/// <summary>Runs sidecar scripts and internal processes inside the kit container (no docker exec).</summary>
public sealed class SidecarRunner(ILogger<SidecarRunner> logger)
{
    const string SyncPattern = "sidecar/sbin/run.sh";
    static readonly TimeSpan DefaultBashTimeout = TimeSpan.FromSeconds(5);

    public Task<(bool Ok, string Message)> RunScriptAsync(string script, CancellationToken ct) =>
        RunScriptAsync(script, DefaultBashTimeout, ct);

    public Task<(bool Ok, string Message)> RunScriptAsync(string script, TimeSpan timeout, CancellationToken ct) =>
        RunBashAsync(EnsureBash(script), timeout, ct);

    public Task<bool> IsSyncLoopRunningAsync(CancellationToken ct) =>
        IsProcessRunningAsync(SyncPattern, ct);

    public async Task<bool> IsMirrorRunningAsync(CancellationToken ct)
    {
        if (await IsProcessRunningAsync("mosquitto -c", ct))
            return true;

        return await IsLocalPortOpenAsync(1883, ct);
    }

    static async Task<bool> IsLocalPortOpenAsync(int port, CancellationToken ct)
    {
        try
        {
            using var client = new System.Net.Sockets.TcpClient();
            var connect = client.ConnectAsync("127.0.0.1", port);
            await connect.WaitAsync(TimeSpan.FromSeconds(2), ct);
            return client.Connected;
        }
        catch
        {
            return false;
        }
    }

    public async Task<(bool Ok, string Message)> RestartSyncLoopAsync(CancellationToken ct)
    {
        logger.LogInformation("Restarting config sync loop");
        await RunBashAsync("pkill -f 'sidecar/sbin/run.sh' 2>/dev/null || true", ct);
        await Task.Delay(500, ct);
        return await RunBashAsync("/sidecar/sbin/run.sh >> /sidecar-data/sync.log 2>&1 &", ct);
    }

    public async Task<(bool Ok, string Message)> RestartMirrorAsync(KitPaths paths, CancellationToken ct)
    {
        var mirrorData = EnvFile.Get(paths.EnvFile, "MIRROR_DATA");
        if (string.IsNullOrWhiteSpace(mirrorData))
            return (false, "MIRROR_DATA not configured");

        var cfg = Path.Combine(mirrorData, "config", "mosquitto.conf");
        if (!File.Exists(cfg))
            return (false, "Mirror not configured — run deploy mirror first");

        logger.LogInformation("Restarting MQTT mirror");
        await RunBashAsync("pkill -x mosquitto 2>/dev/null || true", ct);
        await Task.Delay(500, ct);
        var logDir = Path.Combine(mirrorData, "log");
        Directory.CreateDirectory(logDir);
        return await RunBashAsync(
            $"chown -R mosquitto:mosquitto {Quote(logDir)} {Quote(Path.Combine(mirrorData, "data"))} {Quote(cfg)} 2>/dev/null || true; " +
            $"su -s /bin/bash mosquitto -c 'mosquitto -c {Quote(cfg)} >> {Quote(Path.Combine(logDir, "mosquitto.log"))} 2>&1 &'",
            ct);
    }

    public Task<string> SyncLogTailAsync(int lines, CancellationToken ct) =>
        ReadTailAsync("/sidecar-data/sync.log", lines, ct);

    public Task<string> PersonPollLogTailAsync(int lines, CancellationToken ct) =>
        ReadTailAsync("/sidecar-data/person-poll.log", lines, ct);

    public async Task AppendSyncLogAsync(string text, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(text))
            return;

        var path = "/sidecar-data/sync.log";
        await using var writer = new StreamWriter(path, append: true);
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0)
                continue;

            if (line.StartsWith('['))
                await writer.WriteLineAsync(line);
            else
                await writer.WriteLineAsync($"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] ha-staging-kit-sync: {line}");
        }
    }

    Task<(bool Ok, string Message)> RunBashAsync(string command, CancellationToken ct) =>
        RunBashAsync(command, DefaultBashTimeout, ct);

    async Task<(bool Ok, string Message)> RunBashAsync(string command, TimeSpan timeout, CancellationToken ct)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(timeout);

        var psi = new ProcessStartInfo("bash")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        psi.ArgumentList.Add("-lc");
        psi.ArgumentList.Add(command);

        Process? proc = null;
        try
        {
            proc = Process.Start(psi);
            if (proc is null)
                return (false, "Failed to start bash");

            var stdout = await proc.StandardOutput.ReadToEndAsync(timeoutCts.Token);
            var stderr = await proc.StandardError.ReadToEndAsync(timeoutCts.Token);
            await proc.WaitForExitAsync(timeoutCts.Token);
            var msg = BuildBashMessage(stdout, stderr, proc.ExitCode);
            if (msg.Length > 4000)
                msg = msg[^4000..];
            return (proc.ExitCode == 0, string.IsNullOrWhiteSpace(msg) ? $"exit {proc.ExitCode}" : msg);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            TryKillProcess(proc);
            logger.LogWarning("Sidecar bash command timed out after {TimeoutSeconds}s", timeout.TotalSeconds);
            return (false, $"Command timed out after {timeout.TotalSeconds:F0}s");
        }
        catch (Exception ex)
        {
            TryKillProcess(proc);
            logger.LogError(ex, "Sidecar bash command failed");
            return (false, ex.Message);
        }
    }

    async Task<bool> IsProcessRunningAsync(string pattern, CancellationToken ct)
    {
        string script;
        if (pattern.Contains("mosquitto", StringComparison.Ordinal))
            script = "pgrep -x mosquitto >/dev/null 2>&1 && echo yes || echo no";
        else
        {
            script =
                "for f in /proc/[0-9]*/cmdline; do " +
                "tr '\\0' ' ' < \"$f\" 2>/dev/null | grep -Fq -- " + Quote(pattern) + " && echo yes && exit 0; " +
                "done; echo no";
        }

        var (ok, msg) = await RunBashAsync(script, ct);
        return ok && msg.Contains("yes", StringComparison.Ordinal);
    }

    async Task<string> ReadTailAsync(string file, int lines, CancellationToken ct)
    {
        if (!File.Exists(file))
            return "";

        return await Task.Run(() => ReadFileTailLines(file, lines), ct);
    }

    static string ReadFileTailLines(string path, int maxLines)
    {
        var tail = new Queue<string>(maxLines);
        foreach (var raw in File.ReadLines(path))
        {
            var line = raw.Trim();
            if (line.Length == 0)
                continue;
            tail.Enqueue(line);
            if (tail.Count > maxLines)
                tail.Dequeue();
        }

        return string.Join('\n', tail);
    }

    static void TryKillProcess(Process? proc)
    {
        if (proc is null || proc.HasExited)
            return;
        try
        {
            proc.Kill(entireProcessTree: true);
        }
        catch
        {
            /* best effort */
        }
    }

    static string BuildBashMessage(string stdout, string stderr, int exitCode)
    {
        var outText = stdout.Trim();
        var errText = stderr.Trim();
        if (exitCode != 0 && !string.IsNullOrWhiteSpace(errText))
        {
            if (string.IsNullOrWhiteSpace(outText))
                return errText;
            if (!outText.Contains(errText, StringComparison.Ordinal))
                return $"{outText}\n{errText}";
        }

        return string.IsNullOrWhiteSpace(outText) ? errText : outText;
    }

    static string Quote(string value) => "'" + value.Replace("'", "'\\''") + "'";

    /// <summary>Run .sh paths via bash so missing +x on bind-mounted scripts does not fail.</summary>
    static string EnsureBash(string command)
    {
        var s = command.Trim();
        if (s.StartsWith("bash ", StringComparison.Ordinal))
            return s;

        var shIdx = s.IndexOf(".sh", StringComparison.Ordinal);
        if (shIdx < 0)
            return s;

        var scriptEnd = shIdx + 3;
        var scriptStart = s.LastIndexOf(' ', scriptEnd - 1);
        scriptStart = scriptStart < 0 ? 0 : scriptStart + 1;
        var scriptPath = s[scriptStart..scriptEnd];
        if (!scriptPath.StartsWith('/') && !scriptPath.StartsWith("./", StringComparison.Ordinal))
            return s;

        var prefix = s[..scriptStart];
        var suffix = s[scriptEnd..].TrimStart();
        var wrapped = $"{prefix}bash {Quote(scriptPath)}";
        return suffix.Length > 0 ? $"{wrapped} {suffix}" : wrapped;
    }
}
