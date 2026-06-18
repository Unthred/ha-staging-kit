using System.Collections.Concurrent;
using System.Diagnostics;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class DockerRunner(ILogger<DockerRunner> logger, KitPaths paths)
{
    public static readonly TimeSpan CommandTimeout = TimeSpan.FromSeconds(8);
    static readonly TimeSpan RunningStateCacheTtl = TimeSpan.FromSeconds(30);
    static readonly TimeSpan RestartTimeout = TimeSpan.FromSeconds(30);
    static readonly TimeSpan LogsTimeout = TimeSpan.FromSeconds(12);

    readonly ConcurrentDictionary<string, (bool Value, DateTimeOffset Expiry)> _boolCache = new(StringComparer.Ordinal);

    public Task<(bool Ok, string Message)> RunScriptAsync(string script, string args, CancellationToken ct) =>
        RunScriptAsync(script, args, paths.KitRoot, ct);

    public static async Task<(bool Ok, string Message)> RunScriptAsync(
        string script,
        string args,
        string workingDirectory,
        CancellationToken ct)
    {
        if (!File.Exists(script))
            return (false, $"Script not found: {script}");

        var psi = new ProcessStartInfo("bash")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            WorkingDirectory = workingDirectory
        };
        psi.ArgumentList.Add(script);
        if (!string.IsNullOrWhiteSpace(args))
            psi.ArgumentList.Add(args);

        using var proc = Process.Start(psi);
        if (proc is null)
            return (false, "Failed to start bash");
        var stdout = await proc.StandardOutput.ReadToEndAsync(ct);
        var stderr = await proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        var tail = (stdout + stderr).Trim();
        if (tail.Length > 4000)
            tail = tail[^4000..];
        return (proc.ExitCode == 0, tail);
    }

    public async Task<(bool Ok, string Message)> DockerExecAsync(string container, string command, CancellationToken ct)
    {
        var result = await RunDockerAsync(["exec", container, "bash", "-lc", command], ct, CommandTimeout);
        if (result.Error is not null)
            return (false, result.Error);
        var msg = string.IsNullOrWhiteSpace(result.Stdout) ? result.Stderr.Trim() : result.Stdout.Trim();
        return (result.ExitCode == 0, string.IsNullOrWhiteSpace(msg) ? $"exit {result.ExitCode}" : msg);
    }

    public async Task<string?> ResolveContainerAsync(IReadOnlyList<string> candidates, CancellationToken ct)
    {
        foreach (var name in candidates)
        {
            if (await ContainerExistsAsync(name, ct))
                return name;
        }

        return null;
    }

    public async Task<bool> ContainerExistsAsync(string container, CancellationToken ct)
    {
        var cacheKey = $"exists:{container}";
        if (TryGetCachedBool(cacheKey, out var cached))
            return cached;

        var result = await RunDockerAsync(
            ["ps", "-a", "--filter", $"name=^{container}$", "--format", "{{.Names}}"],
            ct,
            CommandTimeout);

        var exists = result.Error is null
            && result.ExitCode == 0
            && result.Stdout.Contains(container, StringComparison.Ordinal);

        if (result.Error is not null)
            logger.LogWarning("ContainerExistsAsync({Container}) failed: {Error}", container, result.Error);
        else
            SetCachedBool(cacheKey, exists, RunningStateCacheTtl);

        return exists;
    }

    public Task<bool> IsContainerRunningAsync(string container, CancellationToken ct) =>
        IsContainerRunningAsync([container], ct);

    public async Task<bool> IsContainerRunningAsync(IReadOnlyList<string> candidates, CancellationToken ct)
    {
        var cacheKey = "running:" + string.Join('|', candidates);
        if (TryGetCachedBool(cacheKey, out var cached))
            return cached;

        foreach (var name in candidates)
        {
            var result = await RunDockerAsync(
                ["ps", "--filter", $"name=^{name}$", "--format", "{{.Names}}"],
                ct,
                CommandTimeout);

            if (result.Error is not null)
            {
                logger.LogWarning("IsContainerRunningAsync({Container}) failed: {Error}", name, result.Error);
                continue;
            }

            if (result.ExitCode == 0 && result.Stdout.Contains(name, StringComparison.Ordinal))
            {
                SetCachedBool(cacheKey, true, RunningStateCacheTtl);
                return true;
            }
        }

        SetCachedBool(cacheKey, false, RunningStateCacheTtl);
        return false;
    }

    public async Task<IReadOnlyList<string>> ListHomeAssistantContainerNamesAsync(CancellationToken ct)
    {
        var result = await RunDockerAsync(
            ["ps", "-a", "--format", "{{.Names}}\t{{.Image}}"],
            ct,
            CommandTimeout);

        if (result.Error is not null)
        {
            logger.LogWarning("ListHomeAssistantContainerNamesAsync failed: {Error}", result.Error);
            return [];
        }

        if (result.ExitCode != 0)
        {
            logger.LogWarning(
                "ListHomeAssistantContainerNamesAsync exit {ExitCode}: {Stderr}",
                result.ExitCode,
                Truncate(result.Stderr, 200));
            return [];
        }

        return result.Stdout
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(line =>
            {
                var parts = line.Split('\t', 2);
                return parts.Length == 2 && parts[1].Contains("home-assistant", StringComparison.OrdinalIgnoreCase)
                    ? parts[0]
                    : null;
            })
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .Cast<string>()
            .Distinct(StringComparer.Ordinal)
            .ToList();
    }

    public async Task<IReadOnlyList<string>> GetContainerMountSourcesAsync(string container, CancellationToken ct)
    {
        var result = await RunDockerAsync(
            ["inspect", "-f", "{{range .Mounts}}{{.Source}}\n{{end}}", container],
            ct,
            CommandTimeout);

        if (result.Error is not null)
        {
            logger.LogWarning("GetContainerMountSourcesAsync({Container}) failed: {Error}", container, result.Error);
            return [];
        }

        if (result.ExitCode != 0)
        {
            logger.LogWarning(
                "GetContainerMountSourcesAsync({Container}) exit {ExitCode}: {Stderr}",
                container,
                result.ExitCode,
                Truncate(result.Stderr, 200));
            return [];
        }

        var mounts = new List<string>();
        foreach (var line in result.Stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            try
            {
                mounts.Add(Path.GetFullPath(line));
            }
            catch
            {
                mounts.Add(line);
            }
        }

        return mounts;
    }

    public async Task<(bool Ok, string Message)> RestartContainerAsync(string container, CancellationToken ct)
    {
        InvalidateRunningStateCache();
        var result = await RunDockerAsync(["restart", container], ct, RestartTimeout);
        if (result.Error is not null)
        {
            logger.LogError("RestartContainerAsync({Container}) failed: {Error}", container, result.Error);
            return (false, result.Error);
        }

        var msg = string.IsNullOrWhiteSpace(result.Stdout) ? result.Stderr.Trim() : result.Stdout.Trim();
        var ok = result.ExitCode == 0;
        if (ok)
            logger.LogInformation("Restarted container {Container}", container);
        else
            logger.LogWarning("RestartContainerAsync({Container}) exit {ExitCode}: {Message}", container, result.ExitCode, msg);

        return (ok, string.IsNullOrWhiteSpace(msg) ? $"Restarted {container}" : msg);
    }

    public Task<OperationResult> RestartContainerDetachedAsync(string container, string label, CancellationToken ct)
    {
        logger.LogInformation("Scheduling detached restart for {Label} ({Container})", label, container);
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(750, ct);
                await RestartContainerAsync(container, CancellationToken.None);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Detached restart failed for {Container}", container);
            }
        }, ct);

        return Task.FromResult(new OperationResult(true, $"Restarting {label} ({container})…", null));
    }

    public async Task<string> ContainerLogsTailAsync(string container, int lines, CancellationToken ct)
    {
        var result = await RunDockerAsync(["logs", "--tail", lines.ToString(), container], ct, LogsTimeout);
        if (result.Error is not null)
        {
            logger.LogWarning("ContainerLogsTailAsync({Container}) failed: {Error}", container, result.Error);
            return result.Error;
        }

        return (result.Stdout + result.Stderr).Trim();
    }

    public void InvalidateRunningStateCache()
    {
        foreach (var key in _boolCache.Keys.Where(k => k.StartsWith("running:", StringComparison.Ordinal) || k.StartsWith("exists:", StringComparison.Ordinal)))
            _boolCache.TryRemove(key, out _);
    }

    async Task<DockerCommandResult> RunDockerAsync(string[] args, CancellationToken ct, TimeSpan timeout)
    {
        var label = "docker " + string.Join(' ', args.Select(a => a.Contains(' ') ? $"\"{a}\"" : a));
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(timeout);

        var psi = new ProcessStartInfo("docker")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        foreach (var arg in args)
            psi.ArgumentList.Add(arg);

        Process? proc = null;
        try
        {
            proc = Process.Start(psi);
            if (proc is null)
            {
                logger.LogError("Failed to start process: {Command}", label);
                return new DockerCommandResult(-1, "", "", "Failed to start docker process");
            }

            var stdoutTask = proc.StandardOutput.ReadToEndAsync(timeoutCts.Token);
            var stderrTask = proc.StandardError.ReadToEndAsync(timeoutCts.Token);
            await proc.WaitForExitAsync(timeoutCts.Token);
            return new DockerCommandResult(proc.ExitCode, await stdoutTask, await stderrTask, null);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            TryKillProcess(proc);
            logger.LogWarning("Docker command timed out after {TimeoutSeconds}s: {Command}", timeout.TotalSeconds, label);
            return new DockerCommandResult(-1, "", "", $"Docker command timed out after {timeout.TotalSeconds:F0}s");
        }
        catch (Exception ex)
        {
            TryKillProcess(proc);
            logger.LogError(ex, "Docker command failed: {Command}", label);
            return new DockerCommandResult(-1, "", "", ex.Message);
        }
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

    bool TryGetCachedBool(string key, out bool value)
    {
        if (_boolCache.TryGetValue(key, out var entry) && entry.Expiry > DateTimeOffset.UtcNow)
        {
            value = entry.Value;
            return true;
        }

        value = false;
        return false;
    }

    void SetCachedBool(string key, bool value, TimeSpan ttl) =>
        _boolCache[key] = (value, DateTimeOffset.UtcNow.Add(ttl));

    static string Truncate(string text, int max) =>
        text.Length <= max ? text : text[..max] + "…";

    readonly record struct DockerCommandResult(int ExitCode, string Stdout, string Stderr, string? Error);
}
