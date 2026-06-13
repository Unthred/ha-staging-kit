export const PATH_FIELD_HINTS = {
  haConfigRepo: "Host path to your Home Assistant config git repo (not the ha-staging-kit repo)",
  haStagingConfig: "Host folder where staging Home Assistant reads configuration.yaml",
  kitData: "Host folder for kit secrets, tokens, logs, and onboarding state",
  mirrorData: "Host folder for MQTT mirror config and logs (optional)",
} as const;

export function PathsHelpPanel() {
  return (
    <>
      <p className="paths-intro">
        Enter <strong>host paths</strong> — folders on the machine running Docker (e.g. Unraid), not paths inside the
        container. Values usually come from your kit <code>.env</code> on first load.
      </p>

      <details className="paths-map">
        <summary>What each folder is for</summary>
        <table className="paths-table">
          <thead>
            <tr>
              <th scope="col">Setting</th>
              <th scope="col">Purpose</th>
              <th scope="col">Mounted in container as</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>HA config git repo</td>
              <td>
                Your Home Assistant YAML in git (<code>automations.yaml</code>, <code>packages/</code>, etc.).
                The kit checks out the <code>staging</code> branch and applies it to the staging workbench. Prod HA
                remains live truth for the running home until deploy from git exists.
              </td>
              <td>
                <code>/repo</code>
              </td>
            </tr>
            <tr>
              <td>Staging HA config directory</td>
              <td>
                Where staging Home Assistant loads config from on disk. The kit writes synced YAML here; staging HA
                reads it.
              </td>
              <td>
                <code>/ha-config</code>
              </td>
            </tr>
            <tr>
              <td>Kit data directory</td>
              <td>
                This kit&apos;s own data: API tokens, SSH key, <code>sync.log</code>, onboarding state. Not Home
                Assistant config.
              </td>
              <td>
                <code>/sidecar-data</code>
              </td>
            </tr>
            <tr>
              <td>Mirror data directory</td>
              <td>Mosquitto broker config and logs when the optional MQTT mirror is enabled.</td>
              <td>same host path</td>
            </tr>
          </tbody>
        </table>
      </details>

      <details className="paths-internal">
        <summary>Paths you do not configure</summary>
        <ul className="paths-internal-list">
          <li>
            <code>/kit</code> — the ha-staging-kit app (scripts, UI). Baked into the container; not a Settings field.
          </li>
          <li>
            <code>/sidecar</code> — sync scripts run by the kit. Internal only.
          </li>
          <li>
            <code>/mnt/user</code> and <code>/mnt/cache</code> — Unraid browse shortcuts in the path picker so you can
            navigate appdata and cache; not separate kit data stores.
          </li>
        </ul>
      </details>
    </>
  );
}
