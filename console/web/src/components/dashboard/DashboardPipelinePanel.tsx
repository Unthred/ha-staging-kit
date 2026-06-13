export function DashboardPipelinePanel({ mirrorConfigured }: { mirrorConfigured: boolean }) {
  return (
    <section className="dash-panel dash-pipeline">
      <header className="dash-panel-head">
        <div>
          <p className="dash-panel-eyebrow">Architecture</p>
          <h3>Data flow</h3>
        </div>
      </header>

      <div className="dash-flow">
        <div className="dash-flow-node dash-flow-git">
          <span className="dash-flow-title">Git</span>
          <span className="dash-flow-sub">staging branch</span>
        </div>
        <span className="dash-flow-connector" aria-hidden="true" />
        <div className="dash-flow-node dash-flow-kit">
          <span className="dash-flow-title">Kit</span>
          <span className="dash-flow-sub">sync · UI</span>
        </div>
        <span className="dash-flow-connector" aria-hidden="true" />
        <div className="dash-flow-node dash-flow-staging">
          <span className="dash-flow-title">Staging HA</span>
          <span className="dash-flow-sub">config + REST</span>
        </div>
      </div>

      <ul className="dash-flow-links">
        <li>
          <strong>Prod HA</strong> <span className="muted">live truth · REST read · SSH secrets</span>
        </li>
        <li>
          <strong>Git</strong> → kit → staging HA <span className="muted">workbench · YAML apply</span>
        </li>
        <li>
          {mirrorConfigured ? (
            <>
              <strong>Prod MQTT</strong> → kit broker → staging <span className="muted">live states</span>
            </>
          ) : (
            <span className="muted">MQTT mirror optional — enable in Settings</span>
          )}
        </li>
      </ul>
    </section>
  );
}
