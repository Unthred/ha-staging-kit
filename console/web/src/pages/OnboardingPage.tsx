import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onboardingApi, type OnboardingStatus } from "../api";
import { ActionButton } from "../components/ActionButton";
import { Chip } from "../components/Chip";
import { TestButton } from "../components/TestButton";

const STEPS = [
  { id: "welcome", title: "Welcome" },
  { id: "topology", title: "Topology" },
  { id: "paths", title: "Paths & git" },
  { id: "prod", title: "Prod connection" },
  { id: "staging", title: "Staging connection" },
  { id: "mirror", title: "MQTT mirror" },
  { id: "deploy", title: "Deploy sidecar" },
  { id: "storage", title: "Storage sync" },
  { id: "mirror-deploy", title: "Deploy mirror" },
  { id: "ha-mqtt", title: "Staging HA MQTT" },
  { id: "health", title: "Health checks" },
  { id: "done", title: "Done" },
] as const;

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState(status?.lastHealthChecks ?? []);

  const refresh = useCallback(async () => {
    const s = await onboardingApi.status();
    setStatus(s);
    if (s.lastHealthChecks) setHealth(s.lastHealthChecks);
    if (!s.isComplete && s.currentStep > 0) setStep(Math.min(s.currentStep, STEPS.length - 1));
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);

  const mirrorEnabled = status?.mirror.enabled ?? false;

  const visibleSteps = useMemo(
    () =>
      STEPS.filter((s) => {
        if (s.id === "mirror-deploy" && !mirrorEnabled) return false;
        if (s.id === "ha-mqtt" && !mirrorEnabled) return false;
        return true;
      }),
    [mirrorEnabled]
  );

  const current = visibleSteps[Math.min(step, visibleSteps.length - 1)] ?? visibleSteps[0];
  const progress = ((step + 1) / visibleSteps.length) * 100;

  const next = () => setStep((s) => Math.min(s + 1, visibleSteps.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  if (error && !status) {
    return (
      <div className="shell">
        <div className="card error-card">
          <h1>HA Staging Console</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">ha-staging-kit</p>
          <h1>Setup wizard</h1>
        </div>
        <div className="progress-wrap">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="progress-label">
            Step {step + 1} of {visibleSteps.length} — {current.title}
          </span>
        </div>
      </header>

      <div className="layout">
        <nav className="sidebar">
          {visibleSteps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`nav-item ${i === step ? "active" : ""} ${status?.completedSteps.includes(s.id) ? "done" : ""}`}
              onClick={() => setStep(i)}
            >
              {s.title}
            </button>
          ))}
        </nav>

        <main className="card main-card">
          {current.id === "welcome" && (
            <>
              <h2>Welcome</h2>
              <p>
                This wizard configures the <strong>staging sidecar</strong> (git apply, person sync,
                storage sync) and optionally the <strong>MQTT mirror</strong> for live device states on staging.
              </p>
              <ul className="checklist">
                <li>Docker and Docker Compose on this host</li>
                <li>Git clone of your HA config repo (staging branch)</li>
                <li>Prod and staging Home Assistant reachable on your LAN</li>
                <li>Long-lived API tokens (prod read, staging write)</li>
              </ul>
              <p className="muted">
                Person/presence sync keeps staging location realistic — phones only report to prod.{" "}
                <a href="https://github.com/Unthred/ha-staging-kit/blob/main/docs/person-presence-sync.md" target="_blank" rel="noreferrer">
                  Learn more
                </a>
              </p>
              {status?.paths.haConfigRepo && status.prod.hasToken && status.staging.hasToken && (
                <div className="bootstrap-banner">
                  <p>Existing configuration detected from <code>.env</code> and secrets.</p>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={async () => {
                      await onboardingApi.skipToDashboard();
                      navigate("/");
                    }}
                  >
                    Skip to dashboard
                  </button>
                </div>
              )}
            </>
          )}

          {current.id === "topology" && status && (
            <TopologyStep status={status} onSaved={async (t) => { setStatus(await onboardingApi.topology(t)); next(); }} />
          )}

          {current.id === "paths" && status && (
            <PathsStep status={status} onSaved={async (p) => { setStatus(await onboardingApi.paths(p)); next(); }} />
          )}

          {current.id === "prod" && status && (
            <ProdStep
              status={status}
              onSaved={async (p) => { setStatus(await onboardingApi.prod(p)); next(); }}
            />
          )}

          {current.id === "staging" && status && (
            <StagingStep
              status={status}
              onSaved={async (p) => { setStatus(await onboardingApi.staging(p)); next(); }}
            />
          )}

          {current.id === "mirror" && status && (
            <MirrorStep
              status={status}
              onSaved={async (m) => { setStatus(await onboardingApi.mirror(m)); next(); }}
            />
          )}

          {current.id === "deploy" && (
            <>
              <h2>Deploy sidecar</h2>
              <p>Build and start the sidecar container using your <code>.env</code> and secrets.</p>
              <ActionButton
                label="Deploy sidecar"
                onRun={onboardingApi.deploy}
                onDone={() => { refresh(); next(); }}
              />
            </>
          )}

          {current.id === "storage" && (
            <>
              <h2>Storage sync</h2>
              <p>
                Copies a subset of prod <code>.storage</code> (registry, MQTT creds for mirror) and person images to staging via SSH.
              </p>
              <ActionButton
                label="Run storage sync"
                onRun={onboardingApi.storageSync}
                onDone={() => { refresh(); next(); }}
              />
            </>
          )}

          {current.id === "mirror-deploy" && (
            <>
              <h2>Deploy MQTT mirror</h2>
              <p>Starts the one-way Mosquitto bridge (read-only by default).</p>
              <ActionButton
                label="Deploy mirror"
                onRun={onboardingApi.deployMirror}
                onDone={() => { refresh(); next(); }}
              />
            </>
          )}

          {current.id === "ha-mqtt" && (
            <>
              <h2>Point staging HA at the mirror</h2>
              <p>
                In staging Home Assistant, set the MQTT integration broker to this host on port{" "}
                <code>1883</code> (or your <code>MIRROR_PORT</code>).
              </p>
              <pre className="snippet">
{`# Docker staging — broker URL example
mqtt://<this-host-ip>:1883`}
              </pre>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={status?.haMqttConfirmed ?? false}
                  onChange={async (e) => {
                    if (e.target.checked) {
                      setStatus(await onboardingApi.confirmHaMqtt());
                      next();
                    }
                  }}
                />
                I&apos;ve pointed staging HA at the mirror broker
              </label>
            </>
          )}

          {current.id === "health" && (
            <>
              <h2>Health checks</h2>
              <p>Verify sidecar, API tokens, and person sync.</p>
              <button
                type="button"
                className="btn primary"
                onClick={async () => {
                  setHealth(await onboardingApi.health());
                  await refresh();
                }}
              >
                Run checks
              </button>
              <ul className="health-list">
                {health.map((h) => (
                  <li key={h.name}>
                    <strong>{h.name}</strong> <Chip status={h.status} />
                    <span className="muted">{h.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {current.id === "done" && (
            <>
              <h2>All set</h2>
              <p>Staging sidecar is configured. Open the dashboard for day-two operations.</p>
              <button
                type="button"
                className="btn primary"
                onClick={async () => {
                  await onboardingApi.complete();
                  navigate("/");
                }}
              >
                Go to dashboard
              </button>
            </>
          )}

          <footer className="footer">
            {step > 0 && (
              <button type="button" className="btn secondary" onClick={back}>
                Back
              </button>
            )}
            {current.id !== "done" && current.id !== "deploy" && current.id !== "storage" && current.id !== "mirror-deploy" && (
              <button type="button" className="btn ghost" onClick={next}>
                Skip for now
              </button>
            )}
          </footer>
        </main>
      </div>
    </div>
  );
}

function TopologyStep({
  status,
  onSaved,
}: {
  status: OnboardingStatus;
  onSaved: (t: OnboardingStatus["topology"]) => Promise<void>;
}) {
  const [form, setForm] = useState(status.topology);
  return (
    <>
      <h2>Topology</h2>
      <p>Where do prod and staging Home Assistant run?</p>
      <label>
        Prod HA
        <select value={form.prodHaType} onChange={(e) => setForm({ ...form, prodHaType: e.target.value })}>
          <option value="ha_os">HA OS / appliance</option>
          <option value="docker">Docker</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>
        Staging HA
        <select value={form.stagingHaType} onChange={(e) => setForm({ ...form, stagingHaType: e.target.value })}>
          <option value="docker">Docker</option>
          <option value="ha_os">HA OS / appliance</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={form.sameHostAsKit}
          onChange={(e) => setForm({ ...form, sameHostAsKit: e.target.checked })}
        />
        Kit runs on the same host as staging HA
      </label>
      <button type="button" className="btn primary" onClick={() => onSaved(form)}>
        Save & continue
      </button>
    </>
  );
}

function PathsStep({
  status,
  onSaved,
}: {
  status: OnboardingStatus;
  onSaved: (p: OnboardingStatus["paths"]) => Promise<void>;
}) {
  const [form, setForm] = useState(status.paths);
  return (
    <>
      <h2>Paths & git</h2>
      <label>
        HA config repo path (host)
        <input value={form.haConfigRepo} onChange={(e) => setForm({ ...form, haConfigRepo: e.target.value })} placeholder="/path/to/HomeAssistant" />
      </label>
      <label>
        Git branch
        <input value={form.haBranch} onChange={(e) => setForm({ ...form, haBranch: e.target.value })} />
      </label>
      <label>
        Staging HA config directory (host)
        <input value={form.haStagingConfig} onChange={(e) => setForm({ ...form, haStagingConfig: e.target.value })} />
      </label>
      <label>
        Sidecar data directory
        <input value={form.sidecarData} onChange={(e) => setForm({ ...form, sidecarData: e.target.value })} />
      </label>
      <label>
        Mirror data directory
        <input value={form.mirrorData} onChange={(e) => setForm({ ...form, mirrorData: e.target.value })} />
      </label>
      <button type="button" className="btn primary" onClick={() => onSaved(form)}>
        Save & continue
      </button>
    </>
  );
}

function ProdStep({
  status,
  onSaved,
}: {
  status: OnboardingStatus;
  onSaved: (p: { url: string; token?: string; sshTarget: string; sshPrivateKey?: string }) => Promise<void>;
}) {
  const [url, setUrl] = useState(status.prod.url);
  const [token, setToken] = useState("");
  const [sshTarget, setSshTarget] = useState(status.prod.sshTarget);
  const [sshKey, setSshKey] = useState("");

  return (
    <>
      <h2>Prod connection</h2>
      <p className="muted">
        Prod <strong>read</strong> token powers person/presence sync. SSH target is used for secrets and storage sync.
      </p>
      <label>
        Prod HA URL
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.10:8123" />
      </label>
      <label>
        Prod read token {status.prod.hasToken && <span className="configured">configured ✓</span>}
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={status.prod.hasToken ? "Leave blank to keep existing" : "Paste token"} />
      </label>
      <label>
        SSH target (user@host:/homeassistant)
        <input value={sshTarget} onChange={(e) => setSshTarget(e.target.value)} placeholder="user@prod:/homeassistant" />
      </label>
      <label>
        SSH private key {status.prod.hasSshKey && <span className="configured">configured ✓</span>}
        <textarea value={sshKey} onChange={(e) => setSshKey(e.target.value)} rows={4} placeholder="Paste key or leave blank to keep existing" />
      </label>
      <TestButton label="Test prod API" onTest={onboardingApi.testProd} />
      <TestButton label="Test SSH" onTest={onboardingApi.testSsh} />
      <button
        type="button"
        className="btn primary"
        onClick={() => onSaved({ url, token: token || undefined, sshTarget, sshPrivateKey: sshKey || undefined })}
      >
        Save & continue
      </button>
    </>
  );
}

function StagingStep({
  status,
  onSaved,
}: {
  status: OnboardingStatus;
  onSaved: (p: { url: string; token?: string }) => Promise<void>;
}) {
  const [url, setUrl] = useState(status.staging.url);
  const [token, setToken] = useState("");

  return (
    <>
      <h2>Staging connection</h2>
      <p className="muted">Staging <strong>write</strong> token lets the sidecar update person/tracker states.</p>
      <label>
        Staging HA URL
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8123" />
      </label>
      <label>
        Staging write token {status.staging.hasToken && <span className="configured">configured ✓</span>}
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={status.staging.hasToken ? "Leave blank to keep existing" : "Paste token"} />
      </label>
      <TestButton label="Test staging API" onTest={onboardingApi.testStaging} />
      <button type="button" className="btn primary" onClick={() => onSaved({ url, token: token || undefined })}>
        Save & continue
      </button>
    </>
  );
}

function MirrorStep({
  status,
  onSaved,
}: {
  status: OnboardingStatus;
  onSaved: (m: OnboardingStatus["mirror"]) => Promise<void>;
}) {
  const [form, setForm] = useState(status.mirror);

  return (
    <>
      <h2>MQTT mirror (optional)</h2>
      <p>
        Do you want <strong>live device states</strong> from prod on staging (Zigbee2MQTT, etc.)?
        If not, staging uses its own MQTT or none.
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
        />
        Yes, enable MQTT mirror
      </label>
      {form.enabled && (
        <>
          <label>
            Prod Mosquitto host
            <input value={form.prodMqttHost} onChange={(e) => setForm({ ...form, prodMqttHost: e.target.value })} />
          </label>
          <label>
            Port
            <input type="number" value={form.prodMqttPort} onChange={(e) => setForm({ ...form, prodMqttPort: Number(e.target.value) })} />
          </label>
          <TestButton label="Test MQTT TCP" onTest={onboardingApi.testMqtt} />
          <p className="muted warn">Mirror defaults to read-only. Control mode is not offered during onboarding.</p>
        </>
      )}
      <button type="button" className="btn primary" onClick={() => onSaved(form)}>
        Save & continue
      </button>
    </>
  );
}
