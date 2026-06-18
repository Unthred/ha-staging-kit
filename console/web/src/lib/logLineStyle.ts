import type { ComponentIssue } from "../api";
import {
  expandHaLogBlocks,
  groupIndicesIntoBlocks,
  issueDomain,
  seedHaIssueLogMatches,
} from "./haIssueLog";

export type LogLineLevel = "error" | "warn" | "info" | "debug" | "plain";

export type ColoredLogEntry = {
  text: string;
  level: LogLineLevel;
  match: boolean;
};

export type HaIssueLogViewMode = "filtered" | "full" | "tail";

export function classifyLogLineLevel(line: string): LogLineLevel {
  if (/\bERROR\b/.test(line)) return "error";
  if (/\bWARNING\b|\bWARN\b/.test(line)) return "warn";
  if (/\bINFO\b/.test(line)) return "info";
  if (/\bDEBUG\b/.test(line)) return "debug";
  return "plain";
}

export function toColoredLogEntry(text: string, match: boolean): ColoredLogEntry {
  return { text, level: classifyLogLineLevel(text), match };
}

function entriesFromBlocks(
  lines: readonly string[],
  blocks: number[][],
  highlight: ReadonlySet<number>,
): ColoredLogEntry[] {
  const entries: ColoredLogEntry[] = [];
  blocks.forEach((block, blockIdx) => {
    if (blockIdx > 0) {
      entries.push({ text: "…", level: "plain", match: false });
    }
    for (const i of block) {
      entries.push(toColoredLogEntry(lines[i], highlight.has(i)));
    }
  });
  return entries;
}

export function buildHaIssueLogDisplay(
  issue: ComponentIssue,
  lines: readonly string[],
  mode: HaIssueLogViewMode,
): { entries: ColoredLogEntry[]; filtered: boolean; matchCount: number; blockCount: number } {
  if (lines.length === 0) return { entries: [], filtered: false, matchCount: 0, blockCount: 0 };

  const seeds = seedHaIssueLogMatches(lines, issue);
  const highlighted = expandHaLogBlocks(lines, seeds);
  const blocks = groupIndicesIntoBlocks(highlighted);

  if (mode === "tail") {
    const start = Math.max(0, lines.length - 60);
    return {
      entries: lines.slice(start).map((text, offset) =>
        toColoredLogEntry(text, highlighted.has(start + offset)),
      ),
      filtered: false,
      matchCount: seeds.size,
      blockCount: blocks.length,
    };
  }

  if (seeds.size === 0) {
    return { entries: [], filtered: false, matchCount: 0, blockCount: 0 };
  }

  if (mode === "full") {
    return {
      entries: lines.map((text, i) => toColoredLogEntry(text, highlighted.has(i))),
      filtered: false,
      matchCount: seeds.size,
      blockCount: blocks.length,
    };
  }

  const recentBlocks = blocks;
  return {
    entries: entriesFromBlocks(lines, recentBlocks, highlighted),
    filtered: true,
    matchCount: seeds.size,
    blockCount: recentBlocks.length,
  };
}

export function haIssueLogEmptyHint(issue: ComponentIssue): string {
  const domain = issueDomain(issue) ?? "this integration";
  return (
    `No log lines in home-assistant.log mention ${domain}. If this integration failed at startup, try HA → Settings → System → Logs and search for "${domain}".`
  );
}
