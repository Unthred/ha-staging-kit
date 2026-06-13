using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class PathBrowserService(KitPaths paths)
{
    static readonly string[] ExtraRoots = ["/mnt/user", "/mnt/cache"];

    public IReadOnlyList<MountHint> GetMountHints(OnboardingState state)
    {
        var hints = new List<MountHint>
        {
            new("Kit app (internal)", paths.KitRoot, "Not a Settings path — app code inside the container"),
            new("Kit data (internal mount)", paths.SidecarData, "Configure the host folder as Kit data directory"),
        };

        AddIfExists(hints, "HA config git repo", FirstNonEmpty(state.Paths.HaConfigRepo, EnvFile.Get(paths.EnvFile, "HA_CONFIG_REPO")), "Mounted read-only at /repo");
        AddIfExists(hints, "Staging HA config", FirstNonEmpty(state.Paths.HaStagingConfig, EnvFile.Get(paths.EnvFile, "HA_STAGING_CONFIG")), "Mounted at /ha-config");
        AddIfExists(hints, "Kit data directory", FirstNonEmpty(state.Paths.SidecarData, EnvFile.Get(paths.EnvFile, "SIDECAR_DATA")), "Tokens, SSH key, sync.log");
        AddIfExists(hints, "Mirror data", FirstNonEmpty(state.Paths.MirrorData, EnvFile.Get(paths.EnvFile, "MIRROR_DATA")), "MQTT mirror only");

        foreach (var root in ExtraRoots)
        {
            var label = root == "/mnt/user" ? "Unraid appdata root" : "Unraid cache pool";
            AddIfExists(hints, label, root, "Browse shortcut — pick a folder under here");
        }

        return hints;
    }

    public BrowseResult Browse(string? requestedPath, OnboardingState state)
    {
        var allowed = AllowedRoots(state);
        if (allowed.Count == 0)
            return new BrowseResult("", [], "No browse roots available — set paths in .env and ensure directories are mounted in ha-staging-kit-web.");

        var path = string.IsNullOrWhiteSpace(requestedPath)
            ? allowed[0]
            : Path.GetFullPath(requestedPath.Trim());

        if (!IsUnderAllowedRoot(path, allowed))
            return new BrowseResult(path, [], "Path is outside allowed browse locations.");

        if (!Directory.Exists(path))
            return new BrowseResult(path, [], $"Directory not found: {path}");

        try
        {
            var entries = new List<BrowseEntry>();
            foreach (var dir in Directory.EnumerateDirectories(path).OrderBy(p => p, StringComparer.OrdinalIgnoreCase))
            {
                var name = Path.GetFileName(dir);
                if (name.StartsWith('.') && name is not ".git")
                    continue;
                entries.Add(new BrowseEntry(name, dir, true, null));
            }

            foreach (var file in Directory.EnumerateFiles(path).OrderBy(p => p, StringComparer.OrdinalIgnoreCase))
            {
                var name = Path.GetFileName(file);
                if (name.StartsWith('.'))
                    continue;
                string? badge = null;
                if (name is "configuration.yaml" or "docker-compose.yml" or ".env")
                    badge = "config";
                if (Directory.Exists(Path.Combine(path, ".git")) && name is "README.md")
                    badge = "readme";
                entries.Add(new BrowseEntry(name, file, false, badge));
            }

            var isGit = Directory.Exists(Path.Combine(path, ".git"));
            var parent = Directory.GetParent(path)?.FullName;
            var canGoUp = parent is not null && IsUnderAllowedRoot(parent, allowed);

            return new BrowseResult(path, entries, null, isGit, canGoUp ? parent : null);
        }
        catch (Exception ex)
        {
            return new BrowseResult(path, [], ex.Message);
        }
    }

    List<string> AllowedRoots(OnboardingState state)
    {
        var roots = new HashSet<string>(StringComparer.Ordinal);
        void Add(string? p)
        {
            if (string.IsNullOrWhiteSpace(p)) return;
            try
            {
                var full = Path.GetFullPath(p.Trim());
                if (Directory.Exists(full))
                    roots.Add(full);
            }
            catch { /* ignore invalid paths */ }
        }

        Add(paths.KitRoot);
        Add(paths.SidecarData);
        Add(state.Paths.HaConfigRepo);
        Add(state.Paths.HaStagingConfig);
        Add(state.Paths.SidecarData);
        Add(state.Paths.MirrorData);
        Add(EnvFile.Get(paths.EnvFile, "HA_CONFIG_REPO"));
        Add(EnvFile.Get(paths.EnvFile, "HA_STAGING_CONFIG"));
        Add(EnvFile.Get(paths.EnvFile, "MIRROR_DATA"));
        Add(EnvFile.Get(paths.EnvFile, "SIDECAR_DATA"));

        foreach (var root in ExtraRoots)
            Add(root);

        return roots.OrderBy(r => r.Length).ToList();
    }

    static bool IsUnderAllowedRoot(string path, IReadOnlyList<string> allowed)
    {
        var full = Path.GetFullPath(path);
        foreach (var root in allowed)
        {
            if (full.Equals(root, StringComparison.Ordinal) || full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                return true;
        }
        return false;
    }

    static void AddIfExists(List<MountHint> hints, string label, string? path, string? detail = null)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        try
        {
            var full = Path.GetFullPath(path.Trim());
            if (Directory.Exists(full))
                hints.Add(new MountHint(label, full, detail ?? (File.Exists(Path.Combine(full, ".git", "HEAD")) ? "Git repo detected" : null)));
        }
        catch { /* ignore */ }
    }

    static string? FirstNonEmpty(params string?[] values) =>
        values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
}
