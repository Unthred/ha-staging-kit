# Checkpoint — 2026-06-17 (nav attention badges + ops UX)

Resume here after work — nav/operations badge UX is **deployed live**; **large uncommitted diff** in kit git (not committed).

## Live state

| System | State |
|--------|--------|
| **Kit UI (live)** | `index-DGtfEeeu.js` + `index-CW78ELE9.css` via `ha-staging-kit-deploy-quick.sh ui` |
| **Kit API** | Deployed earlier in session (`StatusService` person-poll stale log fix) |
| **Kit sidecar** | `APPLY_ON_START=auto` in `/mnt/user/appdata/ha-staging-kit/config.env`; `apply-config.sh` no longer git-pulls unless `GIT_PULL=1` |
| **Staging person poll** | Working again after token fix in Kit Settings |
| **Storage patch** | CRLF fixed on `patch-staging-storage.sh`; MQTT broker patched to `192.168.13.1:1883` |
| **LAN integration disable** | Still **404** from staging HA API — YAML guards protect actuation; not fixed |
| **Kit git** | `main` — **many modified + untracked files, nothing committed** |

## What shipped today (attention / UX)

### Nav badges (top menu)

- Counts per page: Overview, Environment, Diagnostics, Operations, Settings, Setup wizard
- **Operations nav count** = unique workflow **actions** (not duplicate attention items)

### No big “Needs attention” banners

- Removed page-top attention panels (too duplicative)
- **Inline badges only** beside the relevant section/tab/button

### Overview

- Ordered badges **1, 2, 3…** on workflow sections (suggested action → parity → ship steps → entity gate)
- See `overviewAttentionOrders()` in `console/web/src/lib/navAttention.ts`

### Operations

- **Sidebar badge** = number of flagged **buttons in that section** (e.g. Storage sync shows **2** when sync + restart are needed)
- **Button badges** = order to run within section (**1** then **2** on the buttons)
- Storage sync section shows **Restart staging HA** as step 2 when storage never synced
- `onDone` on action buttons calls `refreshAttention({ quick: true })` — skips slow deploy preflight

### Badge flicker fix

- **`App.tsx` `RequireOnboarding`** — no longer sets `complete=null` on every route change (was unmounting whole shell for ~1s)
- **`useNavAttention`** — keeps last stable counts during refresh
- **`NavAttentionContext`** — memoized callbacks

### Performance

- **Operations** — Settings/onboarding load **once on mount**, not on every sidebar section click
- **`useAttentionNavigation`** — only reacts to hash changes, not spurious deps

## Key new / changed web files

| Area | Files |
|------|--------|
| Attention logic | `console/web/src/lib/navAttention.ts` |
| Provider | `console/web/src/context/NavAttentionContext.tsx`, `hooks/useNavAttention.ts` |
| Badge UI | `components/NavAttentionBadge.tsx`, `components/PageAttentionPanel.tsx` (SectionAttentionBadge only) |
| Pages | `App.tsx`, `OperationsPage.tsx`, `DashboardLivePage.tsx`, `DiagnosticsPage.tsx`, `SettingsPage.tsx`, `DashboardEnvironmentPage.tsx` |
| Buttons | `components/ActionButton.tsx` (optional `attentionOrder`) |
| Deploy | `DeployFlowPanel.tsx`, `DeployLovelaceGatePanel.tsx`, `DashboardParityBanner.tsx`, `DashboardSuggestedAction.tsx` |

## Known open items

1. **Badges after running ops** — should drop after `refreshAttention({ quick: true })` once dashboard/sync.log reflects completion; if a badge sticks, check whether sync.log writes `Storage sync complete` (parsed in `DashboardBuilder.ParseSyncActivity`)
2. **LAN disable 404** — still expected diagnostic signal until API/script fix
3. **Stale person-poll lines in diagnostics** — old truncated log lines may linger until log rotates
4. **Kit git commit** — entire session’s kit work (deploy gate, Z2M, badges, sidecar) still uncommitted on `main`
5. **config-repo deploy blockers** — user had unfixed ship wizard work; state not re-verified at end of session

## Verify after resume

```bash
# Kit health + live UI bundle
curl -sI http://127.0.0.1:8081/api/health | head -3
docker exec ha-staging-kit ls /app/wwwroot/assets/index-*.js

# Hard-refresh browser (Ctrl+Shift+R) on kit UI

# Nav attention source data
curl -s http://127.0.0.1:8081/api/dashboard/status | jq '{
  suggestedAction: .suggestedAction.title,
  lastStorageSync: .syncActivity.lastStorageSyncAt,
  lastPoll: .pollHistory[-1],
  mirrorRunning: .mirror.running
}'

# Kit git status
cd /mnt/cache/cursor-workspace/home-assistant/ha-staging-kit
git status -sb
```

## Redeploy if picking up code edits

```bash
# UI only (after web/src changes)
bash /boot/config/scripts/ha-staging-kit-deploy-quick.sh ui

# API only
bash /boot/config/scripts/ha-staging-kit-deploy-quick.sh api

# Sidecar only
bash /boot/config/scripts/ha-staging-kit-deploy-quick.sh sidecar
```

## Suggested next session

1. Hard-refresh kit UI — confirm nav badge **does not flicker** when switching top tabs
2. On **Operations → Storage sync** — sidebar **2**, buttons **1** (sync) and **2** (restart); run sync and confirm badges decrease
3. If badges stick — check sync.log + `lastStorageSyncAt` in dashboard API
4. When ready — **commit ha-staging-kit** changes (large diff; split commits optional)
5. Resume any **config-repo ship wizard / deploy blockers** separately

## Agent transcript

Full chat: `agent-transcripts/cc803cde-e2b1-47b0-afaa-26f795e35492/cc803cde-e2b1-47b0-afaa-26f795e35492.jsonl`
