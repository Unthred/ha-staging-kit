import { ColoredLogView, plainLinesToColored } from "./ColoredLogView";

export function LogPanel({
  title,
  path,
  lines,
  emptyMessage = "No log lines available.",
}: {
  title: string;
  path?: string | null;
  lines: string[];
  emptyMessage?: string;
}) {
  return (
    <section className="card diag-log-panel">
      <header className="diag-log-head">
        <div>
          <h3>{title}</h3>
          {path && (
            <p className="muted diag-log-path">
              <code>{path}</code>
            </p>
          )}
        </div>
        <span className="muted diag-log-count">{lines.length} line(s)</span>
      </header>
      {lines.length === 0 ? (
        <p className="muted diag-log-empty">{emptyMessage}</p>
      ) : (
        <ColoredLogView entries={plainLinesToColored(lines)} />
      )}
    </section>
  );
}
