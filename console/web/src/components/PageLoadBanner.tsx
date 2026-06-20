import type { ApiError } from "../api";

export function PageLoadBanner({
  error,
  onRetry,
}: {
  error: ApiError;
  onRetry?: () => void;
}) {
  return (
    <div className="dash-banner dash-banner-warn page-load-banner" role="alert">
      <span>{error.detail || error.message}</span>
      {onRetry ? (
        <button type="button" className="btn ghost btn-compact" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
