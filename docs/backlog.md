# ha-staging-kit — backlog

Open items to batch before implementing.

**Board:** [ha-staging-kit project #4](https://github.com/users/Unthred/projects/4) · Epic [#9](https://github.com/Unthred/ha-staging-kit/issues/9)

Full roadmap: [design-release-architecture-roadmap.md](design-release-architecture-roadmap.md)

Create kit issues with `ha-staging-kit-issue-create.sh` (not `ha-issue-create.sh` — that is for **Unthred/HomeAssistant** config-repo work on project #2).

## Release architecture (epic #9)

| # | Issue | Stream |
|---|-------|--------|
| 10 | [Migration manifest format in git](https://github.com/Unthred/ha-staging-kit/issues/10) | A — git artifacts | **Done** |
| 11 | [Kit — export migration from deploy gate and naming scan](https://github.com/Unthred/ha-staging-kit/issues/11) | A — kit | **Done** |
| 12 | [Pilot migrations — SquiggleBear, zaphod_shield_cast, timer](https://github.com/Unthred/ha-staging-kit/issues/12) | A — pilots | Deferred (#14) |
| 13 | [Design release agent](https://github.com/Unthred/ha-staging-kit/issues/13) | B — spec | **Done** |
| 14 | [Release agent MVP](https://github.com/Unthred/ha-staging-kit/issues/14) | B — build | **Next** |
| 15 | [Deprecate kit SSH prod fixes and deploy-to-prod UI](https://github.com/Unthred/ha-staging-kit/issues/15) | C — converge UI | Phase 1 |
| 16 | [Git Lovelace authority — reconcile prod dashboard with git](https://github.com/Unthred/ha-staging-kit/issues/16) | D — hygiene |
| 17 | [Fix SidecarRunner timeout for reset-workbench](https://github.com/Unthred/ha-staging-kit/issues/17) | D — hygiene |
| 18 | [Database diagnostics panel](https://github.com/Unthred/ha-staging-kit/issues/18) | E — database |
| 19 | [Database engine migration wizard](https://github.com/Unthred/ha-staging-kit/issues/19) | E — database |

**Suggested order:** 10 → 13 → 14 → 12 → 15 → 16 → 17 → 18 → 19

## Onboarding / UX

- [x] **Remove "Deploy kit" wizard step** — redundant once the UI is reachable (container already running). Onboarding should be configure + run scripts (storage sync, deploy mirror), not Docker rebuild/redeploy. Rebuild belongs on the host for first install and kit upgrades only.
- [x] **Onboarding wizard (web)** — topology, paths, prod/staging, storage sync, unified MQTT mirror step, health checks with progress, auto-detect, toasts. Shipped 2026-06-13.

## Prod deploy (legacy — superseded by #9)

- [ ] **Webhook/automation-based prod deploy** — alternative to SSH for installs where SSH is not available. _(May fold into release agent #14.)_

## Staging parity (state mirror)

| Phase | Scope | Status |
|-------|--------|--------|
| 1 | MQTT prod → staging (Zigbee, Tasmota) | Shipped |
| 1b | MQTT control mode (Z2M actuation) | Shipped |
| — | Person / phone presence poller | Shipped |
| **2** | **Kit state mirror — non-MQTT entities** | [Design](design-staging-state-mirror-phase2.md) · [#20](https://github.com/Unthred/ha-staging-kit/issues/20) |

**Suggested order:** after #14 release agent MVP (orthogonal) or in parallel if staging realism is priority.

## Dashboard (next)

- [ ] **Dashboard polish** — align day-two UX with wizard (toasts, staging target summary, clearer suggested actions)
- [ ] **Dashboard metrics** — last storage sync / apply / person poll from sync.log (partially wired)
- [ ] **Quick actions** — friendly toasts for apply + person poll (same pattern as wizard)
