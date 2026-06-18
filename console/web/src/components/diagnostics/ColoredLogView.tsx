import type { ColoredLogEntry } from "../../lib/logLineStyle";
import { classifyLogLineLevel } from "../../lib/logLineStyle";

export function ColoredLogView({ entries }: { entries: ColoredLogEntry[] }) {
  return (
    <pre className="diag-scroll-log diag-colored-log">
      {entries.map((entry, i) => (
        <span
          key={i}
          className={[
            entry.text === "…" ? "diag-log-line diag-log-line--gap" : "diag-log-line",
            entry.text !== "…" ? `diag-log-line--${entry.level}` : "",
            entry.match ? "diag-log-line--issue-match" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {entry.text}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

export function plainLinesToColored(lines: readonly string[]): ColoredLogEntry[] {
  return lines.map((text) => ({
    text,
    level: classifyLogLineLevel(text),
    match: false,
  }));
}
