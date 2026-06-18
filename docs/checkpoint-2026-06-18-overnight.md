# Checkpoint — 2026-06-18 overnight (deploy gate session)

Resume here after sleep. User heading to bed.

## Live state (as of ~21:24 local)

| Item | State |
|------|--------|
| **ha-staging-kit** | Running; API + UI deployed to container |
| **Live UI bundle** | `index-CrLwneez.js` + `index-DnVWEeEA.css` |
| **Kit git** (`ha-staging-kit/`) | Large **uncommitted** diff on `main` (HEAD `8779671`); session work **deployed but not committed** |
| **Config repo** (`/repo` in container) | Branch `staging`, **ahead 1**; dirty `lovelace.lovelace` + `apply-config.sh` |
| **Lovelace JSON** | **Valid** (repaired earlier this session) |
| **Deploy gate** | **3 blocking** · **38 awaiting** · **3 deferred** · `pendingCommit: false` |
| **Prod registry fixes** | `allowProdRegistryPurge: true` (SSH/registry read OK) |

### Verify kit is up

```bash
curl -sS http://127.0.0.1:8081/api/health
curl -sS http://127.0.0.1:8081/api/operations/prod-storage-preflight | jq '{blocking: (.missingEntityIssues|length), awaiting: (.deployMissingEntityIssues.length), deferred: (.deferredEntityIssues|length), allowProdFix: .allowProdRegistryPurge}'
```

Hard refresh staging kit UI: **Ctrl+Shift+R** → expect bundle `index-CrLwneez.js`.

---

## Blocking list (3)

| Entity | Class | Next action |
|--------|-------|-------------|
| `media_player.squigglebear_tv` | suffix collision | **Fix entity id on prod…** (DLNA blocker + `_2` live) — not run yet |
| `media_player.zaphod_shield_3` | Fix on prod | Manual prod/integration fix |
| `timer.wee_bear_boost_timer` | Fix on prod | **Fix entity id on prod…** — rename `timer.weebear_boost_timer` → `timer.wee_bear_boost_timer` in registry (`unique_id` already `wee_bear_boost_timer`; HA UI cannot rename timers) |

## Deferred (3)

- `cover.office_curtains`
- `sensor.mouse_trap_*_triggered`
- `switch.kitchen_spiral_lights`

## Awaiting publish (38)

Dashboard fixes applied locally — need commit/push/ship when gate is green.

---

## What this session built (deployed, not committed)

### Deploy gate UX

- Defer: stay on **Blocking** tab, advance to next item (`pendingDeferredIds` merge)
- Skip `PruneStale` on defer store when JSON parse fails
- **Bold red** JSON error in toolbar + diagnostics
- Tabbed lists: Blocking | Awaiting | Deferred

### Lovelace remove fixer (`LovelaceEntityFixer.cs`)

- **Fixed:** removing `target.entity_id` no longer eats parent `}` (invalid `"target": {` JSON)
- **Fixed:** whole-card remove no longer drops comma between array elements
- Repaired broken sections in working-tree `lovelace.lovelace` (Front Garden hold_action + 2 missing commas)

### Entity classification (`LovelaceEntityAnalysis.cs`)

- `unique_id` match → **Fix on prod** (not dashboard rename) e.g. `wee_bear` vs `weebear`
- `prodFixAction`: `suffix-collision` | `registry-rename`
- `prodFixSteps` for registry rename cases

### Prod entity id rename (`ProdEntitySuffixFixService.FixWrongEntityIdAsync`)

- New API: `POST /api/operations/fix-prod-entity-id`
- Stops prod HA → edits `core.entity_registry` → renames wrong id → restarts
- Backup: `.bak-kit-entity-rename` on prod
- UI: **Fix entity id on prod…** button (was hidden — `allowProdRegistryPurge` was hardcoded `false`, now true when registry SSH read works)

### Guidance copy

- Timer / unique_id mismatch: no longer says “rename in Settings → Entities” without the kit button
- Points to **Fix entity id on prod** below

---

## Resume checklist

1. Hard refresh staging kit UI.
2. **Timer:** open `timer.wee_bear_boost_timer` → **Fix entity id on prod…** → confirm → **Recheck**.
3. **SquiggleBear TV:** open `media_player.squigglebear_tv` → **Fix entity id on prod…** when ready for prod HA restart.
4. **Zaphod shield:** manual prod fix or defer.
5. Continue awaiting publish path: commit staging lovelace → push → deploy when gate green.
6. Commit `ha-staging-kit` when happy (large diff — user has not requested commit yet).

---

## Key files (this session)

| Area | Path |
|------|------|
| Gate panel | `console/web/src/components/dashboard/DeployLovelaceGatePanel.tsx` |
| Issue detail + prod fix buttons | `console/web/src/components/dashboard/LovelaceIssueDetailBody.tsx` |
| Remove fixer | `console/HaStagingConsole/Services/LovelaceEntityFixer.cs` |
| Classification | `console/HaStagingConsole/Services/LovelaceEntityAnalysis.cs` |
| Prod suffix + registry rename | `console/HaStagingConsole/Services/ProdEntitySuffixFixService.cs` |
| Integration hints | `console/HaStagingConsole/Services/ProdRegistryReader.cs` (IntegrationFixHints) |
| Preflight / allow prod fix | `console/HaStagingConsole/Services/ProdStorageDeployService.cs` |

---

## Related checkpoints

- `docs/checkpoint-2026-06-17-deploy-gate-prod-fixes.md` — earlier same-day session (SquiggleBear, JSON, gate UI)
- `docs/design-entity-deploy-scan.md` — scan / fix / sync design
