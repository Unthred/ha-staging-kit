import type { ReactNode } from "react";

export function OpsTaskPanel({
  title,
  description,
  children,
  actions,
  aside,
  variant = "default",
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** Right-side control (e.g. mirror mode toggle) */
  aside?: ReactNode;
  variant?: "default" | "warn" | "danger";
}) {
  return (
    <section className={`ops-task-panel ops-task-panel--${variant}`}>
      <header className={`ops-task-panel-head${aside ? " ops-task-panel-head--split" : ""}`}>
        <div className="ops-task-panel-copy">
          <h3>{title}</h3>
          {description ? <div className="ops-task-panel-desc">{description}</div> : null}
        </div>
        {aside ? <div className="ops-task-panel-aside">{aside}</div> : null}
      </header>
      {children ? <div className="ops-task-panel-body">{children}</div> : null}
      {actions ? <footer className="ops-task-panel-actions">{actions}</footer> : null}
    </section>
  );
}

export function OpsCallout({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return <div className={`ops-callout ops-callout--${tone}`}>{children}</div>;
}

export function OpsDetailsPanel({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="ops-details-panel" open={defaultOpen || undefined}>
      <summary>{summary}</summary>
      <div className="ops-details-panel-body">{children}</div>
    </details>
  );
}

export function OpsNote({ children }: { children: ReactNode }) {
  return <div className="ops-note">{children}</div>;
}

export function OpsChecklist({ items }: { items: ReactNode[] }) {
  return (
    <ul className="ops-checklist">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
