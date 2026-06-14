export function LogPanel({
  title,
  path,
  lines,
  emptyMessage = "No log lines available.",
  expanded = true,
}: {
  title: string;
  path?: string | null;
  lines: string[];
  emptyMessage?: string;
  expanded?: boolean;
}) {
  return (
    <section className="diag-log-panel">
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
        <p className="muted">{emptyMessage}</p>
      ) : (
        <pre className={`diag-log-pre ${expanded ? "diag-log-pre-expanded" : ""}`}>{lines.join("\n")}</pre>
      )}
    </section>
  );
}
