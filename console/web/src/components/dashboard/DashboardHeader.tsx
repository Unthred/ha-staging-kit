import { DashboardOpenLinks } from "./DashboardOpenLinks";
import { formatRefreshLabel } from "../../lib/formatTime";

export function DashboardHeader({
  kicker,
  title,
  subtitle,
  refreshedAt,
  stagingUrl,
  prodUrl,
  busy,
  compact,
  onRefresh,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
  refreshedAt?: string;
  stagingUrl?: string | null;
  prodUrl?: string | null;
  busy: boolean;
  compact?: boolean;
  onRefresh: () => void;
}) {
  const today = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());

  return (
    <header className={`dash-header ${compact ? "dash-header-compact" : ""}`}>
      <div>
        {!compact && <p className="dash-kicker">{kicker}</p>}
        <h2 className="dash-title">{compact ? "Staging overview" : title}</h2>
        <p className="dash-subtitle">
          {subtitle ?? today} · {formatRefreshLabel(refreshedAt)}
        </p>
        <DashboardOpenLinks stagingUrl={stagingUrl} prodUrl={prodUrl} />
      </div>
      <button type="button" className="dash-refresh btn secondary" disabled={busy} onClick={onRefresh}>
        {busy ? "Refreshing…" : "Refresh"}
      </button>
    </header>
  );
}
