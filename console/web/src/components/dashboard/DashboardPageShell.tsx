import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { DashboardStatus } from "../../api";
import { DashboardHeader } from "./DashboardHeader";

export function DashboardPageShell({
  kicker,
  title,
  subtitle,
  data,
  busy,
  onRefresh,
  compact,
  children,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
  data?: DashboardStatus | null;
  busy?: boolean;
  onRefresh?: () => void;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={compact ? "dash dash-live-compact" : "dash"}>
      <DashboardHeader
        kicker={kicker}
        title={title}
        subtitle={subtitle}
        refreshedAt={data?.refreshedAt}
        stagingUrl={data?.stagingHaUrl}
        prodUrl={data?.prodHaUrl}
        busy={busy}
        compact={compact}
        onRefresh={onRefresh}
      />

      {data != null && !data.onboardingComplete && (
        <div className="dash-banner dash-banner-warn">
          Setup incomplete — <Link to="/onboarding">resume the wizard</Link>
        </div>
      )}

      {children}
    </div>
  );
}
