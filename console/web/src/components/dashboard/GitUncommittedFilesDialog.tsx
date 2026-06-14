import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dashboardApi, toApiError, type GitSnapshot } from "../../api";
import { diffHunkCount, parseDiffSections } from "../../lib/parseDiffHunks";

function DiffView({ diff, activeHunkIndex }: { diff: string; activeHunkIndex: number }) {
  const activeRef = useRef<HTMLDivElement>(null);
  const { preamble, hunks } = useMemo(() => parseDiffSections(diff), [diff]);
  const hasHunks = hunks.length > 0;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeHunkIndex, diff]);

  const renderLine = (line: string, key: string) => {
    let className = "dash-git-diff-line";
    if (line.startsWith("+++") || line.startsWith("---")) className += " dash-git-diff-meta";
    else if (line.startsWith("+")) className += " dash-git-diff-add";
    else if (line.startsWith("-")) className += " dash-git-diff-del";
    else if (line.startsWith("@@")) className += " dash-git-diff-hunk";
    return (
      <span key={key} className={className}>
        {line}
        {"\n"}
      </span>
    );
  };

  if (!hasHunks) {
    return (
      <pre className="dash-git-diff-pre">
        <div className="dash-git-diff-hunk-block dash-git-diff-hunk-block-active" ref={activeRef}>
          {diff.split("\n").map((line, i) => renderLine(line, `whole-${i}`))}
        </div>
      </pre>
    );
  }

  return (
    <pre className="dash-git-diff-pre">
      {preamble.map((line, i) => renderLine(line, `pre-${i}`))}
      {hunks.map((hunk, hunkIndex) => {
        const active = hunkIndex === activeHunkIndex;
        return (
          <div
            key={`hunk-${hunkIndex}-${hunk.header.slice(0, 24)}`}
            ref={active ? activeRef : undefined}
            className={`dash-git-diff-hunk-block ${active ? "dash-git-diff-hunk-block-active" : ""}`}
          >
            {renderLine(hunk.header, `h-${hunkIndex}-head`)}
            {hunk.lines.map((line, lineIndex) => renderLine(line, `h-${hunkIndex}-${lineIndex}`))}
          </div>
        );
      })}
    </pre>
  );
}

