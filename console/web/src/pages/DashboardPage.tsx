import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dashboardApi, type DashboardStatus } from "../api";
import { Chip } from "../components/Chip";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setData(await dashboardApi.status());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 30000);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (error && !data) {
    return (
      <div className="card error-card">
        <h2>Dashboard</h2>
        <p className="msg err">{error}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Dashboard</h2>
          <p className="muted">Live status for sidecar, staging HA, and MQTT mirror.</p>
        </div>
        <button type="button" className="btn secondary" disabled={busy} onClick={refresh}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {!data?.onboardingComplete && (
        <div className="banner banner-warn">
          Onboarding not marked complete.{" "}
          <Link to="/onboarding">Resume setup wizard</Link>
        </div>
      )}

      {data?.mirror?.mode === "control" && (
        <div className="banner banner-danger">
          MQTT mirror is in <strong>control mode</strong> — staging can actuate prod devices.
          Switch back from <Link to="/operations">Operations</Link>.
        </div>
      )}

      <div className="card-grid">
        {data?.subsystems.map((s) => (
          <div key={s.name} className="stat-card">
            <div className="stat-card-head">
              <h3>{s.name}</h3>
              <Chip status={s.status} />
            </div>
            <p className="muted">{s.detail}</p>
          </div>
        ))}
      </div>

      {data?.sidecar && (
        <section className="card section-card">
          <h3>Sidecar activity</h3>
          <dl className="detail-list">
            <div>
              <dt>Person sync</dt>
              <dd>{data.sidecar.lastPersonSync ?? "No recent log line"}</dd>
            </div>
            <div>
              <dt>Config apply</dt>
              <dd>{data.sidecar.lastApply ?? "No recent log line"}</dd>
            </div>
            <div>
              <dt>Storage sync</dt>
              <dd>{data.sidecar.lastStorageSync ?? "No recent log line"}</dd>
            </div>
            <div>
              <dt>Poll interval</dt>
              <dd>{data.sidecar.personPollIntervalSeconds}s</dd>
            </div>
            <div>
              <dt>Storage interval</dt>
              <dd>{data.sidecar.storageSyncIntervalSeconds}s</dd>
            </div>
          </dl>
        </section>
      )}

      {data?.mirror?.configured && (
        <section className="card section-card">
          <h3>MQTT mirror</h3>
          <dl className="detail-list">
            <div>
              <dt>Mode</dt>
              <dd>{data.mirror.mode}</dd>
            </div>
            <div>
              <dt>Prod broker</dt>
              <dd>
                {data.mirror.prodMqttHost}:{data.mirror.prodMqttPort}
              </dd>
            </div>
            <div>
              <dt>Container</dt>
              <dd>{data.mirror.running ? "Running" : "Stopped"}</dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
