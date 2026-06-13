using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class DockerRunner(KitPaths paths)
{
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

        var psi = new System.Diagnostics.ProcessStartInfo("bash")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            WorkingDirectory = workingDirectory
        };
        psi.ArgumentList.Add(script);
        if (!string.IsNullOrWhiteSpace(args))
            psi.ArgumentList.Add(args);

        using var proc = System.Diagnostics.Process.Start(psi);
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

    public async Task<(bool Ok, string Message)> DockerExecAsync(
        string container,
        string command,
        CancellationToken ct)
    {
        var psi = new System.Diagnostics.ProcessStartInfo("docker")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        psi.ArgumentList.Add("exec");
        psi.ArgumentList.Add(container);
        psi.ArgumentList.Add("bash");
        psi.ArgumentList.Add("-lc");
        psi.ArgumentList.Add(command);

        using var proc = System.Diagnostics.Process.Start(psi);
        if (proc is null)
            return (false, "Failed to start docker");
        var stdout = await proc.StandardOutput.ReadToEndAsync(ct);
        var stderr = await proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        var msg = string.IsNullOrWhiteSpace(stdout) ? stderr.Trim() : stdout.Trim();
        return (proc.ExitCode == 0, msg);
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
        var psi = new System.Diagnostics.ProcessStartInfo("docker")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        psi.ArgumentList.Add("ps");
        psi.ArgumentList.Add("-a");
        psi.ArgumentList.Add("--filter");
        psi.ArgumentList.Add($"name=^{container}$");
        psi.ArgumentList.Add("--format");
        psi.ArgumentList.Add("{{.Names}}");

        using var proc = System.Diagnostics.Process.Start(psi);
        if (proc is null)
            return false;
        var stdout = await proc.StandardOutput.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        return proc.ExitCode == 0 && stdout.Contains(container, StringComparison.Ordinal);
    }

    public Task<bool> IsContainerRunningAsync(string container, CancellationToken ct) =>
        IsContainerRunningAsync(new[] { container }, ct);

    public async Task<bool> IsContainerRunningAsync(IReadOnlyList<string> candidates, CancellationToken ct)
    {
        foreach (var name in candidates)
        {
            var psi = new System.Diagnostics.ProcessStartInfo("docker")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            };
            psi.ArgumentList.Add("ps");
            psi.ArgumentList.Add("--filter");
            psi.ArgumentList.Add($"name=^{name}$");
            psi.ArgumentList.Add("--format");
            psi.ArgumentList.Add("{{.Names}}");

            using var proc = System.Diagnostics.Process.Start(psi);
            if (proc is null)
                continue;
            var stdout = await proc.StandardOutput.ReadToEndAsync(ct);
            await proc.WaitForExitAsync(ct);
            if (proc.ExitCode == 0 && stdout.Contains(name, StringComparison.Ordinal))
                return true;
        }

        return false;
    }

    public async Task<(bool Ok, string Message)> RestartContainerAsync(string container, CancellationToken ct)
    {
        var psi = new System.Diagnostics.ProcessStartInfo("docker")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        psi.ArgumentList.Add("restart");
        psi.ArgumentList.Add(container);

        using var proc = System.Diagnostics.Process.Start(psi);
        if (proc is null)
            return (false, "Failed to start docker");
        var stdout = await proc.StandardOutput.ReadToEndAsync(ct);
        var stderr = await proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        var msg = string.IsNullOrWhiteSpace(stdout) ? stderr.Trim() : stdout.Trim();
        return (proc.ExitCode == 0, string.IsNullOrWhiteSpace(msg) ? $"Restarted {container}" : msg);
    }

    public Task<OperationResult> RestartContainerDetachedAsync(string container, string label, CancellationToken ct)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(750, ct);
                await RestartContainerAsync(container, CancellationToken.None);
            }
            catch
            {
                // best effort — HTTP response already sent
            }
        }, ct);

        return Task.FromResult(new OperationResult(true, $"Restarting {label} ({container})…", null));
    }

    public async Task<string> ContainerLogsTailAsync(string container, int lines, CancellationToken ct)
    {
        var psi = new System.Diagnostics.ProcessStartInfo("docker")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        psi.ArgumentList.Add("logs");
        psi.ArgumentList.Add("--tail");
        psi.ArgumentList.Add(lines.ToString());
        psi.ArgumentList.Add(container);

        using var proc = System.Diagnostics.Process.Start(psi);
        if (proc is null)
            return "";
        var stdout = await proc.StandardOutput.ReadToEndAsync(ct);
        var stderr = await proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        return (stdout + stderr).Trim();
    }
}
