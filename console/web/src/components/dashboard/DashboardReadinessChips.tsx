import type { ReadinessItem } from "../../api";

export function DashboardReadinessChips({ items }: { items: ReadinessItem[] }) {
  return (
    <section className="dash-readiness" aria-label="Configuration readiness">
      {items.map((item) => (
        <span key={item.id} className={`dash-readiness-chip ${item.ok ? "ok" : "pending"}`} title={item.detail ?? undefined}>
          <span className="dash-readiness-dot" aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </section>
  );
}
