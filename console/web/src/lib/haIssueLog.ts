import type { ComponentIssue } from "../api";

const HA_LOG_START = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/;

export function issueDomain(issue: ComponentIssue): string | null {
  if (issue.domain?.trim()) return issue.domain.trim().toLowerCase();
  const match = issue.message.match(/\(([a-z0-9_]+)\):\s/i);
  return match?.[1]?.toLowerCase() ?? null;
}

/** Domain variants seen in HA core logs (e.g. androidtv_remote → androidtv). */
export function domainLogVariants(domain: string): string[] {
  const variants = new Set<string>([domain]);
  const underscore = domain.indexOf("_");
  if (underscore > 0) {
    variants.add(domain.slice(0, underscore));
  }
  return [...variants];
}

/** Search terms from structured config-entry fields collected by the kit API. */
export function haIssueLogTerms(issue: ComponentIssue): string[] {
  const domain = issueDomain(issue);
  const terms = new Set<string>();

  const titleMatch = issue.message.match(/^(.+?)\s+\([a-z0-9_]+\):/i);
  if (titleMatch?.[1]?.trim()) {
    terms.add(titleMatch[1].trim());
  }

  if (domain) {
    for (const variant of domainLogVariants(domain)) {
      terms.add(variant);
      terms.add(`homeassistant.components.${variant}`);
      terms.add(`custom_components.${variant}`);
      terms.add(`${variant} integration`);
      terms.add(`[${variant}]`);
      terms.add(`[homeassistant.components.${variant}]`);
    }
  }

  const reason = issue.reason?.trim() ?? "";
  const reasonFromMessage =
    reason.length > 0 ? reason : issue.message.includes(" — ") ? issue.message.split(" — ").slice(1).join(" — ") : "";

  if (reasonFromMessage) {
    const ip = reasonFromMessage.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/)?.[0];
    if (ip) terms.add(ip);
    for (const q of reasonFromMessage.matchAll(/'([^']+)'/g)) {
      if (q[1].length > 2) terms.add(q[1]);
    }
  }

  return [...terms].filter((t) => t.length >= 3);
}

export function isHaLogRecordStart(line: string): boolean {
  return HA_LOG_START.test(line.trim());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineMatchesTerm(line: string, term: string, domain: string | null): boolean {
  const lower = line.toLowerCase();
  const t = term.toLowerCase();
  if (t.includes("." ) || t.includes(" integration")) return lower.includes(t);
  if (new RegExp(`\\b${escapeRegExp(t)}\\b`).test(lower)) return true;
  if (domain && configEntryLineMatches(lower, domain)) return true;
  return false;
}

function configEntryLineMatches(lower: string, domain: string): boolean {
  const d = domain.toLowerCase();
  return (
    lower.includes(`error setting up entry`) && lower.includes(` for ${d}`) ||
    lower.includes(`integration ${d}`) ||
    lower.includes(`setting up ${d}`)
  );
}

/** Lines that directly mention the integration (using API domain/reason from collection time). */
export function seedHaIssueLogMatches(lines: readonly string[], issue: ComponentIssue): Set<number> {
  const domain = issueDomain(issue);
  const terms = haIssueLogTerms(issue);
  const seeds = new Set<number>();

  lines.forEach((line, i) => {
    const lower = line.toLowerCase();
    if (domain && configEntryLineMatches(lower, domain)) {
      seeds.add(i);
      return;
    }
    if (terms.some((term) => lineMatchesTerm(line, term, domain))) seeds.add(i);
  });

  return seeds;
}

/**
 * Expand seed hits to whole HA log records — timestamped line plus traceback/continuation below,
 * and any continuation lines above the hit within the same record.
 */
export function expandHaLogBlocks(lines: readonly string[], seeds: ReadonlySet<number>): Set<number> {
  const expanded = new Set<number>();
  for (const i of seeds) {
    expanded.add(i);
    for (let j = i - 1; j >= 0 && !isHaLogRecordStart(lines[j]); j--) {
      expanded.add(j);
    }
    for (let j = i + 1; j < lines.length && !isHaLogRecordStart(lines[j]); j++) {
      expanded.add(j);
    }
  }
  return expanded;
}

export function groupIndicesIntoBlocks(indices: ReadonlySet<number>): number[][] {
  if (indices.size === 0) return [];
  const sorted = [...indices].sort((a, b) => a - b);
  const blocks: number[][] = [];
  let current = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      current.push(sorted[i]);
    } else {
      blocks.push(current);
      current = [sorted[i]];
    }
  }
  blocks.push(current);
  return blocks;
}

export function countHaIssuesByLevel(issues: ComponentIssue[]) {
  let errors = 0;
  let warnings = 0;
  for (const issue of issues) {
    if (issue.level === "error") errors++;
    else warnings++;
  }
  return { errors, warnings, total: issues.length };
}

export function countHaIssuesForSource(issues: ComponentIssue[], source: string) {
  const filtered = issues.filter((i) => i.source === source);
  return countHaIssuesByLevel(filtered);
}
