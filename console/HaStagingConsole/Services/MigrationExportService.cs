using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class MigrationExportService
{
    const string RepoRoot = "/repo";
    const string PendingDir = "migrations/pending";

    public Task<ExportMigrationResult> ExportAsync(ExportMigrationRequest request, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        if (!Directory.Exists(Path.Combine(RepoRoot, ".git")))
        {
            return Task.FromResult(new ExportMigrationResult(
                false,
                "Git repo not configured — set the HA config repo path in Settings",
                null,
                null,
                [],
                0));
        }

        try
        {
            MigrationManifestDraft draft = request.Source switch
            {
                "naming" when request.Naming is not null =>
                    MigrationManifestBuilder.FromNamingIssue(request.Naming, RepoRoot),
                "deploy-gate" when request.DeployGate is not null =>
                    MigrationManifestBuilder.FromDeployGateIssue(request.DeployGate, RepoRoot),
                _ => throw new ArgumentException("Invalid export source — naming or deploy-gate payload required."),
            };

            var pendingRoot = Path.Combine(RepoRoot, PendingDir);
            Directory.CreateDirectory(pendingRoot);

            var manifestRelative = Path.Combine(PendingDir, $"{draft.Id}.yaml").Replace('\\', '/');
            var manifestPath = Path.Combine(RepoRoot, manifestRelative);
            if (File.Exists(manifestPath))
            {
                return Task.FromResult(new ExportMigrationResult(
                    false,
                    $"Migration `{draft.Id}` already exists at `{manifestRelative}` — remove or rename it before exporting again.",
                    manifestRelative,
                    draft.Id,
                    [],
                    0));
            }

            var gitFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var gitChangeCount = 0;
            foreach (var replace in MigrationManifestBuilder.CollectGitReplacements(draft))
            {
                var result = ConfigEntityFixer.ApplyReplaceInPaths(
                    RepoRoot,
                    replace.FromEntityId,
                    replace.ToEntityId,
                    replace.Paths);
                gitChangeCount += result.ChangeCount;
                foreach (var file in result.ModifiedFiles)
                    gitFiles.Add(file);
            }

            File.WriteAllText(manifestPath, MigrationManifestYamlWriter.Write(draft));

            var message =
                gitFiles.Count > 0
                    ? $"Exported `{manifestRelative}` and updated {gitChangeCount} reference(s) in {gitFiles.Count} git file(s). Review, commit staging, then push — release agent applies registry steps on prod."
                    : $"Exported `{manifestRelative}` (registry-only). Review, commit staging, then push — release agent applies on prod.";

            return Task.FromResult(new ExportMigrationResult(
                true,
                message,
                manifestRelative,
                draft.Id,
                gitFiles.Order(StringComparer.Ordinal).ToList(),
                gitChangeCount));
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            return Task.FromResult(new ExportMigrationResult(false, ex.Message, null, null, [], 0));
        }
    }
}
