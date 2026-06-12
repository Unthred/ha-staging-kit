# Architecture

## Separation

| Repo | Contents |
|------|----------|
| **ha-staging-kit** (this repo) | Sidecar, MQTT mirror, compose, ops scripts |
| **Your HA config repo** | `automations.yaml`, `packages/`, etc. — identical on prod and staging in git |

Staging-only runtime (log counters, recorder retention) is written by the sidecar to `packages/sidecar_generated.yaml` on staging appdata — not in git.

## Flow

```
HA config git (staging branch)
        │
        ▼
ha-staging-sidecar ──rsync──► staging HA appdata
        │
        ├── REST poll ──► prod HA (read person/tracker)
        ├── REST write ──► staging HA
        └── SSH rsync ──► prod secrets + .storage subset

prod Mosquitto ──bridge──► mosquitto-mirror ──► staging HA MQTT
```

## Topology

Prod and staging HA may be **physical**, **Docker**, or **mixed**. Configure URLs and SSH targets in `.env` / sidecar secrets — nothing is hardcoded to a specific NAS or OS.

## Control mode

Default: mirror is **read-only**. Opt-in **control mode** forwards `zigbee2mqtt/+/set` to prod for automation testing — real devices can actuate. Always disable after tests.

## Future: web console

Settings and operations will move to a web UI in this stack — see `design-staging-console.md` in the HomeAssistant config repo.
