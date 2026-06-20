import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { onboardingApi, settingsApi, toApiError, type ApiError, type SettingsView } from "../api";
import { SectionAttentionBadge } from "../components/PageAttentionPanel";
import { DashboardHeader } from "../components/dashboard/DashboardHeader";
import { LoadErrorPanel } from "../components/LoadErrorPanel";
import { MqttMirrorInstructions } from "../components/MqttMirrorInstructions";
import { PathsFormFields } from "../components/PathsFormFields";
import { PathsHelpPanel } from "../components/PathsHelpPanel";
import { StagingTargetSummary } from "../components/StagingTargetSummary";
import { TestButton } from "../components/TestButton";
import { AppearanceSettingsPanel } from "../components/settings/AppearanceSettingsPanel";
import { ReleaseSafetySettingsPanel } from "../components/settings/ReleaseSafetySettingsPanel";
import { useNavAttentionContext } from "../context/NavAttentionContext";
import { useAttentionNavigation } from "../hooks/useAttentionNavigation";
import { KIT_FQDN } from "../lib/kitHosts";

const SECTIONS = [
  { id: "appearance", title: "Appearance", summary: "Theme, badge colours, and other visual preferences." },
  { id: "release-safety", title: "Release safety", summary: "Lock prod SSH deploy/fix until release agent is ready." },
  { id: "paths", title: "Paths & git", summary: "Host folders bind-mounted into the kit container." },
  { id: "production", title: "Production connection", summary: "Production HA API and SSH for secrets/storage." },
  { id: "staging", title: "Staging connection", summary: "Staging HA API for REST updates." },
  { id: "mirror", title: "MQTT mirror", summary: "Optional live MQTT bridge from production." },
  { id: "intervals", title: "Sync intervals", summary: "Background poll and storage sync timing." },
  { id: "advanced", title: "Advanced", summary: "Container name and other options." },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function SettingsPage() {
  const [searchParams] = useSearchParams();
  const [sectionId, setSectionId] = useState<SectionId>("appearance");
  const [form, setForm] = useState<SettingsView | null>(null);
  const { itemsForPath } = useNavAttentionContext();
  const attentionItems = itemsForPath("/settings");
  const sectionAttention = (id: SectionId) =>
    attentionItems.filter((i) => i.settingsSection === id).length;
  const [prodToken, setProdToken] = useState("");
  const [stagingToken, setStagingToken] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    settingsApi.get().then(setForm).catch((e) => setError(toApiError(e)));
  }, []);

  useEffect(() => {
    const section = searchParams.get("section");
    if (section && SECTIONS.some((s) => s.id === section)) {
      setSectionId(section as SectionId);
    }
  }, [searchParams]);

  useAttentionNavigation(sectionId);

  const current = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0];

  if (error && !form) {
    return (
      <LoadErrorPanel
        title="Settings"
        error={error}
        onRetry={() => {
          setError(null);
          settingsApi.get().then(setForm).catch((e) => setError(toApiError(e)));
        }}
      />
    );
  }

  if (!form) return <div className="card">Loading settings…</div>;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const updated = await settingsApi.save({
        ...form,
        topology: form.topology,
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
      setError(toApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dash ops-page">
      <DashboardHeader
        kicker="Settings"
        title={current.title}
        subtitle={current.summary}
        stagingUrl={form.staging.url}
        prodUrl={form.prod.url}
      />

      <div className="layout">
        <nav className="sidebar" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`nav-item ${s.id === sectionId ? "active" : ""}`}
              onClick={() => setSectionId(s.id)}
            >
              <span className="settings-nav-label">{s.title}</span>
              <SectionAttentionBadge count={sectionAttention(s.id)} />
            </button>
          ))}
        </nav>

        <main className="card main-card settings-form" id={`settings-${sectionId}`}>
          <h2>{current.title}</h2>

          {sectionId === "appearance" && <AppearanceSettingsPanel />}
          {sectionId === "release-safety" && <ReleaseSafetySettingsPanel />}

          {sectionId === "paths" && (
            <>
              <PathsHelpPanel />
              <PathsFormFields
                form={form.paths}
                onChange={(paths) => setForm({ ...form, paths })}
              />
            </>
          )}

          {sectionId === "production" && (
            <>
              <p className="muted">
                Production read token and SSH access. Used for person sync, secrets, and storage sync — not just presence.
              </p>
              <label>
                Production HA URL
                <input
                  value={form.prod.url}
                  onChange={(e) => setForm({ ...form, prod: { ...form.prod, url: e.target.value } })}
                  placeholder={KIT_FQDN.prodHa}
                />
              </label>
              <label>
                Production read token {form.prod.hasToken && <span className="configured">configured ✓</span>}
                <input
                  type="password"
                  value={prodToken}
                  onChange={(e) => setProdToken(e.target.value)}
                  placeholder="Leave blank to keep existing"
                />
              </label>
              <label>
                SSH target
                <input
                  value={form.prod.sshTarget}
                  onChange={(e) => setForm({ ...form, prod: { ...form.prod, sshTarget: e.target.value } })}
                  placeholder="user@host:/path/to/homeassistant"
                />
              </label>
              <label>
                SSH private key {form.prod.hasSshKey && <span className="configured">configured ✓</span>}
                <textarea
                  value={sshKey}
                  onChange={(e) => setSshKey(e.target.value)}
                  rows={4}
                  placeholder="Leave blank to keep existing"
                />
              </label>
              <TestButton
                label="Test production API"
                onTest={() => onboardingApi.testProd({ url: form.prod.url, token: prodToken || undefined })}
              />
              <TestButton
                label="Test SSH"
                onTest={() =>
                  onboardingApi.testSsh({ sshTarget: form.prod.sshTarget, sshPrivateKey: sshKey || undefined })
                }
              />
            </>
          )}

          {sectionId === "staging" && (
            <>
              {form.stagingTarget && (
                <div className="staging-target-card card-inset">
                  <h3 className="staging-target-card-title">Detected staging instance</h3>
                  <StagingTargetSummary target={form.stagingTarget} />
                </div>
              )}
              <p className="muted">
                Staging write token for REST state updates. Must match the URL staging Home Assistant is reachable at from
                this kit container.
              </p>
              <label>
                Staging HA URL
                <input
                  value={form.staging.url}
                  onChange={(e) => setForm({ ...form, staging: { ...form.staging, url: e.target.value } })}
                  placeholder={KIT_FQDN.stagingHa}
                />
              </label>
              <label>
                Staging write token {form.staging.hasToken && <span className="configured">configured ✓</span>}
                <input
                  type="password"
                  value={stagingToken}
                  onChange={(e) => setStagingToken(e.target.value)}
                  placeholder="Leave blank to keep existing"
                />
              </label>
              <TestButton
                label="Test staging API"
                onTest={() => onboardingApi.testStaging({ url: form.staging.url, token: stagingToken || undefined })}
              />
            </>
          )}

          {sectionId === "mirror" && (
            <>
              <p className="muted">Enable if this kit should run the MQTT mirror broker.</p>
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
                  <p className="muted">
                    Mosquitto runs inside the kit container. Endpoints are derived from prod/staging HA URLs and written
                    to <code>.env</code> / sidecar config automatically.
                  </p>
                  {(form.mirror.prodMqttHost || form.mirror.stagingMqttBrokerHost) && (
                    <ul className="checklist">
                      {form.mirror.prodMqttHost && (
                        <li>
                          Prod bridge: <code>{form.mirror.prodMqttHost}:{form.mirror.prodMqttPort}</code>
                        </li>
                      )}
                      {form.mirror.stagingMqttBrokerHost && (
                        <li>
                          Staging HA → mirror:{" "}
                          <code>
                            {form.mirror.stagingMqttBrokerHost}:{form.mirror.stagingMqttPort ?? 1883}
                          </code>
                        </li>
                      )}
                    </ul>
                  )}
                  <div className="card-inset" style={{ marginTop: "1rem" }}>
                    <h3 className="staging-target-card-title">In staging Home Assistant (you, once)</h3>
                    <p className="muted">
                      The kit cannot change staging HA&apos;s MQTT integration for you. Point it at the mirror broker
                      below, then deploy the mirror from Operations.
                    </p>
                    <MqttMirrorInstructions
                      stagingHaType={form.topology.stagingHaType}
                      brokerHost={form.mirror.stagingMqttBrokerHost ?? undefined}
                      brokerPort={form.mirror.stagingMqttPort ?? 1883}
                    />
                  </div>
                  {form.mirror.prodMqttHost && (
                    <TestButton
                      label="Test prod MQTT TCP"
                      onTest={() =>
                        onboardingApi.testMqtt({
                          prodMqttHost: form.mirror.prodMqttHost,
                          prodMqttPort: form.mirror.prodMqttPort,
                        })
                      }
                    />
                  )}
                </>
              )}
            </>
          )}

          {sectionId === "intervals" && (
            <>
              <p className="muted">How often the background sync loop polls production and runs storage sync.</p>
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
                  onChange={(e) =>
                    setForm({ ...form, intervals: { ...form.intervals, applyOnStart: e.target.checked } })
                  }
                />
                Apply config on every kit restart (not recommended — use Operations → Apply config instead)
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.intervals.skipStorageSync}
                  onChange={(e) =>
                    setForm({ ...form, intervals: { ...form.intervals, skipStorageSync: e.target.checked } })
                  }
                />
                Skip scheduled storage sync
              </label>
            </>
          )}

          {sectionId === "advanced" && (
            <>
              <p className="muted">Optional Docker container name for restarting staging Home Assistant from Operations.</p>
              <label>
                Staging HA container name
                <input
                  value={form.stagingHaContainer ?? ""}
                  onChange={(e) => setForm({ ...form, stagingHaContainer: e.target.value })}
                  placeholder="e.g. Home-Assistant-Container"
                />
              </label>
            </>
          )}

          {sectionId !== "appearance" && (
            <div className="step-actions-right">
              <button type="button" className="btn primary" disabled={saving} onClick={save}>
                {saving ? "Saving…" : "Save settings"}
              </button>
            </div>
          )}
          {message && <p className="msg ok">{message}</p>}
          {error && <p className="msg err">{error.detail}</p>}
        </main>
      </div>
    </div>
  );
}
