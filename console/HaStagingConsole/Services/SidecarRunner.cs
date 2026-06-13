using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

/// <summary>Runs sidecar scripts and internal processes inside the kit container (no docker exec).</summary>
public sealed class SidecarRunner
{
    const string SyncPattern = "sidecar/sbin/run.sh";

    public Task<(bool Ok, string Message)> RunScriptAsync(string script, CancellationToken ct) =>
        RunBashAsync(script, ct);

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

    static async Task<(bool Ok, string Message)> RunBashAsync(string command, CancellationToken ct)
    {
        var psi = new System.Diagnostics.ProcessStartInfo("bash")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        psi.ArgumentList.Add("-lc");
        psi.ArgumentList.Add(command);

        using var proc = System.Diagnostics.Process.Start(psi);
        if (proc is null)
            return (false, "Failed to start bash");
        var stdout = await proc.StandardOutput.ReadToEndAsync(ct);
        var stderr = await proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        var msg = string.IsNullOrWhiteSpace(stdout) ? stderr.Trim() : stdout.Trim();
        if (msg.Length > 4000)
            msg = msg[^4000..];
        return (proc.ExitCode == 0, string.IsNullOrWhiteSpace(msg) ? $"exit {proc.ExitCode}" : msg);
    }

    static async Task<bool> IsProcessRunningAsync(string pattern, CancellationToken ct)
    {
        string script;
        if (pattern.Contains("mosquitto", StringComparison.Ordinal))
        {
            script = "pgrep -x mosquitto >/dev/null 2>&1 && echo yes || echo no";
        }
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

    static async Task<string> ReadTailAsync(string file, int lines, CancellationToken ct)
    {
        if (!File.Exists(file))
            return "";
        var (ok, msg) = await RunBashAsync($"tail -n {lines} {Quote(file)} 2>/dev/null", ct);
        return ok ? msg : "";
    }

    static string Quote(string value) => "'" + value.Replace("'", "'\\''") + "'";
}
