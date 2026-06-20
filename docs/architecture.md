# Architecture

## Principles (north star)

These are the product rules new features should follow. Some WIP UI still diverges (e.g. interactive “fix prod” buttons); the direction is to converge on this model.

### Two jobs

| Job | What the kit does |
|-----|-------------------|
| **1. Examine & fix** | Read prod and staging, find problems (entity parity, naming, dashboard refs, Z2M, etc.), and **apply fixes when automatable** — not hand you a checklist to go click on prod. |
| **2. Review & release** | You change **staging HA** (normal HA UI). The kit shows diffs, runs scans, and after approval **promotes to prod via git**. |

### Who touches what

| Layer | Role |
|-------|------|
| **Prod HA** | Live home — source of truth for what is actually running |
| **Staging HA** | Workbench — try automations, dashboard, YAML before prod |
| **Git** | Audit trail and promotion path (`staging` → `main`) — **the kit writes git**; users do not edit the repo by hand in normal workflow |
| **You** | Use staging HA + kit UI (approve, defer, ship) — **not** SSH to prod to fix deploy issues when avoidable |

### Prod access during review

- **Except onboarding/setup:** the kit treats prod as **read-only** for diagnostics (API + SSH read of `.storage` where needed).
- **Prod changes** happen through an **approved release** (git content + optional migrations), executed **automatically** by a **release runner** — not ad-hoc kit SSH during the review UI.
- **Rollback** to any prior release: git @ that SHA (YAML + bundled `.storage`) plus registry snapshot from release history — see [design-release-agent.md](design-release-agent.md).
- **Goal:** user never manually operates prod when the kit can generate the change and the pipeline can apply it.
- **Reality:** some fixes still need the integration vendor UI (OAuth, re-pair, SmartThings app, etc.). The kit must say so explicitly and not pretend.

### Fix paths (automatable first)

| Problem | Kit action |
|---------|------------|
| Dashboard / YAML / scripts entity ids | Patch **staging + git** (workbench); ship with release |
| Lovelace / helpers in `.storage` | Same — captured on staging, committed by kit, deployed in bundle |
| Prod entity registry (`_2`, tombstones, `_cast`) | Kit **generates migration artifact in git**; **release runner** applies on deploy (stop Core → edit registry → apply config → start) |
| Integration-native rename | Document manual step; optional deep-link hints |

### Git promotion

```
You edit staging HA
        │
        ▼
Kit detects / captures changes → commits on staging branch
        │
        ▼
Kit review (entity deploy scan, parity, naming advisory)
        │
        ▼
You approve in kit → kit merges staging → main, pushes
        │
        ▼
Release runner applies main on prod (YAML + .storage bundle + migrations)
```

See [design-entity-deploy-scan.md](design-entity-deploy-scan.md) for deploy-gate scan details.

