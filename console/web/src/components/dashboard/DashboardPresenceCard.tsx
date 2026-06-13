import type { PresenceSummary } from "../../api";

export function DashboardPresenceCard({ presence }: { presence?: PresenceSummary | null }) {
  if (!presence) {
    return (
      <section className="dash-panel dash-presence">
        <p className="dash-panel-eyebrow">Presence parity</p>
        <h3>Unavailable</h3>
        <p className="muted">Configure prod and staging API tokens to compare person states.</p>
      </section>
    );
  }

  const pct =
    presence.prodPersonCount > 0
      ? Math.round((presence.matchedCount / presence.prodPersonCount) * 100)
      : 0;

  return (
    <section className="dash-panel dash-presence">
      <p className="dash-panel-eyebrow">Presence parity</p>
      <div className="dash-presence-score">
        <span className="dash-presence-value">{presence.matchedCount}</span>
        <span className="dash-presence-divider">/</span>
        <span className="dash-presence-total">{presence.prodPersonCount}</span>
      </div>
      <p className="dash-presence-label">persons match prod ({pct}%)</p>
      <p className="muted dash-presence-meta">{presence.detail}</p>
      <p className="muted dash-presence-meta">
        Staging has {presence.stagingPersonCount} person entit{presence.stagingPersonCount === 1 ? "y" : "ies"}
      </p>
    </section>
  );
}
