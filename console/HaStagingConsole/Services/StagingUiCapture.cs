using System.Diagnostics;

namespace HaStagingConsole.Services;

/// <summary>
/// Detects Lovelace / UI helper edits on staging HA and copies them into the config repo
/// (same files as snapshot-from-staging.sh). Skips when the repo already has local Lovelace edits
/// (e.g. parity-fix apply) so staging disk cannot stomp kit-authored changes.
/// </summary>
public sealed class StagingUiCapture(KitPaths paths, SidecarRunner sidecar)
{
    static readonly string[] CaptureFiles =
    [
        "lovelace.lovelace",
        "lovelace.map",
        "lovelace_dashboards",
        "lovelace_resources",
        "input_boolean",
        "input_number",
        "input_select",
        "input_text",
        "input_datetime",
        "timer",
        "counter",
        "schedule",
        "todo",
        "scheduler.storage",
    ];

    static readonly string[] LovelaceCaptureFiles =
    [
        "lovelace.lovelace",
        "lovelace.map",
        "lovelace_dashboards",
        "lovelace_resources",
    ];

    public bool HasPendingChanges()
    {
        if (!Directory.Exists("/repo/.git"))
            return false;

        var haConfig = EnvFile.Get(paths.ConfigEnvFile, "HA_CONFIG") ?? "/ha-config";
        var stagingStorage = Path.Combine(haConfig, ".storage");
        var repoStorage = Path.Combine("/repo", ".storage");

        if (!Directory.Exists(stagingStorage))
            return false;

        foreach (var fname in CaptureFiles)
        {
            var src = Path.Combine(stagingStorage, fname);
            if (!File.Exists(src))
                continue;

            var dest = Path.Combine(repoStorage, fname);
            if (!File.Exists(dest) || !FilesEqual(src, dest))
                return true;
        }

        return false;
    }

    public async Task CaptureIfNeededAsync(CancellationToken ct)
    {
        if (!HasPendingChanges())
            return;

        if (await LovelaceBundleModifiedInRepoAsync(ct))
            return;

        await CaptureFromStagingAsync(ct);
    }

    Task CaptureFromStagingAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var haConfig = EnvFile.Get(paths.ConfigEnvFile, "HA_CONFIG") ?? "/ha-config";
        var stagingStorage = Path.Combine(haConfig, ".storage");
        var repoStorage = Path.Combine("/repo", ".storage");
        Directory.CreateDirectory(repoStorage);

        foreach (var fname in CaptureFiles)
        {
            var src = Path.Combine(stagingStorage, fname);
            if (!File.Exists(src))
                continue;

            var dest = Path.Combine(repoStorage, fname);
            if (FilesEqual(src, dest))
                continue;

            if (IsLovelaceCaptureFile(fname) && !ShouldCaptureLovelaceFromStaging(src, dest))
                continue;

            File.Copy(src, dest, overwrite: true);
        }

        return Task.CompletedTask;
    }

    static bool IsLovelaceCaptureFile(string fname) =>
        LovelaceCaptureFiles.Contains(fname, StringComparer.Ordinal);

    /// <summary>
    /// Only pull Lovelace from staging when staging is at least as new as the repo copy.
    /// Prevents a stale staging disk from overwriting git-committed dashboard edits on refresh.
    /// </summary>
    static bool ShouldCaptureLovelaceFromStaging(string stagingPath, string repoPath)
    {
        if (!File.Exists(repoPath))
            return true;

        var stagingTime = File.GetLastWriteTimeUtc(stagingPath);
        var repoTime = File.GetLastWriteTimeUtc(repoPath);
        return stagingTime >= repoTime;
    }

    static async Task<bool> LovelaceBundleModifiedInRepoAsync(CancellationToken ct)
    {
        if (!Directory.Exists("/repo/.git"))
            return false;

        var psi = new ProcessStartInfo("git")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        psi.ArgumentList.Add("-C");
        psi.ArgumentList.Add("/repo");
        psi.ArgumentList.Add("status");
        psi.ArgumentList.Add("--porcelain");
        foreach (var file in LovelaceCaptureFiles)
        {
            psi.ArgumentList.Add("--");
            psi.ArgumentList.Add($".storage/{file}");
        }

        using var proc = Process.Start(psi) ?? throw new InvalidOperationException("Failed to start git");
        var stdout = await proc.StandardOutput.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        return proc.ExitCode == 0 && !string.IsNullOrWhiteSpace(stdout);
    }

    static bool FilesEqual(string left, string right)
    {
        var leftInfo = new FileInfo(left);
        var rightInfo = new FileInfo(right);
        if (leftInfo.Length != rightInfo.Length)
            return false;

        using var leftStream = File.OpenRead(left);
        using var rightStream = File.OpenRead(right);
        Span<byte> leftBuf = stackalloc byte[8192];
        Span<byte> rightBuf = stackalloc byte[8192];
        int readLeft;
        while ((readLeft = leftStream.Read(leftBuf)) > 0)
        {
            var readRight = rightStream.Read(rightBuf[..readLeft]);
            if (readRight != readLeft || !leftBuf[..readLeft].SequenceEqual(rightBuf[..readRight]))
                return false;
        }

        return rightStream.Read(rightBuf) == 0;
    }
}