function FileList({
  title,
  tone,
  files,
  selectedPath,
  onSelect,
}: {
  title: string;
  tone: "ha" | "repo";
  files: string[];
  selectedPath?: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <div className={`dash-git-files-group dash-git-files-group-${tone}`}>
      <header className="dash-git-files-group-head">
        <h4>{title}</h4>
        <span className="dash-git-files-count">{files.length}</span>
      </header>
      {files.length === 0 ? (
        <p className="muted dash-git-files-empty">None</p>
      ) : (
        <ul className="dash-git-files-list">
          {files.map((path) => (
            <li key={path}>
              <button
                type="button"
                className={`dash-git-file-btn ${selectedPath === path ? "active" : ""}`}
                onClick={() => onSelect(path)}
              >
                <code>{path}</code>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GitUncommittedFilesDialog({
  git,
  open,
  onClose,
  onCommitted,
}: {
  git?: GitSnapshot | null;
  open: boolean;
  onClose: () => void;
  onCommitted?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedHunkIndex, setSelectedHunkIndex] = useState(0);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffStatus, setDiffStatus] = useState<string | null>(null);
  const [diffBusy, setDiffBusy] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitBusy, setCommitBusy] = useState<"ha" | "repo" | null>(null);
  const [commitFeedback, setCommitFeedback] = useState<{ tone: "ok" | "err"; message: string } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSelectedPath(null);
      setSelectedHunkIndex(0);
      setDiff(null);
      setDiffStatus(null);
      setDiffError(null);
      setDiffBusy(false);
      setCommitMessage("");
      setCommitBusy(null);
      setCommitFeedback(null);
    }
  }, [open]);

  const loadDiff = useCallback(async (path: string, initialHunkIndex = 0) => {
    setSelectedPath(path);
    setDiffBusy(true);
    setDiffError(null);
    setDiff(null);
    try {
      const result = await dashboardApi.gitDiff(path);
      setDiff(result.diff);
      setDiffStatus(result.status);
      const count = diffHunkCount(result.diff);
      const index = initialHunkIndex < 0 ? count - 1 : Math.min(initialHunkIndex, count - 1);
      setSelectedHunkIndex(Math.max(index, 0));
    } catch (e) {
      setDiffError(toApiError(e).detail);
      setDiffStatus(null);
      setSelectedHunkIndex(0);
    } finally {
      setDiffBusy(false);
    }
  }, []);

  const haFiles = git?.haChangedFiles ?? git?.haChangedSample ?? [];
  const repoFiles = git?.repoChangedFiles ?? git?.repoChangedSample ?? [];
  const allFiles = useMemo(() => [...haFiles, ...repoFiles], [haFiles, repoFiles]);
  const selectedIndex = selectedPath ? allFiles.indexOf(selectedPath) : -1;
  const hunkCount = diffHunkCount(diff);

  const goToChange = useCallback(
    (delta: number) => {
      if (allFiles.length === 0) return;

      if (delta < 0) {
        if (selectedHunkIndex > 0) {
          setSelectedHunkIndex((i) => i - 1);
          return;
        }
        if (selectedIndex > 0) {
          void loadDiff(allFiles[selectedIndex - 1], -1);
        }
        return;
      }

      if (hunkCount > 0 && selectedHunkIndex < hunkCount - 1) {
        setSelectedHunkIndex((i) => i + 1);
        return;
      }
      if (selectedIndex >= 0 && selectedIndex < allFiles.length - 1) {
        void loadDiff(allFiles[selectedIndex + 1], 0);
      } else if (selectedIndex < 0) {
        void loadDiff(allFiles[0], 0);
      }
    },
    [allFiles, hunkCount, loadDiff, selectedHunkIndex, selectedIndex],
  );

  const canGoPrev = selectedHunkIndex > 0 || selectedIndex > 0;
  const canGoNext =
    (hunkCount > 0 && selectedHunkIndex < hunkCount - 1) ||
    (selectedIndex >= 0 && selectedIndex < allFiles.length - 1) ||
    (selectedIndex < 0 && allFiles.length > 0);

  const commitScope = useCallback(
    async (scope: "ha" | "repo") => {
      setCommitBusy(scope);
      setCommitFeedback(null);
      try {
        const result = await dashboardApi.gitCommit({
          scope,
          message: commitMessage.trim() || undefined,
        });
        if (result.ok) {
          setCommitFeedback({ tone: "ok", message: result.message });
          setCommitMessage("");
          onCommitted?.();
          if (scope === "ha" && selectedPath && !haFiles.includes(selectedPath)) {
            setSelectedPath(null);
            setDiff(null);
          }
          if (scope === "repo" && selectedPath && !repoFiles.includes(selectedPath)) {
            setSelectedPath(null);
            setDiff(null);
          }
        } else {
          const detail = result.logTail ? `${result.message} — ${result.logTail}` : result.message;
          setCommitFeedback({ tone: "err", message: detail });
        }
      } catch (e) {
        setCommitFeedback({ tone: "err", message: toApiError(e).detail });
      } finally {
        setCommitBusy(null);
      }
    },
    [commitMessage, haFiles, onCommitted, repoFiles, selectedPath],
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToChange(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToChange(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToChange, open]);

  if (!git?.configured) return null;

  return (
    <dialog
      ref={dialogRef}
      className="dash-git-files-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="dash-git-files-dialog-panel" onClick={(e) => e.stopPropagation()}>
        <header className="dash-git-files-dialog-head">
          <div>
            <h3>Uncommitted files</h3>
            <p className="muted">
              Step through each change with Previous/Next · commit HA YAML and docs separately
            </p>
          </div>
          <button type="button" className="btn secondary dash-git-files-close" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>

        <div className="dash-git-files-dialog-body">
          <FileList title="HA YAML" tone="ha" files={haFiles} selectedPath={selectedPath} onSelect={(p) => void loadDiff(p, 0)} />
          <FileList
            title="Docs / repo"
            tone="repo"
            files={repoFiles}
            selectedPath={selectedPath}
            onSelect={(p) => void loadDiff(p, 0)}
          />
        </div>

        <section className="dash-git-diff-panel" aria-live="polite">
          {!selectedPath && <p className="muted dash-git-diff-placeholder">Select a file above to view changes vs git HEAD.</p>}
          {selectedPath && diffBusy && <p className="muted dash-git-diff-placeholder">Loading diff for {selectedPath}…</p>}
          {selectedPath && diffError && !diffBusy && <p className="dash-git-diff-error">{diffError}</p>}
          {selectedPath && !diffBusy && (
            <>
              <header className="dash-git-diff-head">
                <div className="dash-git-diff-head-main">
                  <code>{selectedPath}</code>
                  {diffStatus && <span className="dash-badge dash-badge-info">{diffStatus}</span>}
                  {hunkCount > 0 && (
                    <span className="muted dash-git-diff-position">
                      Change {selectedHunkIndex + 1} of {hunkCount}
                    </span>
                  )}
                  {selectedIndex >= 0 && (
                    <span className="muted dash-git-diff-position">
                      File {selectedIndex + 1} of {allFiles.length}
                    </span>
                  )}
                </div>
                {allFiles.length > 0 && (
                  <div className="dash-git-diff-nav">
                    <button
                      type="button"
                      className="btn secondary dash-git-diff-nav-btn"
                      disabled={!canGoPrev}
                      onClick={() => goToChange(-1)}
                    >
                      Previous change
                    </button>
                    <button
                      type="button"
                      className="btn secondary dash-git-diff-nav-btn"
                      disabled={!canGoNext}
                      onClick={() => goToChange(1)}
                    >
                      Next change
                    </button>
                  </div>
                )}
              </header>
              {diff && <DiffView diff={diff} activeHunkIndex={selectedHunkIndex} />}
            </>
          )}
        </section>

        {(git.isHaDirty || git.isRepoDirty) && (
          <footer className="dash-git-commit-bar">
            {commitFeedback && (
              <p className={`dash-git-commit-feedback dash-git-commit-feedback-${commitFeedback.tone}`} role="status">
                {commitFeedback.message}
              </p>
            )}
            <label className="dash-git-commit-message">
              <span className="muted">Commit message (optional)</span>
              <input
                type="text"
                value={commitMessage}
                placeholder="Default message used if empty"
                onChange={(e) => setCommitMessage(e.target.value)}
                disabled={commitBusy !== null}
              />
            </label>
            <div className="dash-git-commit-actions">
              {git.isHaDirty && (
                <button
                  type="button"
                  className="btn dash-git-commit-btn-ha"
                  disabled={commitBusy !== null}
                  onClick={() => void commitScope("ha")}
                >
                  {commitBusy === "ha" ? "Committing…" : `Commit ${git.haChangedFileCount} HA YAML`}
                </button>
              )}
              {git.isRepoDirty && (
                <button
                  type="button"
                  className="btn secondary dash-git-commit-btn-repo"
                  disabled={commitBusy !== null}
                  onClick={() => void commitScope("repo")}
                >
                  {commitBusy === "repo" ? "Committing…" : `Commit ${git.repoChangedFileCount} docs/repo`}
                </button>
              )}
            </div>
          </footer>
        )}
      </div>
    </dialog>
  );
}
