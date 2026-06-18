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

Prod deploy is handled entirely by the kit: after merging to `main` and pushing to GitHub, the kit SSHes to prod HA, runs `git pull` on its config directory, and triggers a config reload. No GitHub Actions runner is required.

**SSH is the only prod-deploy mechanism supported today.** Prod HA must have SSH accessible from the kit container and its config directory must be initialised as a git clone of the repo during onboarding. The SSH user also needs **passwordless `sudo`** — on HA OS the config directory (`/homeassistant`) is root-owned, so `git init` and `git reset` require `sudo`. A webhook/HA-automation-based alternative (for installs without SSH or passwordless sudo) is tracked in [backlog.md](backlog.md).

## Flow

```
Agent / UI edits HA config git (staging branch)
        │
        ▼
ha-staging-kit sidecar ──apply──► staging HA config dir (workbench)
        │
        ├── REST poll ──► prod HA (read person/tracker — live truth)
        ├── REST write ──► staging HA
        └── SSH ──► prod secrets + .storage subset (baseline from live prod)

prod Mosquitto ──bridge──► mosquitto-mirror ──► staging HA MQTT (read-only default)

UI "Deploy to prod"
  ──git merge staging→main + push──► GitHub
  ──entity deploy scan──► block until git Lovelace refs match live prod
  ──kit SSH──► prod HA: git pull + Lovelace/helper .storage bundle + HA reload

See [design-entity-deploy-scan.md](design-entity-deploy-scan.md) — deploy never renames prod entities; user fixes integration/HA manually, then Recheck.

prod HA ──backup──► git main
```

## Parity rules

Staging and prod should match on YAML, registries, and Lovelace — with **documented exceptions** (auth/tokens, MQTT broker patch, LAN disable, presence poller). See [staging-prod-parity-rules.md](staging-prod-parity-rules.md).

## Topology

Prod and staging HA may be **physical**, **Docker**, or **mixed**. Configure URLs and SSH targets in `.env` / sidecar secrets — nothing is hardcoded to a specific NAS or OS.

## Control mode

Default: mirror is **read-only**. Opt-in **control mode** forwards `zigbee2mqtt/+/set` to prod for automation testing — real devices can actuate. Always disable after tests.

## Future: web console

Settings and operations will move to a web UI in this stack — see `design-staging-console.md` in the HomeAssistant config repo.