Migration manifest format: [design-migration-manifest.md](design-migration-manifest.md) ([#10](https://github.com/Unthred/ha-staging-kit/issues/10)).  
Release agent: [design-release-agent.md](design-release-agent.md) ([#13](https://github.com/Unthred/ha-staging-kit/issues/13) / [#14](https://github.com/Unthred/ha-staging-kit/issues/14)).

### Community / OS agnostic

- **Do not require** Unraid, OPNsense, or a specific NAS.
- **Do require** two HA instances reachable by URL + API token.
- **Require for full ship/migrate:** config access on both instances — **SSH/SFTP** to config dir **or** local bind mount (install-type dependent). Setup wizard configures this once.
- **Home Assistant install types differ:** HA OS (Green, VM), Container, and Core are all valid; **not every install uses Docker** (Core is venv-only; HA OS uses Docker internally via Supervisor but users often never touch it).
- **Optional:** [MQTT mirror](staging-ha-mqtt.md) so staging sees live device states for automation debugging — recommended, not mandatory.

### Database (recorder)

| Concern | Kit role |
|---------|----------|
| **Health & size** | Report engine type, DB size, integrity, recorder errors on prod and staging |
| **Engine change** | Wizard: backup → patch `recorder:` in git → migrate data on staging → verify → release agent applies to prod |
| **Staging default** | May use shorter retention via `sidecar_generated.yaml`; engine type should match prod unless user is testing a migration |

See [plan-staging-prod-baseline.md § Database health](plan-staging-prod-baseline.md#database-health-size-and-engine).

### Setup expectations (SSH)

| Instance | Typical need |
|----------|----------------|
| **Prod** | SSH (or equivalent) for registry/storage reads, sparse git init on config dir, automated migrations and deploy apply |
| **Staging** | SSH or local path for kit to apply git checkout and capture `.storage` |

API-only mode may suffice for light parity; **ship and migrate need config access**.

---

## Separation

| Repo | Contents |
|------|----------|
| **ha-staging-kit** (this repo) | Console, sidecar, optional MQTT mirror, compose, ops scripts |
| **Your HA config repo** | `automations.yaml`, `.storage/` Lovelace bundle, migration manifests — promoted staging → main |

Staging-only runtime (log counters, recorder retention) may be written by the sidecar to `packages/sidecar_generated.yaml` on staging — not always in git.

## Authority model (runtime)

| Layer | Role |
|-------|------|
| **Prod HA** | Runs the home today |
| **Staging HA** | Workbench |
| **Git (`staging`)** | WIP approved by kit commits |
| **Git (`main`)** | Released config prod should match |

## Current WIP vs target

| Area | Target (principles above) | WIP today |
|------|---------------------------|-----------|
| Git edits | Kit only | Kit + local parity fixes; user still merges via ship wizard |
| Prod registry fixes | Migration in git + release runner | Confirmed “Fix entity id on prod” via kit SSH |
| Prod deploy | Release runner executes approved `main` | Kit SSH git bundle + `.storage` copy + reload |
| Naming scan | Advisory → generate migration | Scan + optional kit SSH fix |

Track convergence in [backlog.md](backlog.md) and [design-release-architecture-roadmap.md](design-release-architecture-roadmap.md) (epic [HomeAssistant #9](https://github.com/Unthred/ha-staging-kit/issues/9)).

## Flow (reference deployment)

```
Kit reads prod (API + SSH read) ──diagnose──► issues + proposed fixes
        │
        ├── writes git (staging) + staging HA apply
        │
        └── user approves ship
                │
                ▼
        merge staging → main, push
                │
                ▼
        release runner on prod (target) / kit SSH deploy (WIP)
                │
                ├── run pending migrations from git
                ├── apply YAML + Lovelace/helper .storage from main
                └── reload / restart Core

Optional: prod Mosquitto ──bridge──► mirror broker ──► staging MQTT (read-only)

prod HA ──backup──► git main
```

Console (web UI): **Activity** streams prod + staging logbook over SignalR; see [staging-prod-parity-rules.md](staging-prod-parity-rules.md).

## Parity rules

Staging and prod should match on YAML, registries, and Lovelace — with **documented exceptions** (auth/tokens, MQTT broker patch, LAN disable, presence poller). See [staging-prod-parity-rules.md](staging-prod-parity-rules.md).

## Topology

Prod and staging may be **HA OS**, **Container**, **Core**, or **mixed**. Configure URLs and SSH targets (or local paths) in kit settings — nothing is hardcoded to a specific host OS.

## Control mode

Default: MQTT mirror is **read-only**. Opt-in **control mode** forwards command topics to prod for automation testing — real devices can actuate. Disable after tests.

## Related docs

- [plan-staging-prod-baseline.md](plan-staging-prod-baseline.md) — reset staging to prod copy + roadmap
- [design-entity-deploy-scan.md](design-entity-deploy-scan.md) — deploy gate scan
- [setup.md](setup.md) — onboarding, tokens, SSH keys
- [staging-ha-mqtt.md](staging-ha-mqtt.md) — optional MQTT mirror
