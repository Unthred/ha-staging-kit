import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardHeader } from "../components/dashboard/DashboardHeader";
import { ActivityFeed, filterActivityEvents } from "../components/activity/ActivityFeed";
import { ActivitySyncConceptPicker } from "../components/activity/ActivitySyncConceptPicker";
import { ActivitySearchInput } from "../components/activity/ActivitySearchInput";
import { useActivityStream } from "../hooks/useActivityStream";
import { useActivityPulseMetrics } from "../hooks/useActivityPulseMetrics";
import { useActivitySuggestions } from "../hooks/useActivitySuggestions";
import { useHaUrls } from "../hooks/useHaUrls";

type InstanceFilter = "all" | "prod" | "staging";
type DomainFilter = "all" | "automation" | "script" | "notify";
type ViewMode = "unified" | "split";

function StatusChip({ instance, state, detail }: { instance: string; state: string; detail?: string | null }) {
  const tone =
    state === "connected" ? "pass" : state === "connecting" || state === "disconnected" ? "warn" : "fail";
  const label = instance.replace(" HA", "");
  return (
    <span className={`activity-status-chip activity-status-chip--${tone}`} title={detail ?? undefined}>
      {label}: {state.replace("_", " ")}
    </span>
  );
}

export default function ActivityPage() {
  const { events, statuses, connected, error } = useActivityStream();
  const pulseMetrics = useActivityPulseMetrics(events);
  const { items: suggestionItems, automationCount, scriptCount, loading: suggestionsLoading } = useActivitySuggestions();
  const haUrls = useHaUrls();
  const [instanceFilter, setInstanceFilter] = useState<InstanceFilter>("all");
  const [domainFilter, setDomainFilter] = useState<DomainFilter>("all");
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("unified");
  const [paused, setPaused] = useState(false);

  const filtered = useMemo(
    () => filterActivityEvents(events, { instance: instanceFilter, domain: domainFilter, query }),
    [events, instanceFilter, domainFilter, query],
  );

  const split = useMemo(() => {
    const prod = filtered.filter((e) => e.instance.includes("Production"));
    const staging = filtered.filter((e) => e.instance.includes("Staging"));
    return { prod, staging };
  }, [filtered]);

  return (
    <div className="dash activity-page">
      <DashboardHeader
        kicker="Activity"
        title="Automations & scripts"
        subtitle="Live logbook stream from production and staging Home Assistant"
        stagingUrl={haUrls.stagingUrl}
        prodUrl={haUrls.prodUrl}
      />

      <section className="card activity-toolbar">
        <div className="activity-status-row">
          {statuses.map((s) => (
            <StatusChip key={s.instance} instance={s.instance} state={s.state} detail={s.detail} />
          ))}
          <span className={`activity-stream-chip ${connected ? "activity-stream-chip--live" : ""}`}>
            {connected ? "Live" : "Connecting…"}
          </span>
        </div>

        {(statuses.some((s) => s.state === "auth_failed") || error) && (
          <p className="activity-banner muted">
            Stream problem — check API tokens in <Link to="/settings">Settings</Link>.
            {error ? ` ${error}` : ""}
          </p>
        )}

        <div className="activity-controls">
          <label className="activity-control">
            Instance
            <select value={instanceFilter} onChange={(e) => setInstanceFilter(e.target.value as InstanceFilter)}>
              <option value="all">Both</option>
              <option value="prod">Production</option>
              <option value="staging">Staging</option>
            </select>
          </label>
          <label className="activity-control">
            Type
            <select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value as DomainFilter)}>
              <option value="all">Automations, scripts &amp; notify</option>
              <option value="automation">Automations</option>
              <option value="script">Scripts</option>
              <option value="notify">Mobile notify</option>
            </select>
          </label>
          <label className="activity-control activity-control-grow">
            Search
            <ActivitySearchInput
              value={query}
              onChange={setQuery}
              domainFilter={domainFilter}
              suggestions={suggestionItems}
              automationCount={automationCount}
              scriptCount={scriptCount}
              loading={suggestionsLoading}
            />
          </label>
          <div className="activity-control activity-view-toggle">
            <button
              type="button"
              className={`btn ghost ${viewMode === "unified" ? "active" : ""}`}
              onClick={() => setViewMode("unified")}
            >
              Unified
            </button>
            <button
              type="button"
              className={`btn ghost ${viewMode === "split" ? "active" : ""}`}
              onClick={() => setViewMode("split")}
            >
              Split
            </button>
          </div>
          <button type="button" className="btn ghost" onClick={() => setPaused((p) => !p)}>
            {paused ? "Follow live" : "Pause scroll"}
          </button>
        </div>

        <p className="muted activity-hint">
          Shows automation, script, and mobile notify runs from the HA logbook (last 15 minutes on connect, then live). Medication/Yak reminders appear as notify when the push is sent. Staging often
          fires fewer events than prod — LAN integrations are disabled and presence is mirrored.
          {!suggestionsLoading && automationCount + scriptCount > 0 ? (
            <>
              {" "}
              Search covers {automationCount + scriptCount} entities from HA ({automationCount} automations,{" "}
              {scriptCount} scripts).
            </>
          ) : null}
        </p>
      </section>

      <ActivitySyncConceptPicker events={events} parityFlash={pulseMetrics.parityFlash} />

      {viewMode === "split" ? (
        <div className="activity-split">
          <section className="card activity-panel">
            <header className="activity-panel-head">
              <h3>Production</h3>
              <span className="muted">{split.prod.length} events</span>
            </header>
            <ActivityFeed events={split.prod} paused={paused} />
          </section>
          <section className="card activity-panel">
            <header className="activity-panel-head">
              <h3>Staging</h3>
              <span className="muted">{split.staging.length} events</span>
            </header>
            <ActivityFeed events={split.staging} paused={paused} />
          </section>
        </div>
      ) : (
        <section className="card activity-panel">
          <header className="activity-panel-head">
            <h3>Timeline</h3>
            <span className="muted">{filtered.length} events</span>
          </header>
          <ActivityFeed events={filtered} paused={paused} />
        </section>
      )}
    </div>
  );
}
