using System.Diagnostics;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services.Release;

public sealed class ProdRegistrySnapshotService(KitPaths paths, GitSshConfigurator gitSsh)
{
    public async Task<(bool Ok, string? EntityRegistryPath, string? DeviceRegistryPath, string Message)> CapturePostReleaseAsync(
        string shortSha,
        bool includeDeviceRegistry,
        CancellationToken ct)
    {
        var target = ParseProdTarget();
        if (target is null)
            return (false, null, null, "Prod SSH not configured");

        if (!File.Exists(paths.SshKeyFile))
            return (false, null, null, "SSH key not found");

        var snapshotDir = Path.Combine(paths.ReleaseSnapshotsDir, shortSha);
        Directory.CreateDirectory(snapshotDir);

        var entityPath = Path.Combine(snapshotDir, "core.entity_registry");
        var entityOk = await CopyRemoteFileAsync(
            target.Value.userHost,
            $"{target.Value.configPath}/.storage/core.entity_registry",
            entityPath,
            ct);
        if (!entityOk)
            return (false, null, null, "Failed to backup core.entity_registry");

        string? devicePath = null;
        if (includeDeviceRegistry)
        {
            devicePath = Path.Combine(snapshotDir, "core.device_registry");
            await CopyRemoteFileAsync(
                target.Value.userHost,
                $"{target.Value.configPath}/.storage/core.device_registry",
                devicePath,
                ct);
        }

        return (true, entityPath, devicePath, $"Registry snapshot saved to {snapshotDir}");
    }

    public async Task<OperationResult> RestoreSnapshotAsync(
        string? entityRegistryPath,
        string? deviceRegistryPath,
        CancellationToken ct)
    {
        var target = ParseProdTarget();
        if (target is null)
            return new OperationResult(false, "Prod SSH not configured", null);
        if (string.IsNullOrWhiteSpace(entityRegistryPath) || !File.Exists(entityRegistryPath))
            return new OperationResult(false, "Registry snapshot file missing", null);

        var entityOk = await PushLocalFileAsync(
            target.Value.userHost,
            entityRegistryPath,
            $"{target.Value.configPath}/.storage/core.entity_registry",
            ct);
        if (!entityOk)
            return new OperationResult(false, "Failed to restore core.entity_registry", null);

        if (!string.IsNullOrWhiteSpace(deviceRegistryPath) && File.Exists(deviceRegistryPath))
        {
            await PushLocalFileAsync(
                target.Value.userHost,
                deviceRegistryPath,
                $"{target.Value.configPath}/.storage/core.device_registry",
                ct);
        }

        return new OperationResult(true, "Registry snapshot restored on prod", null);
    }

    async Task<bool> CopyRemoteFileAsync(string userHost, string remotePath, string localPath, CancellationToken ct)
    {
        var sshBase = SshBase();
        var (ok, stdout, _) = await RunBashAsync(
            $"ssh {sshBase} {ShQ(userHost)} {ShQ($"sudo cat {remotePath}")}",
            ct);
        if (!ok || string.IsNullOrEmpty(stdout))
            return false;

        await File.WriteAllTextAsync(localPath, stdout, ct);
        return true;
    }

    async Task<bool> PushLocalFileAsync(string userHost, string localPath, string remotePath, CancellationToken ct)
    {
        var content = await File.ReadAllTextAsync(localPath, ct);
        var sshBase = SshBase();
        var cmd = $"sudo tee {ShQ(remotePath)} > /dev/null";
        var psi = new ProcessStartInfo("bash")
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        psi.ArgumentList.Add("-c");
        psi.ArgumentList.Add($"ssh {sshBase} {ShQ(userHost)} {ShQ(cmd)}");
        gitSsh.Apply(psi);
        using var proc = Process.Start(psi);
        if (proc is null)
            return false;

        await proc.StandardInput.WriteAsync(content);
        proc.StandardInput.Close();
        await proc.WaitForExitAsync(ct);
        return proc.ExitCode == 0;
    }

    (string userHost, string configPath)? ParseProdTarget()
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

    static async Task<(bool Ok, string Stdout, string Stderr)> RunBashAsync(string script, CancellationToken ct)
    {
        var psi = new ProcessStartInfo("bash")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        psi.ArgumentList.Add("-c");
        psi.ArgumentList.Add(script);
        using var proc = Process.Start(psi);
        if (proc is null)
            return (false, "", "Failed to start bash");
        var stdoutTask = proc.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        return (proc.ExitCode == 0, await stdoutTask, await stderrTask);
    }
}
