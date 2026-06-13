import { useCallback, useEffect, useState } from "react";
import { ApiError, systemApi, type ContainerStatus } from "../api";

export function LoadErrorPanel({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: ApiError | string;
  onRetry?: () => void;
}) {
  const apiErr = error instanceof ApiError ? error : new ApiError(String(error), String(error));
  const [containers, setContainers] = useState<ContainerStatus[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const refreshContainers = useCallback(async () => {
    try {
      setContainers(await systemApi.containers());
    } catch {
      setContainers(null);
    }
  }, []);

  useEffect(() => {
    refreshContainers();
  }, [refreshContainers]);

  const restart = async (role: "kit" | "web" | "sync" | "mirror") => {
    setBusy(role);
    setActionMsg(null);
    try {
      const result = await systemApi.restartContainer(role);
      setActionMsg(result.message);
      if (role === "web" || role === "kit") {
        setActionMsg(`${result.message} Reloading in a few seconds…`);
        window.setTimeout(() => window.location.reload(), 4000);
      } else {
        await refreshContainers();
        onRetry?.();
      }
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Restart failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="shell">
      <div className="card error-card load-error-panel">
        <p className="eyebrow">ha-staging-kit</p>
        <h1>{title}</h1>
        <p className="msg err">{apiErr.title}</p>
        <p>{apiErr.detail}</p>
        {apiErr.hint && <p className="muted">{apiErr.hint}</p>}
        {apiErr.status !== undefined && (
          <p className="muted">
            HTTP {apiErr.status}
            {apiErr.status === 503 && " — usually means HAProxy or the console container could not reach the API backend."}
          </p>
        )}

        {containers && containers.length > 0 && (
          <>
            <h3>Kit containers</h3>
            <ul className="container-status-list">
              {containers.map((c) => (
                <li key={c.id}>
                  <strong>{c.label}</strong>{" "}
                  <span className={c.running ? "configured" : "msg err"}>{c.running ? "running" : "not running"}</span>
                  {c.resolvedName && <span className="muted"> — {c.resolvedName}</span>}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="error-actions">
          {onRetry && (
            <button type="button" className="btn secondary" onClick={onRetry}>
              Retry
            </button>
          )}
          <button type="button" className="btn secondary" disabled={busy !== null} onClick={() => restart("sync")}>
            {busy === "sync" ? "Restarting…" : "Restart config sync"}
          </button>
          <button type="button" className="btn secondary" disabled={busy !== null} onClick={() => restart("kit")}>
            {busy === "kit" || busy === "web" ? "Restarting…" : "Restart kit"}
          </button>
        </div>

        {actionMsg && <p className="muted">{actionMsg}</p>}

        <p className="muted">
          Direct bypass (no HAProxy): <code>http://&lt;unraid-ip&gt;:8081/</code>
        </p>
      </div>
    </div>
  );
}
