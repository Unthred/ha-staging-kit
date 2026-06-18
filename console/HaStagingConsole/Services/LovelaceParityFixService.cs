using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class LovelaceParityFixService(
    LovelaceParityDeferStore deferStore,
    LovelaceParityUndoStore undoStore,
    LovelaceParityFixActionStore fixActionStore)
{
    const string RepoRoot = "/repo";

    public Task<LovelaceParityFixResult> ApplyFixAsync(LovelaceParityFixRequest request, CancellationToken ct)
    {
        if (!Directory.Exists(Path.Combine(RepoRoot, ".git")))
        {
            return Task.FromResult(new LovelaceParityFixResult(
                false,
                "Git repo not configured — set the HA config repo path in Settings",
                [],
                0));
        }

        var action = (request.Action ?? "").Trim().ToLowerInvariant();
        if (action == "undo")
            return Task.FromResult(UndoLast());
        if (action == "undo_all")
            return Task.FromResult(UndoAll());

        if (string.IsNullOrWhiteSpace(request.EntityId))
            return Task.FromResult(new LovelaceParityFixResult(false, "Entity id is required", [], 0));

        if (action is "defer" or "undefer")
        {
            var deferred = action == "defer";
            undoStore.Push(new LovelaceParityUndoEntry(
                action,
                request.EntityId.Trim(),
                null,
                new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase),
                DateTimeOffset.UtcNow));

            if (!deferStore.SetDeferred(request.EntityId.Trim(), deferred))
            {
                undoStore.Pop();
                return Task.FromResult(new LovelaceParityFixResult(
                    true,
                    deferred
                        ? $"{request.EntityId} deferred — won't block deploy (cards may error on prod until fixed)."
                        : $"{request.EntityId} restored to blocking list.",
                    [],
                    0));
            }

            if (deferred)
                fixActionStore.Remove(request.EntityId.Trim());

            return Task.FromResult(new LovelaceParityFixResult(
                true,
                deferred
                    ? $"{request.EntityId} deferred — won't block deploy (cards may error on prod until fixed)."
                    : $"{request.EntityId} restored to blocking list.",
                [],
                0));
        }

        LovelaceFixApplyResult result;
        Dictionary<string, string> fileSnapshots;
        try
        {
            fileSnapshots = LovelaceParitySnapshotHelper.SnapshotLovelaceFilesContaining(
                RepoRoot,
                request.EntityId.Trim());

            result = action switch
            {
                "remove" => LovelaceEntityFixer.ApplyRemove(RepoRoot, request.EntityId.Trim()),
                "rename" => LovelaceEntityFixer.ApplyRename(
                    RepoRoot,
                    request.EntityId.Trim(),
                    (request.ReplacementEntityId ?? "").Trim()),
                _ => throw new ArgumentException($"Unknown action: {request.Action}"),
            };
        }
        catch (ArgumentException ex)
        {
            return Task.FromResult(new LovelaceParityFixResult(false, ex.Message, [], 0));
        }

        if (result.ChangeCount == 0)
        {
            return Task.FromResult(new LovelaceParityFixResult(
                false,
                $"No references to {request.EntityId} found in the Lovelace git snapshot",
                [],
                0));
        }

        undoStore.Push(new LovelaceParityUndoEntry(
            action,
            request.EntityId.Trim(),
            request.ReplacementEntityId?.Trim(),
            fileSnapshots,
            DateTimeOffset.UtcNow));

        fixActionStore.Record(
            request.EntityId.Trim(),
            action,
            request.ReplacementEntityId?.Trim());

        return Task.FromResult(new LovelaceParityFixResult(
            true,
            $"Updated {result.ChangeCount} reference(s) in {result.ModifiedFiles.Count} git file(s). Commit staging files → Push to GitHub → Recheck → Deploy to prod.",
            result.ModifiedFiles,
            result.ChangeCount));
    }

    LovelaceParityFixResult UndoLast()
    {
        var entry = undoStore.Pop();
        if (entry is null)
            return new LovelaceParityFixResult(false, "Nothing to undo", [], 0);

        switch (entry.Action)
        {
            case "defer":
                deferStore.SetDeferred(entry.EntityId, deferred: false);
                return new LovelaceParityFixResult(
                    true,
                    $"Undid defer for `{entry.EntityId}`",
                    [],
                    0);
            case "undefer":
                deferStore.SetDeferred(entry.EntityId, deferred: true);
                return new LovelaceParityFixResult(
                    true,
                    $"Undid restore for `{entry.EntityId}` — deferred again",
                    [],
                    0);
            case "remove":
            case "rename":
                fixActionStore.Remove(entry.EntityId);
                break;
        }

        if (entry.FileSnapshots.Count == 0)
        {
            return new LovelaceParityFixResult(
                false,
                $"Undo entry for `{entry.EntityId}` has no saved file snapshots",
                [],
                0);
        }

        foreach (var (relativePath, content) in entry.FileSnapshots)
            File.WriteAllText(Path.Combine(RepoRoot, relativePath), content);

        var label = entry.Action switch
        {
            "remove" => $"Removed `{entry.EntityId}` from dashboard",
            "rename" => $"Renamed `{entry.EntityId}` on the dashboard",
            _ => entry.Action,
        };

        return new LovelaceParityFixResult(
            true,
            $"Undid {label} — restored {entry.FileSnapshots.Count} file(s).",
            entry.FileSnapshots.Keys.Order(StringComparer.Ordinal).ToList(),
            entry.FileSnapshots.Count);
    }

    LovelaceParityFixResult UndoAll()
    {
        var undone = 0;
        var files = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        while (undoStore.Peek() is not null)
        {
            var result = UndoLast();
            if (!result.Ok)
                break;
            undone++;
            foreach (var file in result.FilesChanged)
                files.Add(file);
        }

        if (undone == 0)
            return new LovelaceParityFixResult(false, "Nothing to undo", [], 0);

        fixActionStore.Clear();

        return new LovelaceParityFixResult(
            true,
            $"Undid {undone} local dashboard fix(es) — blockers restored so you can redo them.",
            files.Order(StringComparer.Ordinal).ToList(),
            undone);
    }

    public (bool CanUndo, string? Description) GetUndoStatus()
    {
        var entry = undoStore.Peek();
        if (entry is null)
            return (false, null);

        var label = entry.Action switch
        {
            "remove" => $"remove `{entry.EntityId}`",
            "rename" => $"rename `{entry.EntityId}`",
            "defer" => $"defer `{entry.EntityId}`",
            "undefer" => $"restore `{entry.EntityId}`",
            _ => $"{entry.Action} `{entry.EntityId}`",
        };

        return (true, label);
    }
}
