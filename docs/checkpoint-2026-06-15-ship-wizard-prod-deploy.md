# Checkpoint — 2026-06-15 (ship wizard + prod deploy session)

Resume here after the Lovelace title / deploy-to-prod debugging session.

## Current live state (updated ~07:42 UTC 15 Jun)

| System | State |
|--------|--------|
| **Prod HA Green** | Lovelace title **Squiggle Home** on disk + after restart |
| **Prod deploy tracker** | `last-prod-deploy.sha` = `cbf75e8` (title-only deploy) |
| **Previous deploy (rollback target)** | `last-prod-deploy-previous.sha` = `c300b61` |
| **GitHub `main` + `staging`** | Both @ `cbf75e8` — `Title page change` |
| **Kit deploy** | Title-only sync on prod deploy when only `.storage/lovelace.lovelace` changed |

## Original checkpoint (00:06 UTC — superseded)

| System | State |
|--------|--------|
| **Prod HA Green** | Git @ `c300b61` — Lovelace **SquiggleBear**, UI **working** (rolled back) |
| **Prod deploy tracker** | `last-prod-deploy.sha` = `c300b61` |
| **Previous deploy (rollback target)** | `last-prod-deploy-previous.sha` = `52c545c` (bad deploy — overwrote `.storage`) |
| **GitHub `main` + `staging`** | Both @ `52c545c` — includes `chore(ha): update Home Assistant config` (Lovelace title **Squiggle Home Test** in git) |
| **Staging HA UI** | Title **Squiggle Home Test** on disk |
| **ha-staging-kit container** | API + UI fixes **deployed live** via `deploy-quick.sh` (not committed to kit git) |

## What we shipped tonight (kit — live in container, uncommitted in kit git)

- **GitHub SSH for deploy** — `GitSshConfigurator`; `RunGitBashAsync` in `OperationsService`
- **Auto UI capture** — `StagingUiCapture`; staging Lovelace edits picked up on dashboard refresh / commit
- **`.storage/` in deploy diff** — `HaConfigPaths` aligned with overview (then **excluded from prod apply** — see below)
- **Parity table UX** — clearer GitHub row, banner labels, diff dialog scroll, **Commit all N files**
- **Deploy unblock** — removed false “apply to staging” gate for prod deploy
- **Prod rollback** — `POST /api/operations/rollback-prod`, wizard **Rollback prod** button, `last-prod-deploy-previous.sha`
- **Prod deploy safety** — prod sparse-checkout now excludes `!/.storage/`; prod deploy only applies YAML (matches `ha-prod-deploy.sh`)

## Incident: prod Lovelace broken after deploy

**Cause:** Deploy did `git reset --hard` including `.storage/lovelace.lovelace` — replaced prod dashboard with full staging dashboard (~386KB). Staging layout ≠ prod → “Error while loading page lovelace”.

**Recovery:** Rolled back prod to `c300b61`; restored 4 `.storage` files from that commit; reloaded HA.

**Lesson:** Lovelace UI edits on staging are for **staging testing in git**, not blind copy to prod. Full `.storage` copy broke prod. **Title-only** changes are now synced on **Deploy to prod** (patches `views[0].title` only, then restarts HA).

## User workflow (intended)

1. Edit on **staging HA** (Lovelace UI) → kit auto-captures to git  
2. **Commit all** → **Push to GitHub**  
3. **Deploy to prod** → merges staging→main if needed; applies YAML; **syncs main dashboard title** if that is the only Lovelace change  

**Do not** run Apply config / Storage sync between UI edit and commit (overwrites staging Lovelace from prod).

## Next session — suggested tasks

1. **Commit ha-staging-kit changes** to kit git (large uncommitted diff in `console/` + docs)
2. **Decide Lovelace-to-prod strategy** — e.g. YAML dashboard for title, manual prod edit, or selective merge (not full `.storage` copy)
3. **Optional:** Re-deploy YAML-only from `main` if desired (won’t touch prod Lovelace now); prod parity table should show main ahead of prod for non-storage paths only
4. **config-repo:** `49b1ce2` docs commit on staging/main; `52c545c` HA commit — prod intentionally behind on purpose after rollback

## Verify after resume

```bash
# Prod Lovelace title
ssh squiggley@192.168.13.2 'grep -m1 title /homeassistant/.storage/lovelace.lovelace'

# Deploy trackers
docker exec ha-staging-kit cat /sidecar-data/last-prod-deploy.sha
docker exec ha-staging-kit cat /sidecar-data/last-prod-deploy-previous.sha

# Kit health
curl -sI http://127.0.0.1:8081/api/health | head -3
```

## Kit deploy command (when continuing code work)

```bash
bash /boot/config/scripts/ha-staging-kit-deploy-quick.sh api   # backend
bash /boot/config/scripts/ha-staging-kit-deploy-quick.sh ui    # frontend
```
