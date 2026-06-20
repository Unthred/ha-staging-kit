# Plan: staging as a copy of prod (baseline reset)

**Status:** WIP — use this before treating the kit as the primary ship path.

**Goal:** Staging HA + git workbench match **prod today** (registries, Lovelace on disk, helpers, integration entries), except for **documented staging-only differences**. From that clean baseline, all future work follows the [architecture principles](architecture.md#principles-north-star): you change staging → kit owns git → release agent applies to prod.

---

## What “copy of prod” means

| Layer | Source of truth | How staging gets it |
|-------|-----------------|------------------------|
| **YAML** (`automations.yaml`, packages, …) | Git — ideally **`staging` = `main` = prod disk** at reset time | Kit apply-config / `ha-staging-apply.sh` |
| **`.storage`** (entity registry, Lovelace, helpers, config entries) | **Prod live** | **Storage sync** (prod → staging) |
| **Person/tracker state** | Prod live | Person poller (REST, ongoing) |
| **Device/MQTT state** | Prod live (optional) | MQTT mirror (read-only default) |
| **Secrets** | Prod | `secrets.yaml` copied prod → staging on apply (never in git) |

Staging is **not** a second independent home — it is prod’s **mirror + workbench**, with the exceptions below.

Full matrix: [staging-prod-parity-rules.md](staging-prod-parity-rules.md).

---

## Intentionally **not** identical (keep these)

| Exception | Why |
|-----------|-----|
| **`auth` / staging LLATs** | Kit API, person poll, diagnostics — never copy prod auth |
| **MQTT broker host** | Staging → kit mirror (`STAGING_MQTT_BROKER`), not `core-mosquitto` — patched after every storage sync |
| **LAN integrations disabled** | ESPHome, Cast, Android TV, … — staging must not actuate hardware (`disable-lan-integrations.sh`) |
| **OAuth (SmartThings, Tuya, …)** | Each HA instance needs its own tokens — preserve/restore after sync (`OAUTH_PRESERVE_DOMAINS`) |
| **`sidecar_generated.yaml`** | Staging-only runtime overlay (not in git) |
| **Mobile app creds** | Not synced — presence via poller only |
| **MQTT mirror control mode** | Off by default; only enable for time-boxed automation tests |

---

## Prerequisites

Before reset:

- [ ] Kit running; prod + staging URLs and tokens in Settings
- [ ] Prod + staging **SSH** configured (storage sync, secrets apply)
- [ ] `ha-staging-kit` sidecar loop running (`apply-config` / storage sync)
- [ ] Optional but recommended: **MQTT mirror** deployed (`deploy-mirror.sh`)
- [ ] Accept **loss of local WIP**: unpushed git commits, deploy-gate defer/undo, local Lovelace parity edits

---

## Phase 1 — Align git with prod YAML (one-time baseline)

Prod disk is live truth for YAML until deploy pipeline is fully trusted.

1. **Reconcile prod → git `main`** (if needed):
   ```bash
   bash /boot/config/scripts/ha-config-backup.sh
   ```
   Review diff; commit on `main` if prod has drifted ahead of git.

2. **Align `staging` branch with `main`** for a identical starting YAML:
   - Merge `main` → `staging` on GitHub (or locally), **or**
   - Reset `staging` to `main` if no staging-only commits worth keeping (WIP — likely fine).

3. **Push** so `origin/staging` and `origin/main` match what prod actually runs (YAML only).

**Outcome:** Git YAML describes prod; staging branch is not carrying orphan Lovelace/deploy-gate experiments.

---

## Phase 2 — Baseline from prod (kit)

One-shot clean slate: **prod live → git → GitHub → staging**. Use when git, staging, and prod have drifted and you need all three aligned before new work.

**Kit UI:** Operations → **Baseline from prod**

Or API: `POST /api/operations/baseline-from-prod`

This (unlike **Reset workbench**):

- Rsyncs prod YAML + Lovelace/helpers `.storage` into git and commits on `staging`
- Resets `main` to the same commit and **force-pushes** `origin/main` and `origin/staging`
- Clears deploy-gate defer/undo/recheck and release history; sets `last-prod-deploy.sha` to the baseline commit
- Wipes staging recorder DB and **all** of staging `.storage` except auth (kit LLAT / UI login), then runs `apply-config` + prod `.storage` sync, deploys MQTT mirror, restarts staging HA

**Outcome:** Git deploy payload, staging disk, and prod should describe the same config (except documented staging-only exceptions).

### Reset workbench (lighter)

**Kit UI:** Deploy gate → **Reset workbench…** or `POST /api/operations/reset-workbench`

Resets git to **GitHub `staging` only** (no prod → git export). Use for discarding local WIP, not for a full prod-aligned baseline.

---

## Phase 3 — Post-sync checklist (manual once, then rare)

After reset or any full storage sync:

| Step | Action |
|------|--------|
| 1 | **Staging LLAT** — Kit → Settings → Staging → save new long-lived token |
| 2 | **MQTT** — Confirm sync log: `Patched staging MQTT broker → …` ; restart staging HA if entities unavailable |
| 3 | **SmartThings / Tuya** — Reconfigure **once** on staging if integrations fail (later syncs preserve if in `OAUTH_PRESERVE_DOMAINS`) |
| 4 | **Mirror** — `ha-mirror-control-mode.sh status` → read-only; redeploy mirror if creds rotated |
| 5 | **Person poll** — Diagnostics or `person-poller.sh --once`; persons match prod within ~60s |

See [staging-prod-parity-rules.md § After each operation](staging-prod-parity-rules.md#after-each-operation--checklist).

---

## Phase 4 — Verify parity (kit)

Run from kit after staging is up:

| Check | Pass criteria |
|-------|----------------|
| **Diagnostics** | Prod + staging API OK; staging token not `_kit` rejected |
| **Entity parity** (Dashboard) | No unexpected prod-only/staging-only surprises (documented exceptions OK) |
| **Entity deploy scan** | Baseline blockers understood — naming/registry issues on **prod** are prod-fix backlog, not staging drift |
| **Storage sync log** | Recent successful run in Operations / `sync.log` |
| **Database health** (prod + staging) | See [Database health](#database-health-size-and-engine) below |

Optional CLI:

```bash
docker exec ha-staging-kit tail -50 /sidecar-data/sync.log
```

---

## Database health, size, and engine

Home Assistant's **recorder** database drives history, energy, logbook, and many diagnostics. The kit should treat it as first-class infrastructure — not only YAML and `.storage`.

### What to check (baseline + ongoing)

| Signal | Prod | Staging | Notes |
|--------|------|---------|-------|
| **Engine** | SQLite / MariaDB / PostgreSQL | Usually SQLite (lighter mirror) | Read from `configuration.yaml` `recorder:` block |
| **File or server size** | `home-assistant_v2.db` or external DB | Same pattern | Warn on rapid growth or > threshold (user-configurable) |
| **Integrity** | `sqlite3 … "PRAGMA integrity_check"` or DB-native check | Same on staging | Fail loudly before ship/deploy if corrupt |
| **Recorder errors** | HA logs + Diagnostics | Same | `recorder` / DB connection failures block "healthy" status |
| **Retention policy** | `purge_keep_days`, `auto_purge` | Staging may differ via `sidecar_generated.yaml` | Document intentional staging-only retention |

Kit UI target: **Diagnostics → Database** panel with prod/staging side-by-side (size, engine, last purge, error count, trend).

### Changing database engine (user-initiated)

The kit should **guide and automate** engine changes — not leave users to wiki-hop.

| Step | Kit responsibility |
|------|-------------------|
| 1. **Pre-flight** | Backup DB + config snapshot; show downtime estimate |
| 2. **Choose engine** | SQLite (default), MariaDB, PostgreSQL — validate host/credentials reachable |
| 3. **Generate config** | Patch `recorder:` + `db_url` in git (staging first) |
| 4. **Migrate data** | Run HA-supported migration or documented `mysqldump` / `pg_dump` path; idempotent re-run |
| 5. **Verify** | History queries, energy dashboard, logbook; integrity check on new engine |
| 6. **Release** | Ship via release agent to prod (not ad-hoc SSH) |

**Staging first:** always prove engine change on staging mirror before prod release.

**Out of scope for baseline reset:** engine migration itself — baseline only **records current engine + size** as the starting snapshot.

---

## Phase 5 — Operating model going forward

Once baseline is clean:

```
Prod (read-only to kit) ──storage sync──► Staging mirror
        ▲                                      │
        │                                      │ you edit staging HA / kit commits git
        │                                      ▼
        └──────── release agent (future) ── git main
```

| Activity | Where |
|----------|--------|
| Try dashboard/automation changes | **Staging HA** |
| Kit examines problems | Read prod + staging |
| Kit writes git | **Staging branch** commits |
| Review before prod | Kit deploy gate |
| Apply to prod | **Release agent** (future) — not kit SSH fix buttons |

**Do not** re-accumulate staging-only registry edits — add devices on prod, storage sync, then edit on staging.

---

## Roadmap (after baseline)

Ordered work to match [architecture.md](architecture.md):

| # | Deliverable | Notes |
|---|-------------|--------|
| 1 | **Baseline reset** (this plan) | Staging = prod + exceptions |
| 2 | **Migration manifest format** in git | Registry renames as data, not kit SSH |
| 3 | **Release agent** (cross-platform) | Applies `main` + migrations; replaces kit SSH deploy |
| 4 | **Kit: generate migration + git patches** | Naming/deploy scan → artifacts, not “fix prod” |
| 5 | **Deprecate direct prod registry fixes** in UI | Read-only prod during review |
| 6 | **Database diagnostics** | Health, size, integrity, recorder errors — prod + staging in kit UI |
| 7 | **Database engine wizard** | User chooses SQLite / MariaDB / PostgreSQL; kit generates config + migration steps; staging-first, release agent to prod |
| 8 | **Optional:** GitHub Actions or sidecar profile runs same agent as Windows/Linux service |

---

## When to re-run baseline reset

- Staging entity registry clearly diverged from prod (experiments, manual staging UI entity deletes)
- Deploy gate defer/undo stack is unusable and git Lovelace is corrupted
- After major prod integration changes (new hub, re-pair) — **storage sync** alone may suffice; full reset if git also drifted

**Lightweight alternative:** Operations → **Storage sync** + restart staging HA (no git hard reset).

---

## Related

- [architecture.md](architecture.md) — principles
- [staging-prod-parity-rules.md](staging-prod-parity-rules.md) — sync matrix
- [design-entity-deploy-scan.md](design-entity-deploy-scan.md) — deploy gate
- [config-repo/docs/staging-environment.md](../../config-repo/docs/staging-environment.md) — container/MQTT setup
