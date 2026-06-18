# Checkpoint — 2026-06-17 (Deploy gate, lovelace fixes, prod `_2` automation)

Resume here when back home. User left before running **Fix entity id on prod** for SquiggleBear TV.

## Live state (as of ~15:02 local, 17 Jun 2026)

| Item | State |
|------|--------|
| **ha-staging-kit** | Running; API + UI deployed |
| **Live UI bundle** | `index-BiunrD3m.js` + `index-3KIyEatY.css` (verified in container) |
| **Kit git** (`ha-staging-kit/`) | Large **uncommitted** diff on `main` (HEAD `8779671`); **nothing committed from this session** |
| **Deploy gate** | **25 blocking** · **19 awaiting** · **0 deferred** · `pendingCommit: false` |
| **Local lovelace JSON** | **Still broken** — invalid JSON at line **2248** (different line than earlier xmas `target` bug; may have regressed or new break) |
| **Classification** | Text-scan fallback active when JSON parse fails (blocking vs awaiting still usable) |

### Verify kit is up

```bash
curl -sS http://127.0.0.1:8081/api/health
curl -sS http://127.0.0.1:8081/api/operations/prod-storage-preflight | jq '{blocking, awaiting, issues: .issues[0:3]}'
```

Hard refresh staging kit UI: **Ctrl+Shift+R** → expect bundle `index-BiunrD3m.js`.

---

## What this session built (deployed to container, not committed)

### Deploy gate UI (`DeployLovelaceGatePanel.tsx`, styles)

- Stable toolbar + tabbed lists (Blocking | Awaiting | Deferred)
- Optimistic rename/remove; background scan merge keeps fixes visible until server agrees
- After remove/rename: **stay on Blocking tab**, select next blocker
- Toasts for fix feedback; scan diagnostics collapsed below workspace
- Awaiting labels: `Awaiting publish — rename` / `remove` (from fix-action store + undo stack fallback)

### Backend — classification & labels

- `ProdStorageDeployService.cs` — raw-file entity ref fallback when local lovelace JSON invalid
- `LovelaceParityFixActionStore.cs` — persists fix actions for awaiting labels
- `LovelaceEntityAnalysis.cs` — detects `_2` suffix when expected id occupied on prod; `prodFixSteps` + manual summary
- `ProdRegistryReader.cs` — reads `disabled_by` on prod entities

### Lovelace remove fixer (`LovelaceEntityFixer.cs`)

- `entity_id` inside `target` removes property only (not whole card)
- Cleanup pass strips orphaned `"target":}` / empty target objects
- **Note:** `/repo/.storage/lovelace.lovelace` still has JSON errors — may need another repair pass or undo

### Prod automation (new)

- `ProdEntitySuffixFixService.cs` — **Fix entity id on prod** (confirmed action):
  - Stops prod HA → edits `core.entity_registry` → restarts
  - Removes stale blocker (e.g. disabled DLNA) → renames `_2` live entity to expected id
  - Backup on prod: `.bak-kit-suffix-fix`
- API: `POST /api/operations/fix-prod-entity-suffix`
- UI button in deploy gate detail when `prodFixSteps` present (uses same `allowProdRegistryPurge` gate as tombstone purge)

### Docs

- `docs/design-entity-deploy-scan.md` — updated goals (diagnose / fix / sync); suffix collision kit action

### Deploy commands used

```bash
bash /boot/config/scripts/ha-staging-kit-deploy-quick.sh api
bash /boot/config/scripts/ha-staging-kit-deploy-quick.sh ui
```

---

## SquiggleBear TV — ready but not applied

| | Entity |
|--|--------|
| Dashboard expects | `media_player.squigglebear_tv` |
| Prod live (SmartThings) | `media_player.squigglebear_tv_2` |
| Blocker | `media_player.squigglebear_tv` (**dlna_dmr**, **disabled by user**) |

**Proper fix (not run yet):**

1. Deploy gate → `media_player.squigglebear_tv` → **Fix entity id on prod…** → confirm  
   (prod HA restarts briefly)
2. **Recheck** in gate
3. Fix any dashboard refs still using `_2` (lovelace has mixed refs)
4. Publish + deploy from ship wizard

**Do not** use dashboard-only Rename to `_2` if goal is clean ids without suffix.

---

## Known issues / not done

- [ ] **Repair lovelace JSON** at line 2248 in `/repo/.storage/lovelace.lovelace` (working tree only; committed staging may be fine)
- [ ] Run SquiggleBear **Fix entity id on prod** when home and OK with prod HA restart
- [ ] **25 blocking** entity fixes still in progress (19 already fixed locally → awaiting publish)
- [ ] `cover.office_curtains` defer may have been lost when JSON parse failed earlier — re-defer if needed
- [ ] Git commit of `ha-staging-kit` session work when ready (large diff — spans gate UI, prod suffix fix, entity fixer, etc.)
- [ ] Broader vision: more prod fix automations (not only tombstone purge + suffix collision)

---

## Key files (this session’s focus)

| Area | Path |
|------|------|
| Gate panel | `console/web/src/components/dashboard/DeployLovelaceGatePanel.tsx` |
| Issue detail + prod fix button | `console/web/src/components/dashboard/LovelaceIssueDetailBody.tsx` |
| Panel preflight merge | `console/HaStagingConsole/Services/ProdStorageDeployService.cs` |
| Remove fixer | `console/HaStagingConsole/Services/LovelaceEntityFixer.cs` |
| Suffix collision detect | `console/HaStagingConsole/Services/LovelaceEntityAnalysis.cs` |
| Prod suffix fix | `console/HaStagingConsole/Services/ProdEntitySuffixFixService.cs` |
| Tombstone purge (existing) | `console/HaStagingConsole/Services/ProdDeletedRegistryPurgeService.cs` |

---

## Resume checklist

1. Hard refresh staging kit UI.
2. Open entity deploy gate — confirm counts (~25 blocking / ~19 awaiting).
3. Decide: repair lovelace JSON vs reset workbench vs undo stack for broken local draft.
4. SquiggleBear: **Fix entity id on prod** → Recheck.
5. Continue blocking fixes; publish when gate green.
6. Commit `ha-staging-kit` when happy (user has not requested commit yet).

---

## Related checkpoints

- `docs/checkpoint-2026-06-16-blocking-list-layout.md` — list height measurement
- `docs/checkpoint-2026-06-15-lovelace-bundle-deploy.md` — lovelace bundle deploy flow
- `docs/design-entity-deploy-scan.md` — scan / fix / sync design
