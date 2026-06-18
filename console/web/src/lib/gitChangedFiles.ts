import type { GitSnapshot } from "../api";

export function resolveGitChangedFileLists(git?: GitSnapshot | null): {
  haFiles: string[];
  repoFiles: string[];
} {
  if (!git) return { haFiles: [], repoFiles: [] };

  const haFiles =
    (git.haChangedFiles?.length ?? 0) > 0
      ? git.haChangedFiles
      : (git.haChangedSample ?? []);
  const repoFiles =
    (git.repoChangedFiles?.length ?? 0) > 0
      ? git.repoChangedFiles
      : (git.repoChangedSample ?? []);

  return { haFiles, repoFiles };
}
