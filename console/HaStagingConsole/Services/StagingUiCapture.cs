using System.Diagnostics;
using HaStagingConsole.Models;

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
    /// Pull Lovelace from staging when content differs. Mtime is not used — repo files are
    /// often touched by sync/apply without reflecting staging UI edits (see SquiggleBear title drift).
    /// Local git edits to the Lovelace bundle are protected by <see cref="LovelaceBundleModifiedInRepoAsync"/>.
    /// </summary>
    static bool ShouldCaptureLovelaceFromStaging(string stagingPath, string repoPath)
    {
        if (!File.Exists(repoPath))
            return true;

        return !FilesEqual(stagingPath, repoPath);
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

    public LovelaceDriftStatus GetLovelaceDriftStatus()
    {
        var haConfig = EnvFile.Get(paths.ConfigEnvFile, "HA_CONFIG") ?? "/ha-config";
        var stagingStorage = Path.Combine(haConfig, ".storage");
        var repoStorage = Path.Combine("/repo", ".storage");
        var stagingLovelace = Path.Combine(stagingStorage, "lovelace.lovelace");
        var repoLovelace = Path.Combine(repoStorage, "lovelace.lovelace");

        if (!File.Exists(stagingLovelace) || !File.Exists(repoLovelace))
        {
            return new LovelaceDriftStatus(false, false, false, null, null, null, [], "Lovelace dashboard files not found");
        }

        var stagingDiffersFromRepo = !FilesEqual(stagingLovelace, repoLovelace);
        var stagingTitle = TryReadPrimaryLovelaceTitle(stagingLovelace);
        var repoTitle = TryReadPrimaryLovelaceTitle(repoLovelace);
        var detail = stagingDiffersFromRepo
            ? $"Staging HA dashboard ({stagingTitle ?? "unknown title"}) differs from git workbench ({repoTitle ?? "unknown title"})."
            : "Staging HA dashboard matches git workbench.";

        return new LovelaceDriftStatus(
            true,
            stagingDiffersFromRepo,
            false,
            stagingTitle,
            repoTitle,
            null,
            stagingDiffersFromRepo ? [".storage/lovelace.lovelace"] : [],
            detail);
    }

    public static string? TryReadPrimaryLovelaceTitle(string lovelacePath)
    {
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(lovelacePath));
            if (TryReadTitleFromNode(doc.RootElement, out var title))
                return title;
        }
        catch
        {
            /* best effort */
        }

        return null;
    }

    public static bool TryReadTitleFromNode(System.Text.Json.JsonElement node, out string? title)
    {
        title = null;
        if (node.ValueKind != System.Text.Json.JsonValueKind.Object)
            return false;

        if (node.TryGetProperty("data", out var data)
            && data.TryGetProperty("config", out var config)
            && config.TryGetProperty("views", out var views)
            && views.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var view in views.EnumerateArray())
            {
                if (view.TryGetProperty("title", out var titleProp))
                {
                    var value = titleProp.GetString();
                    if (!string.IsNullOrWhiteSpace(value))
                    {
                        title = value.Trim();
                        return true;
                    }
                }
            }
        }

        if (node.TryGetProperty("views", out var rootViews) && rootViews.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var view in rootViews.EnumerateArray())
            {
                if (view.TryGetProperty("title", out var titleProp))
                {
                    var value = titleProp.GetString();
                    if (!string.IsNullOrWhiteSpace(value))
                    {
                        title = value.Trim();
                        return true;
                    }
                }
            }
        }

        return false;
    }
}
