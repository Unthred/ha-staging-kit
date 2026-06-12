import { useEffect, useState } from "react";
import { onboardingApi, settingsApi, type SettingsView } from "../api";
import { TestButton } from "../components/TestButton";

export default function SettingsPage() {
  const [form, setForm] = useState<SettingsView | null>(null);
  const [prodToken, setProdToken] = useState("");
  const [stagingToken, setStagingToken] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    settingsApi.get().then(setForm).catch((e) => setError(e.message));
  }, []);

  if (error && !form) {
    return (
      <div className="card error-card">
        <h2>Settings</h2>
        <p className="msg err">{error}</p>
      </div>
    );
  }

  if (!form) return <div className="card">Loading settings…</div>;

  const save = async () => {
    setMessage(null);
    setError(null);
    try {
      const updated = await settingsApi.save({
        ...form,
        prodUrl: form.prod.url,
        prodToken: prodToken || undefined,
        sshTarget: form.prod.sshTarget,
        sshPrivateKey: sshKey || undefined,
        stagingUrl: form.staging.url,
        stagingToken: stagingToken || undefined,
      });
      setForm(updated);
      setProdToken("");
      setStagingToken("");
      setSshKey("");
      setMessage("Settings saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Settings</h2>
          <p className="muted">Paths, tokens, and sidecar intervals. Secrets are write-only.</p>
        </div>
      </div>

      <div className="card main-card settings-form">
        <h3>Paths & git</h3>
        <label>
          HA config repo
          <input
            value={form.paths.haConfigRepo}
            onChange={(e) => setForm({ ...form, paths: { ...form.paths, haConfigRepo: e.target.value } })}
          />
        </label>
        <label>
          Git branch
          <input
            value={form.paths.haBranch}
            onChange={(e) => setForm({ ...form, paths: { ...form.paths, haBranch: e.target.value } })}
          />
        </label>
        <label>
          Staging HA config directory
          <input
            value={form.paths.haStagingConfig}
            onChange={(e) => setForm({ ...form, paths: { ...form.paths, haStagingConfig: e.target.value } })}
          />
        </label>
        <label>
          Sidecar data directory
          <input
            value={form.paths.sidecarData}
            onChange={(e) => setForm({ ...form, paths: { ...form.paths, sidecarData: e.target.value } })}
          />
        </label>
        <label>
          Mirror data directory
          <input
            value={form.paths.mirrorData}
            onChange={(e) => setForm({ ...form, paths: { ...form.paths, mirrorData: e.target.value } })}
          />
        </label>

        <h3>Prod connection</h3>
        <label>
          Prod HA URL
          <input
            value={form.prod.url}
            onChange={(e) => setForm({ ...form, prod: { ...form.prod, url: e.target.value } })}
          />
        </label>
        <label>
          Prod read token {form.prod.hasToken && <span className="configured">configured ✓</span>}
          <input type="password" value={prodToken} onChange={(e) => setProdToken(e.target.value)} placeholder="Leave blank to keep existing" />
        </label>
        <label>
          SSH target
          <input
            value={form.prod.sshTarget}
            onChange={(e) => setForm({ ...form, prod: { ...form.prod, sshTarget: e.target.value } })}
          />
        </label>
        <label>
          SSH private key {form.prod.hasSshKey && <span className="configured">configured ✓</span>}
          <textarea value={sshKey} onChange={(e) => setSshKey(e.target.value)} rows={4} placeholder="Leave blank to keep existing" />
        </label>
        <TestButton label="Test prod API" onTest={onboardingApi.testProd} />
        <TestButton label="Test SSH" onTest={onboardingApi.testSsh} />

        <h3>Staging connection</h3>
        <label>
          Staging HA URL
          <input
            value={form.staging.url}
            onChange={(e) => setForm({ ...form, staging: { ...form.staging, url: e.target.value } })}
          />
        </label>
        <label>
          Staging write token {form.staging.hasToken && <span className="configured">configured ✓</span>}
          <input type="password" value={stagingToken} onChange={(e) => setStagingToken(e.target.value)} placeholder="Leave blank to keep existing" />
        </label>
        <TestButton label="Test staging API" onTest={onboardingApi.testStaging} />

        <h3>MQTT mirror</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.mirror.enabled}
            onChange={(e) => setForm({ ...form, mirror: { ...form.mirror, enabled: e.target.checked } })}
          />
          Mirror enabled
        </label>
        {form.mirror.enabled && (
          <>
            <label>
              Prod Mosquitto host
              <input
                value={form.mirror.prodMqttHost}
                onChange={(e) => setForm({ ...form, mirror: { ...form.mirror, prodMqttHost: e.target.value } })}
              />
            </label>
            <label>
              Port
              <input
                type="number"
                value={form.mirror.prodMqttPort}
                onChange={(e) => setForm({ ...form, mirror: { ...form.mirror, prodMqttPort: Number(e.target.value) } })}
              />
            </label>
            <TestButton label="Test MQTT TCP" onTest={onboardingApi.testMqtt} />
          </>
        )}

        <h3>Sidecar intervals</h3>
        <label>
          Person poll interval (seconds)
          <input
            type="number"
            value={form.intervals.personPollIntervalSeconds}
            onChange={(e) =>
              setForm({
                ...form,
                intervals: { ...form.intervals, personPollIntervalSeconds: Number(e.target.value) },
              })
            }
          />
        </label>
        <label>
          Storage sync interval (seconds)
          <input
            type="number"
            value={form.intervals.storageSyncIntervalSeconds}
            onChange={(e) =>
              setForm({
                ...form,
                intervals: { ...form.intervals, storageSyncIntervalSeconds: Number(e.target.value) },
              })
            }
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.intervals.applyOnStart}
            onChange={(e) => setForm({ ...form, intervals: { ...form.intervals, applyOnStart: e.target.checked } })}
          />
          Apply config on sidecar start
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.intervals.skipStorageSync}
            onChange={(e) => setForm({ ...form, intervals: { ...form.intervals, skipStorageSync: e.target.checked } })}
          />
          Skip scheduled storage sync
        </label>

        <h3>Advanced</h3>
        <label>
          Staging HA container name (optional, for restart)
          <input
            value={form.stagingHaContainer ?? ""}
            onChange={(e) => setForm({ ...form, stagingHaContainer: e.target.value })}
            placeholder="Home-Assistant-Container"
          />
        </label>

        <div className="footer">
          <button type="button" className="btn primary" onClick={save}>
            Save settings
          </button>
        </div>
        {message && <p className="msg ok">{message}</p>}
        {error && <p className="msg err">{error}</p>}
      </div>
    </div>
  );
}
