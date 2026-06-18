import { HaLogo } from "../HaLogo";
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
  busy?: boolean;
  compact?: boolean;
  onRefresh?: () => void;
}) {
  const today = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());

  return (
    <header className={`dash-header ${compact ? "dash-header-compact" : ""}`}>
      <div className="dash-header-brand">
        <HaLogo size={80} />
        <div>
          <p className="dash-kicker">{kicker}</p>
          <h2 className="dash-title">{title}</h2>
          <p className="dash-subtitle">
            {subtitle ?? today}
            {refreshedAt && ` · ${formatRefreshLabel(refreshedAt)}`}
          </p>
        </div>
      </div>
      <div className="dash-header-actions">
        {prodUrl && (
          <a href={prodUrl} target="_blank" rel="noreferrer" className="btn secondary">
            Prod HA
          </a>
        )}
        {stagingUrl && (
          <a href={stagingUrl} target="_blank" rel="noreferrer" className="btn secondary">
            Staging HA
          </a>
        )}
        {onRefresh && (
          <button type="button" className="btn secondary dash-refresh" disabled={busy} onClick={onRefresh}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>
    </header>
  );
}
