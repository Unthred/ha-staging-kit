export function MqttMirrorInstructions({
  stagingHaType,
  brokerHost,
  brokerPort = 1883,
}: {
  stagingHaType: string;
  brokerHost?: string;
  brokerPort?: number;
}) {
  const isDocker = stagingHaType === "docker";
  const isHaOs = stagingHaType === "ha_os";
  const hostHint = brokerHost?.trim() || "kit host (derived from staging HA URL)";

  return (
    <>
      <p className="muted">
        The kit runs Mosquitto on port <code>{brokerPort}</code> inside the same container. Staging HA connects to{" "}
        <code>{hostHint}</code> — configured automatically from your URLs and re-applied after storage sync.
      </p>
      <p className="muted">
        This is <strong>not</strong> Settings → Apps{isDocker && " (Apps are HA OS only)"}. Use{" "}
        <strong>Settings → Devices &amp; services → MQTT</strong> on staging HA.
        {isHaOs && " Even on HA OS staging, the mirror broker is configured via the MQTT integration, not the Add-on store."}
      </p>

      {isDocker ? (
        <>
          <ol className="wizard-steps-list">
            <li>Open staging Home Assistant.</li>
            <li>
              <strong>Settings → Devices &amp; services</strong> → <strong>Integrations</strong> → <strong>MQTT</strong>.
            </li>
            <li>
              On <strong>Mosquitto MQTT Broker</strong>, open <strong>⋮</strong> → <strong>Configure</strong>.
            </li>
            <li>
              Set broker to <code>{hostHint}</code> (port <code>{brokerPort}</code>).
            </li>
            <li>Keep prod username/password. Save and reload MQTT if entities stay unavailable.</li>
          </ol>
        </>
      ) : isHaOs ? (
        <>
          <ol className="wizard-steps-list">
            <li>Open staging Home Assistant.</li>
            <li>
              <strong>Settings → Devices &amp; services</strong> → <strong>MQTT</strong>.
            </li>
            <li>
              Configure the MQTT broker host to <code>{hostHint}</code>, port <code>{brokerPort}</code>.
            </li>
            <li>Do not point at production Mosquitto — use the kit mirror on your LAN.</li>
          </ol>
        </>
      ) : (
        <>
          <ol className="wizard-steps-list">
            <li>In staging HA: <strong>Settings → Devices &amp; services → MQTT</strong>.</li>
            <li>
              Set broker to <code>{hostHint}</code>, port <code>{brokerPort}</code>.
            </li>
          </ol>
        </>
      )}
    </>
  );
}
