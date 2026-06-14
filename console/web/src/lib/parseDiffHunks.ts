export type DiffHunk = {
  header: string;
  lines: string[];
};

export type ParsedDiff = {
  preamble: string[];
  hunks: DiffHunk[];
};

export function parseDiffSections(diff: string): ParsedDiff {
  const preamble: string[] = [];
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      if (current) hunks.push(current);
      current = { header: line, lines: [] };
      continue;
    }

    if (current) current.lines.push(line);
    else preamble.push(line);
  }

  if (current) hunks.push(current);
  return { preamble, hunks };
}

export function diffHunkCount(diff: string | null | undefined): number {
  if (!diff?.trim()) return 0;
  const { hunks } = parseDiffSections(diff);
  return Math.max(hunks.length, 1);
}
