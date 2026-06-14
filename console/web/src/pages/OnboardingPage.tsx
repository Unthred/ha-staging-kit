import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { onboardingApi, toApiError, type ApiError, type HealthCheck, type OnboardingStatus } from "../api";
import { ActionButton } from "../components/ActionButton";
import { Chip } from "../components/Chip";
import { LoadErrorPanel } from "../components/LoadErrorPanel";
import { MqttMirrorInstructions } from "../components/MqttMirrorInstructions";
import { PathsFormFields } from "../components/PathsFormFields";
import { PathsHelpPanel } from "../components/PathsHelpPanel";
import { TestButton } from "../components/TestButton";

const STEPS = [
  { id: "welcome", title: "Welcome" },
  { id: "topology", title: "Topology" },
  { id: "paths", title: "Paths & git" },
  { id: "prod", title: "Production connection" },
  { id: "staging", title: "Staging connection" },
  { id: "storage", title: "Storage sync" },
  { id: "prod-git-init", title: "Prod HA git" },
  { id: "mirror", title: "MQTT mirror" },
  { id: "health", title: "Health checks" },
  { id: "done", title: "Done" },
] as const;

function resolveVisibleStepIndex(
  status: OnboardingStatus,
  visibleSteps: ReadonlyArray<(typeof STEPS)[number]>
): number {
  const fullIdx = Math.min(Math.max(status.currentStep, 0), STEPS.length - 1);
  const stepId = STEPS[fullIdx]?.id;
  if (stepId) {
    const visIdx = visibleSteps.findIndex((s) => s.id === stepId);
    if (visIdx >= 0) return visIdx;
  }
  for (let i = 0; i < visibleSteps.length; i++) {
    if (!status.completedSteps.includes(visibleSteps[i].id)) return i;
  }
  return Math.max(visibleSteps.length - 1, 0);
}

