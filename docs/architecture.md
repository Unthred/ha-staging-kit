# Architecture

## Separation

| Repo | Contents |
|------|----------|
| **ha-staging-kit** (this repo) | Sidecar, MQTT mirror, compose, ops scripts |
| **Your HA config repo** | `automations.yaml`, `packages/`, etc. — same YAML on prod and staging in git |

Staging-only runtime (log counters, recorder retention) is written by the sidecar to `packages/sidecar_generated.yaml` on staging appdata — not in git.

## Authority model

| Layer | Role |
|-------|------|
| **Prod HA** | Live source of truth — runs the home today |
| **Staging HA** | Workbench — test repo changes before they go live |
| **Git (`staging` branch)** | Work in progress; kit applies to staging |
| **Git (`main` branch)** | Approved releases + live prod backup |

Prod deploy from git is configured in the **HomeAssistant config repo** (GitHub Actions + self-hosted runner) — not in this kit.

## Flow

```
Agent edits HA config git (staging branch)
        │
        ▼
ha-staging-kit ──rsync──► staging HA appdata (workbench)
        │
        ├── REST poll ──► prod HA (read person/tracker — live truth)
        ├── REST write ──► staging HA
        └── SSH rsync ──► prod secrets + .storage subset (baseline from live prod)

prod Mosquitto ──bridge──► mosquitto-mirror ──► staging HA MQTT (read-only default)

git main ──GitHub Actions prod-deploy──► prod HA
prod HA ──backup──► git main
```

## Topology

Prod and staging HA may be **physical**, **Docker**, or **mixed**. Configure URLs and SSH targets in `.env` / sidecar secrets — nothing is hardcoded to a specific NAS or OS.

## Control mode

Default: mirror is **read-only**. Opt-in **control mode** forwards `zigbee2mqtt/+/set` to prod for automation testing — real devices can actuate. Always disable after tests.

## Future: web console

Settings and operations will move to a web UI in this stack — see `design-staging-console.md` in the HomeAssistant config repo.
