# Entity deploy scan

Unified pre-deploy scan for Lovelace (and related) entity references in the **GitHub deploy bundle** vs **live prod HA**.

## Goals

1. **Diagnose** — scan staging vs prod for entity, dashboard, Z2M, and registry mismatches.
2. **Fix** — kit applies safe automated fixes (dashboard draft, prod registry tombstone purge, prod `_2` suffix collisions) with user confirmation where prod is touched.
3. **Synchronise** — storage sync, ship wizard, and deploy keep staging and prod aligned after fixes.
4. **Recheck validates** — re-reads prod; shows resolved/new blockers since last scan.

Deploy to prod applies the **git dashboard bundle** only. Prod entity fixes run as separate confirmed kit actions in the deploy gate, not silently during deploy.

## Workflow

```
Overview / Deploy stage 3
  → Entity deploy scan (auto on refresh)
  → Blockers listed with manual-fix guidance
  → User fixes prod / integration / git (kit can fix git-only)
  → Recheck
  → Green → Deploy to prod (git bundle only)
```

## Issue classes

| Class | Meaning | Kit can fix | User must fix | Blocks deploy |
|-------|---------|-------------|---------------|---------------|
| `git_wrong_name` | Git id wrong; prod has similar correct id | Rename in git | — | Yes, until git fixed + on main |
| `prod_typo` | Git id correct; prod has typo/similar id | — | Prod HA + integration | Yes, until recheck green |
| `missing_on_prod` | In git, not on prod (no similar) | Remove/defer in git | Add device on prod | Yes |
| `staging_only` | On staging, not prod | Remove/defer in git | Optional add on prod | Yes |

## Prod metadata (read-only)

For prod-side issues, enrich from prod `.storage` (SSH read):

- `platform` (mqtt, zha, esphome, …)
- Device name
- `unique_id`
- **Integration hint** — generic by platform; e.g. mqtt + `_zigbee2mqtt` suffix → “likely Zigbee2MQTT” (not hardcoded for all users)
- Deleted registry entries — warn when git expects an id that only exists in `deleted_entities`; kit can **purge tombstones** on prod (user confirm) then user renames live entity

## Prod entity id suffix (`_2`, `_3`, …)

When the dashboard expects `light.foo` but prod has `light.foo_2`, the scan detects when **`light.foo` is already registered** under a different integration (often disabled DLNA vs live SmartThings).

**Kit action (with confirmation):** **Fix entity id on prod** — stops prod HA, removes the stale blocker from `core.entity_registry`, renames the live `_2` entity to the expected id, restarts HA. Backup: `.bak-kit-suffix-fix` on prod. Only when the blocker is disabled or a different platform than the live entity.

**Manual alternative:** Settings → Entities on prod, then Recheck.

## Purge deleted registry tombstones (prod)

When a replaced sensor leaves invisible `deleted_entities` rows in prod `.storage/core.entity_registry`, HA reserves the entity id even though it does not appear in Devices or Entities. Z2M “friendly name already in use” / “Update HA entity id” often fails until tombstones are removed.

Kit action (entity deploy scan detail): **Purge deleted tombstones on prod** — removes matching `deleted_entities` only (same MQTT/Zigbee `unique_id` prefix as the git-expected id), writes `.bak-kit-purge` on prod, restarts prod HA. Does **not** rename the live typo entity.

## Recheck delta

Persist last scan’s blocking entity ids in `/sidecar-data/entity-deploy-scan-last.json`.

On each scan, return:

- `resolvedEntityIds` — were blocking, now OK
- `newEntityIds` — newly blocking
- `previousScanAt`

## Defer policy

**Defer** removes an issue from the blocking list but deploy still logs a warning. Cards may error on prod. Restoring to blocking requires **Restore to blocking**.

## Reset workbench

One-shot from the kit (Deploy → Entity deploy scan → **Reset workbench**, or Operations):

1. `git fetch` + `git reset --hard origin/staging` — discard uncommitted parity edits and unpushed local commits on staging branch
2. Clear defer / undo / recheck sidecar files
3. Stamp git Lovelace mtime so auto UI capture does not overwrite git with prod-synced staging disk
4. `apply-config.sh` (YAML from git + prod `.storage` sync to staging)
5. Restart staging HA

**Does not** change prod. **Does not** remove `staging_only` entity refs from git — those still block deploy until fixed in git or on prod.

## Deploy to prod (what it does)

**Will:**

- Merge/promote staging → main if needed
- Apply **YAML** from `origin/main` on prod (sparse checkout, no blind `.storage` reset)
- Copy **Lovelace quartet** + changed **helper** `.storage` files from git when in the deploy diff
- Restart/reload prod HA

**Will not:**

- Rename entities on prod
- Call integration APIs (Z2M, ZHA, ESPHome, …)
- Overwrite prod `.storage` outside the explicit bundle list

## API

- `GET /api/operations/prod-storage-preflight` — entity deploy scan (alias concept: entity deploy scan)
- `POST /api/operations/lovelace-parity-fix` — git-side fixes only (`rename`, `remove`, `defer`, `undefer`, `undo`)
- `POST /api/operations/reset-workbench` — git + sidecar reset, re-apply staging, prod storage sync

- `POST /api/operations/purge-prod-deleted-entities` — remove blocking `deleted_entities` tombstones on prod (user confirm)

Removed: prod entity rename queue applied on deploy.

## Related

- `docs/checkpoint-2026-06-15-lovelace-bundle-deploy.md` — Lovelace bundle deploy
- `config-repo/docs/staging-environment.md` — staging vs prod entity policy
