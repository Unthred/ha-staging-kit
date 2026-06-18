# Checkpoint — 2026-06-15 (Lovelace bundle deploy + parity gate UI)

Resume here if picking up the staging kit / prod deploy work later (e.g. at home tonight).

## Live state (as of ~14:30 UTC 15 Jun 2026)

| System | State |
|--------|--------|
| **Prod HA Green** | Lovelace **SquiggleBear** (rolled back — working). Last kit deploy SHA **`c300b61`**. |
| **Previous deploy (rollback)** | **`cbf75e8`** |
| **GitHub `main` / `staging`** | **`505ff53`** — Lovelace title change in git (`SquiggleBear` → `Squiggle Home A`), not on prod |
| **ha-staging-kit container** | **Deployed live** via `deploy-quick.sh` (API + UI). **Large diff uncommitted** in kit git (~45 files). |
| **Lovelace prod deploy** | **Blocked** — parity gate finds **45** missing entity refs on prod (preflight API). |

### Prod deploy — do not rollback again

Prod is fine at `c300b61`. Rollback would move toward `cbf75e8`. Use **Deploy to prod** only after parity gate passes.

---

## What we built this session

### 1. Lovelace bundle deploy (replaces title-only hack)

**Deploy to prod** now:

| Layer | Behaviour |
|-------|-----------|
| **YAML** | Git bundle → prod (sparse checkout, no `.storage`) |
| **Lovelace** | Copies **quartet** via SSH `tee`: `lovelace.lovelace`, `lovelace.map`, `lovelace_dashboards`, `lovelace_resources` |
| **Helpers** | Copies changed helper `.storage` files only (`input_*`, `timer`, `scheduler.storage`, etc.) |
| **Never** | `git reset --hard` on prod `.storage` |

Key files:

- `console/HaStagingConsole/Services/ProdStorageDeployService.cs`
- `console/HaStagingConsole/Services/LovelaceEntityAnalysis.cs`
- `console/HaStagingConsole/Services/OperationsService.cs` — `DeployToProdInternalAsync`

### 2. Parity gate (before Lovelace bundle)

- Parses all entity refs in Lovelace git snapshot
- Checks each exists on **prod** (live `/api/states`)
- Checks Lovelace **resource URLs** in git exist on prod
- **Blocks deploy** if gate fails (no “ignore” — broken cards on prod)

API: `GET /api/operations/prod-storage-preflight`

### 3. Overview UI — ship wizard + gate panel

- **DeployFlowPanel** — shows Lovelace bundle pending; disables Deploy while gate fails
- **DeployLovelaceGatePanel** — selectable entity list with:
  - **Where used** (view → card, source file)
  - **Suggestion kind**: `rename` | `remove` | `add_on_prod`
  - **Suggested prod entity** when similar name found on prod
- Removed duplicate warning banner (kept “Suggested fix” card only)
- Grouped sync-log noise (person poll failures, LAN disable warnings)

### 4. Diagnostics / overview polish (earlier in session)

- WARN lines no longer classified as errors when prefixed `WARN:`
- Stale recovered person-poll failures filtered after successful sync
- Overview suggested-action card wired up

---

## Your pending prod change

Git `main` vs prod deploy (`c300b61`): **only** `.storage/lovelace.lovelace` (title line).

**Important:** Even a “title-only” git diff deploys the **full Lovelace bundle** after gate passes — the whole dashboard file in git is what prod receives for the quartet.

Preflight sample (45 missing — run API for full list):

- **rename** (likely wrong id on prod): e.g. `binary_sensor.large_wardrobe_three_contact`, `input_boolean.override_livingroom_curtain`
- **remove** (staging-only / stale): e.g. `light.kitchen_spiral_lights`
- **add_on_prod**: vacuum/map entities, etc.

**Tonight’s workflow:**

1. Hard-refresh kit UI → Overview → Lovelace parity panel
2. Click each entity → fix on **staging HA** at listed view/card (or add device on prod + storage sync)
3. Commit/capture → push if needed → **Re-check parity**
4. When gate green → **Deploy to prod** (title + full dashboard layout from git)

---

## Verify after resume

```bash
# Kit health
curl -sI http://127.0.0.1:8081/api/health | head -3

# Deploy trackers
docker exec ha-staging-kit cat /sidecar-data/last-prod-deploy.sha
docker exec ha-staging-kit cat /sidecar-data/last-prod-deploy-previous.sha

# Lovelace parity (full issue list with references)
curl -s http://127.0.0.1:8081/api/operations/prod-storage-preflight | jq .

# Prod title on disk
ssh squiggley@192.168.13.2 'grep -m1 "\"title\"" /homeassistant/.storage/lovelace.lovelace'

# Git vs prod
cd /mnt/cache/cursor-workspace/home-assistant/config-repo
git log -1 --oneline origin/main
git diff c300b61..origin/main -- .storage/lovelace.lovelace | head -20
```

---

## Deploy kit code after edits

```bash
bash /boot/config/scripts/ha-staging-kit-deploy-quick.sh api
bash /boot/config/scripts/ha-staging-kit-deploy-quick.sh ui
```

---

## Not done yet / follow-ups

- [ ] **Commit ha-staging-kit** changes to kit git (large uncommitted console + sidecar diff)
- [ ] **Clear parity gate** — work through 45 missing entities in UI, then deploy title/bundle to prod
- [ ] **Optional:** Entity registry API instead of `/api/states` (fewer false “missing” for disabled entities)
- [ ] **Optional:** Title-only deploy path when git diff is literally one line (avoid scanning whole dashboard for unrelated stale refs)
- [ ] **Deferred plan:** full staging↔prod parity layers, camera INV-05 spike — see `.cursor/plans/Lovelace copy parity-f782b271.plan.md`

---

## Policy (agreed direction)

**Staging is the workbench** — edit Lovelace, helpers, automations on staging → git → deploy to prod.

- Lovelace: gated **bundle** deploy (not merge, not blind copy via git reset)
- Helpers: changed `.storage` files ship with deploy
- Entity registry: prod is source of truth — add devices on prod, storage-sync staging, then edit UI

---

## Related docs

- `docs/checkpoint-2026-06-15-ship-wizard-prod-deploy.md` — earlier session (title-only era; superseded for Lovelace)
- `config-repo/docs/staging-parity-investigation.md` — parity backlog (INV-*)
- Plan: `/root/.cursor/plans/Lovelace copy parity-f782b271.plan.md`