function StepFooter({
  showBack,
  onBack,
  onNext,
  nextLabel = "Next",
  showSkip = true,
  primaryDisabled = false,
  extraEnd,
}: {
  showBack: boolean;
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  showSkip?: boolean;
  primaryDisabled?: boolean;
  extraEnd?: ReactNode;
}) {
  return (
    <footer className="step-footer">
      <div className="step-footer-start">
        {showBack && (
          <button type="button" className="btn secondary" onClick={onBack}>
            Back
          </button>
        )}
      </div>
      <div className="step-footer-end">
        {extraEnd}
        {showSkip ? (
          <button type="button" className="btn secondary" onClick={onNext}>
            Skip for now
          </button>
        ) : (
          <button type="button" className="btn primary" disabled={primaryDisabled} onClick={onNext}>
            {nextLabel}
          </button>
        )}
      </div>
    </footer>
  );
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [health, setHealth] = useState<HealthCheck[]>([]);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthProgress, setHealthProgress] = useState<{ completed: number; total: number; current: string } | null>(
    null
  );

  const refresh = useCallback(async (syncStep = false) => {
    const s = await onboardingApi.status();
    setStatus(s);
    if (s.lastHealthChecks) setHealth(s.lastHealthChecks);
    if (syncStep && !s.isComplete) {
      setStep(resolveVisibleStepIndex(s, STEPS));
    }
  }, []);

  useEffect(() => {
    refresh(true).catch((e) => setError(toApiError(e)));
  }, [refresh]);

  const visibleSteps = useMemo(() => STEPS, []);

  const current = visibleSteps[Math.min(step, visibleSteps.length - 1)] ?? visibleSteps[0];
  const progress = ((step + 1) / visibleSteps.length) * 100;

  const next = () => setStep((s) => Math.min(s + 1, visibleSteps.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const runHealth = async () => {
    setHealthBusy(true);
    setHealth([]);
    setHealthProgress(null);
    try {
      const plan = await onboardingApi.healthPlan();
      const results: HealthCheck[] = [];
      for (let i = 0; i < plan.length; i++) {
        const item = plan[i];
        setHealthProgress({ completed: i, total: plan.length, current: item.name });
        results.push(await onboardingApi.healthRun(item.id));
        setHealth([...results]);
        setHealthProgress({ completed: i + 1, total: plan.length, current: item.name });
      }
      setHealthProgress({ completed: plan.length, total: plan.length, current: "Complete" });
      await onboardingApi.healthSave(results);
      await refresh(false);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setHealthBusy(false);
      window.setTimeout(() => setHealthProgress(null), 600);
    }
  };

  if (error && !status) {
    return (
      <LoadErrorPanel
        title="Setup wizard"
        error={error}
        onRetry={() => {
          setError(null);
          refresh(true).catch((e) => setError(toApiError(e)));
        }}
      />
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
                This wizard configures the staging kit: a <strong>workbench</strong> HA instance that loads YAML from
                your config git repo for testing. Production HA remains live truth for the running home until you
                deploy approved git changes to prod separately.
              </p>
              <p>
                The kit syncs config from git, keeps person/presence realistic from prod,
                and optionally mirrors live MQTT device states from production.
              </p>
              <ul className="checklist">
                <li>Docker and Docker Compose on the kit host</li>
                <li>Git clone of your Home Assistant config repo (staging branch)</li>
                <li>Production and staging Home Assistant reachable on your network</li>
                <li>Long-lived API tokens (production read, staging write)</li>
                <li>
                  Person/presence sync — phones report to production only; the kit copies those states to staging{" "}
                  <a href="https://github.com/Unthred/ha-staging-kit/blob/main/docs/person-presence-sync.md" target="_blank" rel="noreferrer">
                    (learn more)
                  </a>
                </li>
              </ul>
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
              <div className="step-actions-right">
                <button type="button" className="btn primary" onClick={next}>
                  Get started
                </button>
              </div>
            </>
          )}

          {current.id === "topology" && status && (
            <TopologyStep
              status={status}
              showBack={step > 0}
              onBack={back}
              onSaved={async (t) => {
                setStatus(await onboardingApi.topology(t));
                next();
              }}
            />
          )}

          {current.id === "paths" && status && (
            <PathsStep
              status={status}
              onSaved={async (p) => {
                setStatus(await onboardingApi.paths(p));
                next();
              }}
            />
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

          {current.id === "storage" && status && (
            <StorageStep status={status} onDone={() => refresh(false)} onNext={next} showBack={step > 0} onBack={back} />
          )}

          {current.id === "prod-git-init" && status && (
            <ProdGitInitStep status={status} onDone={() => refresh(false)} onNext={next} showBack={step > 0} onBack={back} />
          )}

          {current.id === "mirror" && status && (
            <MirrorStep
              status={status}
              showBack={step > 0}
              onBack={back}
              onRefresh={() => refresh(false)}
              onContinue={async (enabled, haConfirmed) => {
                setStatus(await onboardingApi.mirror({ ...status.mirror, enabled }));
                if (enabled && haConfirmed) setStatus(await onboardingApi.confirmHaMqtt());
                next();
              }}
            />
          )}

          {current.id === "health" && (
            <>
              <h2>Health checks</h2>
              <p>Verify config sync, API tokens, and person sync. Results stay on this step until you continue.</p>
              {healthProgress && (
                <div className="health-progress">
                  <div className="progress-bar">
                    <div
                      className={`progress-fill ${healthBusy ? "progress-fill-active" : ""}`}
                      style={{
                        width: `${Math.max(
                          4,
                          (healthProgress.completed / Math.max(healthProgress.total, 1)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                  <span className="progress-label">
                    {healthBusy
                      ? healthProgress.completed < healthProgress.total
                        ? `Checking ${healthProgress.current} (${healthProgress.completed + 1} of ${healthProgress.total})`
                        : "Finishing…"
                      : `${healthProgress.completed} of ${healthProgress.total} checks complete`}
                  </span>
                </div>
              )}
              {health.length > 0 && (
                <ul className="health-list">
                  {health.map((h) => (
                    <li key={h.name}>
                      <strong>{h.name}</strong> <Chip status={h.status} />
                      <span className="muted">{h.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
              <StepFooter
                showBack={step > 0}
                onBack={back}
                onNext={async () => {
                  setStatus(await onboardingApi.healthContinue());
                  next();
                }}
                showSkip={false}
                nextLabel="Continue"
                extraEnd={
                  <button type="button" className="btn secondary" disabled={healthBusy} onClick={runHealth}>
                    {healthBusy ? "Running checks…" : health.length ? "Run checks again" : "Run checks"}
                  </button>
                }
              />
            </>
          )}

          {current.id === "done" && (
            <>
              <h2>All set</h2>
              <p>Staging kit is configured. Open the dashboard for day-two operations.</p>
              {(health.length > 0 || (status?.lastHealthChecks?.length ?? 0) > 0) && (
                <>
                  <h3>Last health checks</h3>
                  <ul className="health-list">
                    {(health.length ? health : status?.lastHealthChecks ?? []).map((h) => (
                      <li key={h.name}>
                        <strong>{h.name}</strong> <Chip status={h.status} />
                        <span className="muted">{h.detail}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <footer className="step-footer">
                <div className="step-footer-start">
                  {step > 0 && (
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => setStep(visibleSteps.findIndex((s) => s.id === "health"))}
                    >
                      Back to health checks
                    </button>
                  )}
                </div>
                <div className="step-footer-end">
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
                </div>
              </footer>
            </>
          )}

          {current.id !== "done" &&
            current.id !== "topology" &&
            current.id !== "paths" &&
            current.id !== "prod" &&
            current.id !== "staging" &&
            current.id !== "mirror" &&
            current.id !== "storage" &&
            current.id !== "prod-git-init" &&
            current.id !== "health" &&
            current.id !== "welcome" && (
              <StepFooter showBack={step > 0} onBack={back} onNext={next} />
            )}
        </main>
      </div>
    </div>
  );
}

function TopologyStep({
  status,
  showBack,
  onBack,
  onSaved,
}: {
  status: OnboardingStatus;
  showBack: boolean;
  onBack: () => void;
  onSaved: (t: OnboardingStatus["topology"]) => Promise<void>;
}) {
  const [form, setForm] = useState(status.topology);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const showRemoteWarning = !form.sameHostAsKit;

  useEffect(() => {
    setForm(status.topology);
  }, [status.topology]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSaved(form);
    } catch (e) {
      setSaveError(toApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h2>Topology</h2>
      <p>Where do prod and staging Home Assistant run?</p>
      {showRemoteWarning && (
        <p className="muted warn">
          Staging config directory must be reachable on <strong>this kit host</strong> (local disk, NFS, bind mount, etc.).
          REST API access alone is not enough for git apply and storage sync.
        </p>
      )}
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
      {saveError && (
        <div className="save-error">
          <p className="msg err">{saveError.title}</p>
          <p>{saveError.detail}</p>
          {saveError.hint && <p className="muted">{saveError.hint}</p>}
        </div>
      )}
      <StepFooter
        showBack={showBack}
        onBack={onBack}
        onNext={() => {
          void save();
        }}
        showSkip={false}
        nextLabel={saving ? "Saving…" : "Save & continue"}
        primaryDisabled={saving}
      />
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
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(status.paths);
  }, [status.paths]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSaved(form);
    } catch (e) {
      setSaveError(toApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h2>Paths &amp; git</h2>
      <PathsHelpPanel />
      {form.haConfigRepo && form.haStagingConfig && (
        <p className="muted paths-prefill-note">
          Paths are loaded from your kit <code>.env</code>. Change them only if you moved folders; use Browse if you
          need to pick a new location.
        </p>
      )}
      <PathsFormFields
        form={form}
        onChange={setForm}
        showTests
        onTestGitRepo={() => onboardingApi.testGitRepo({ haConfigRepo: form.haConfigRepo })}
        onTestStagingPath={() => onboardingApi.testStagingPath({ haStagingConfig: form.haStagingConfig })}
      />
      {saveError && (
        <div className="save-error">
          <p className="msg err">{saveError.title}</p>
          <p>{saveError.detail}</p>
          {saveError.hint && <p className="muted">{saveError.hint}</p>}
        </div>
      )}
      <div className="step-actions-right">
        <button type="button" className="btn primary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save & continue"}
        </button>
      </div>
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

  useEffect(() => {
    setUrl(status.prod.url);
    setSshTarget(status.prod.sshTarget);
  }, [status.prod.url, status.prod.sshTarget]);

  return (
    <>
      <h2>Production connection</h2>
      <p className="muted">
        How the kit reaches your <strong>production</strong> Home Assistant and host. Used for person/presence sync (REST),
        pulling <code>secrets.yaml</code> and <code>.storage</code> over SSH, and as the source for MQTT mirroring.
      </p>
      <label>
        Production HA URL
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.10:8123" />
      </label>
      <label>
        Production read token {status.prod.hasToken && <span className="configured">configured ✓</span>}
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={status.prod.hasToken ? "Leave blank to keep existing" : "Paste token"} />
      </label>
      <label>
        SSH target (production config on disk — <code>user@host:/path/to/config</code>)
        <input value={sshTarget} onChange={(e) => setSshTarget(e.target.value)} placeholder="user@prod:/homeassistant" />
      </label>
      <label>
        SSH private key {status.prod.hasSshKey && <span className="configured">configured ✓</span>}
        <textarea value={sshKey} onChange={(e) => setSshKey(e.target.value)} rows={4} placeholder="Paste key or leave blank to keep existing" />
      </label>
      <TestButton label="Test production API" onTest={() => onboardingApi.testProd({ url, token: token || undefined })} />
      <TestButton label="Test SSH" onTest={() => onboardingApi.testSsh({ sshTarget, sshPrivateKey: sshKey || undefined })} />
      <div className="step-actions-right">
        <button
          type="button"
          className="btn primary"
          onClick={() => onSaved({ url, token: token || undefined, sshTarget, sshPrivateKey: sshKey || undefined })}
        >
          Save & continue
        </button>
      </div>
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

  useEffect(() => {
    setUrl(status.staging.url);
  }, [status.staging.url]);

  return (
    <>
      <h2>Staging connection</h2>
      <p className="muted">
        How the kit talks to <strong>staging</strong> Home Assistant over the network. The write token lets the kit push
        person/tracker state updates via REST. Config files themselves are written directly to the staging config directory
        on disk — no SSH to staging is required.
      </p>
      <label>
        Staging HA URL
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.11:8123" />
      </label>
      <label>
        Staging write token {status.staging.hasToken && <span className="configured">configured ✓</span>}
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={status.staging.hasToken ? "Leave blank to keep existing" : "Paste token"} />
      </label>
      <TestButton label="Test staging API" onTest={() => onboardingApi.testStaging({ url, token: token || undefined })} />
      <div className="step-actions-right">
        <button type="button" className="btn primary" onClick={() => onSaved({ url, token: token || undefined })}>
          Save & continue
        </button>
      </div>
    </>
  );
}

function MirrorStep({
  status,
  showBack,
  onBack,
  onRefresh,
  onContinue,
}: {
  status: OnboardingStatus;
  showBack: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onContinue: (enabled: boolean, haConfirmed: boolean) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(status.mirror.enabled);
  const [haConfirmed, setHaConfirmed] = useState(status.haMqttConfirmed);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(status.mirror.enabled);
    setHaConfirmed(status.haMqttConfirmed);
  }, [status.mirror.enabled, status.haMqttConfirmed]);

  useEffect(() => {
    void onRefresh();
  }, [onRefresh]);

  const storageDone = status.completedSteps.includes("storage");
  const brokerUp = status.mirrorRunning;
  const alreadyUp = status.mirrorConfigured && brokerUp;
  const canContinue = !enabled || haConfirmed;

  return (
    <>
      <h2>MQTT mirror (optional)</h2>
      <p>
        Live Zigbee/MQTT device states from prod on staging. Two parts: the <strong>kit</strong> runs Mosquitto
        (automatic), then you point <strong>staging Home Assistant</strong> at it once in its UI.
      </p>
      <label className="checkbox">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Yes, enable MQTT mirror
      </label>

      {enabled && (
        <>
          <h3>In this kit (automatic)</h3>
          <p className="muted">
            Mosquitto runs inside this container on port <code>{status.mirror.stagingMqttPort ?? 1883}</code>. Bridge
            targets are derived from your prod and staging HA URLs.
          </p>
          {(status.mirror.prodMqttHost || status.mirror.stagingMqttBrokerHost) && (
            <ul className="checklist">
              {status.mirror.prodMqttHost && (
                <li>
                  Bridge to prod: <code>{status.mirror.prodMqttHost}:{status.mirror.prodMqttPort}</code>
                </li>
              )}
              {status.mirror.stagingMqttBrokerHost && (
                <li>
                  Staging HA should use:{" "}
                  <code>
                    {status.mirror.stagingMqttBrokerHost}:{status.mirror.stagingMqttPort ?? 1883}
                  </code>
                </li>
              )}
            </ul>
          )}
          {!storageDone && (
            <p className="muted warn">
              Complete <strong>Storage sync</strong> on the previous step first — the mirror needs MQTT credentials
              from staging <code>.storage</code>.
            </p>
          )}
          {enabled && alreadyUp ? (
            <p className="msg ok">Mirror broker is running in this kit.</p>
          ) : enabled && status.mirrorConfigured && !brokerUp ? (
            <p className="muted warn">Mirror config exists but Mosquitto is not running — deploy to start it.</p>
          ) : null}
          <div className="step-actions-right ops-actions">
            <ActionButton
              label={alreadyUp ? "Refresh mirror" : "Deploy mirror"}
              toastPreset={alreadyUp ? "refresh-mirror" : "deploy-mirror"}
              onRun={onboardingApi.deployMirror}
              onDone={onRefresh}
              variant={alreadyUp ? "secondary" : "primary"}
              disabled={!storageDone || !enabled}
            />
            <TestButton
              label="Test mirror broker"
              onTest={() =>
                onboardingApi.testMqtt({
                  prodMqttHost: "127.0.0.1",
                  prodMqttPort: status.mirror.stagingMqttPort ?? 1883,
                })
              }
            />
            {status.mirror.prodMqttHost && (
              <TestButton
                label="Test prod bridge"
                onTest={() =>
                  onboardingApi.testMqtt({
                    prodMqttHost: status.mirror.prodMqttHost,
                    prodMqttPort: status.mirror.prodMqttPort,
                  })
                }
              />
            )}
          </div>

          <h3>In staging Home Assistant (you, once)</h3>
          <p className="muted">
            The kit cannot change staging HA&apos;s MQTT integration for you. Follow these steps, then tick the box
            below.
          </p>
          <MqttMirrorInstructions
            stagingHaType={status.topology.stagingHaType}
            brokerHost={status.mirror.stagingMqttBrokerHost ?? undefined}
            brokerPort={status.mirror.stagingMqttPort ?? 1883}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={haConfirmed}
              onChange={(e) => setHaConfirmed(e.target.checked)}
            />
            I&apos;ve pointed staging HA at the mirror broker
          </label>
          <p className="muted warn">Mirror defaults to read-only during onboarding.</p>
        </>
      )}

      <StepFooter
        showBack={showBack}
        onBack={onBack}
        onNext={() => {
          setSaving(true);
          void onContinue(enabled, haConfirmed).finally(() => setSaving(false));
        }}
        showSkip={!enabled}
        nextLabel={saving ? "Saving…" : "Save & continue"}
        primaryDisabled={saving || !canContinue}
      />
    </>
  );
}

function ProdGitInitStep({
  status,
  onDone,
  onNext,
  showBack,
  onBack,
}: {
  status: OnboardingStatus;
  onDone: () => void;
  onNext: () => void;
  showBack: boolean;
  onBack: () => void;
}) {
  const completed = status.completedSteps.includes("prod-git-init");
  const hasSsh = status.prod.hasSshKey && !!status.prod.sshTarget;

  return (
    <>
      <h2>Prod HA git setup</h2>
      <p>
        Initialise your production HA config directory as a git repo so the kit can deploy
        config changes directly to it over SSH.
      </p>
      <ul className="checklist">
        <li>Runs <code>git init</code> on the prod config directory — <strong>no files are changed</strong></li>
        <li>Sets the git remote to match the kit&apos;s config repo</li>
        <li>The first &ldquo;Deploy to prod&rdquo; will push config from <code>main</code> and reload HA</li>
        <li>Safe to run again — idempotent</li>
      </ul>
      {!hasSsh && (
        <p className="msg warn">SSH not configured — complete the Production connection step first.</p>
      )}
      {completed && <p className="msg ok">Prod HA git initialised in this setup session.</p>}
      <div className="step-actions-right ops-actions">
        <ActionButton
          label="Init prod HA git"
          toastPreset="prod-git-init"
          onRun={onboardingApi.prodGitInit}
          onDone={onDone}
          disabled={!hasSsh}
        />
      </div>
      <StepFooter showBack={showBack} onBack={onBack} onNext={onNext} showSkip nextLabel="Next" />
    </>
  );
}

function StorageStep({
  status,
  onDone,
  onNext,
  showBack,
  onBack,
}: {
  status: OnboardingStatus;
  onDone: () => void;
  onNext: () => void;
  showBack: boolean;
  onBack: () => void;
}) {
  const completed = status.completedSteps.includes("storage");

  return (
    <>
      <h2>Storage sync</h2>
      <p>
        One-time (or occasional) copy of selected production <code>.storage</code> files into staging over SSH — entity/device
        registry, MQTT integration credentials, person records, and related images.
      </p>
      <p className="muted">
        <strong>Sidebar turns green</strong> after storage sync completes successfully. You can skip this step if staging
        already has the entities you need, but MQTT mirror setup usually requires it first.
      </p>
      <ul className="checklist">
        <li>Required before first MQTT mirror deploy (mirror reads MQTT creds from staging <code>.storage</code>)</li>
        <li>Run again after adding devices or integrations on production</li>
        <li>Does not modify production — read-only from production&apos;s perspective</li>
        {status.topology.stagingHaType === "docker" && (
          <li>
            Docker staging has no Apps page — MQTT lives under Devices &amp; services, not the Add-on store
          </li>
        )}
        {status.mirror.enabled && status.mirror.stagingMqttBrokerHost && (
          <li>
            After sync, the kit re-applies the mirror broker ({status.mirror.stagingMqttBrokerHost}) so MQTT does not
            stay pointed at prod <code>core-mosquitto</code>
          </li>
        )}
      </ul>
      {completed && <p className="msg ok">Storage sync completed in this setup session.</p>}
      <div className="step-actions-right ops-actions">
        <ActionButton
          label="Run storage sync"
          toastPreset="storage-sync"
          onRun={onboardingApi.storageSync}
          onDone={onDone}
        />
      </div>
      <StepFooter showBack={showBack} onBack={onBack} onNext={onNext} showSkip={false} nextLabel="Next" />
    </>
  );
}
