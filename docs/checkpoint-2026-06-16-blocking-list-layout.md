# Checkpoint — 2026-06-16 (Deploy gate blocking list layout)

Resume here if picking up the staging kit console UI later.

## Live state (as of ~15:29 local, 16 Jun 2026)

| Item | State |
|------|--------|
| **ha-staging-kit container** | Running; **UI deployed** via `deploy-quick.sh ui` |
| **Live UI bundle** | `index-WqLguaKw.js` + `index-CeTEjQ6r.css` (verified in container) |
| **Kit git** | Large uncommitted diff on `main` (~47 tracked + many untracked); **nothing committed from this session** |
| **User last report** | Blocking deploy list still looked too tall / no scrollbar **before** final fix; fix deployed but user left before confirming hard refresh |

### Verify after hard refresh (Ctrl+Shift+R)

1. Open staging kit Overview → entity deploy gate with multiple blockers.
2. **Expected:** “Blocking deploy” left column height ≈ tallest detail pane among all blocking issues; `<ul>` scrolls when list is longer.
3. **Expected:** Right detail pane shrink-wraps selected issue (no forced min-height, no detail scrollbar).
4. If still wrong: check viewport ≤900px (stacked layout uses fixed `min(40vh, 360px)` cap instead of measured height).

---

## What this session changed (blocking list vs detail pane)

### Problem (user intent)

- Blocking deploy list was growing to show **all** blockers — far taller than the detail pane.
- User wants list height = **max detail height across all blocking issues**, with scrollbar on the list only.
- Detail pane should match its content (no empty space at bottom, no scrollbar on detail if avoidable).

### Files touched (this UI sub-task)

| File | Change |
|------|--------|
| `console/web/src/components/dashboard/DeployLovelaceGatePanel.tsx` | Max-height measurement across all blocking issue details; inline cap on list wrap; off-screen sizer |
| `console/web/src/components/dashboard/LovelaceIssueDetailBody.tsx` | **New** — shared detail body for visible + measure renders |
| `console/web/src/styles.css` | `.deploy-lovelace-gate-list-wrap--capped`, fixed off-screen `.deploy-lovelace-gate-detail-sizer`, detail column layout |

### How it works (final approach)

1. **Detail column width** measured via `ResizeObserver` on `.deploy-lovelace-gate-detail-column`.
2. **Off-screen sizer** (`position: fixed; left: -10000px`) renders every blocking issue’s detail at that width — does **not** affect page layout (earlier bug: sizer inside grid column stacked all panels and broke measurement with `max-height: 0`).
3. **Max height** = max of all `.deploy-lovelace-gate-detail-measure` panels + currently visible detail ref.
4. **Cap applied** via inline `height` / `maxHeight` on blocking `.deploy-lovelace-gate-list-wrap` + class `--capped` so inner `<ul>` gets `overflow-y: auto`.

### Deploy command used

```bash
bash /mnt/cache/cursor-workspace/home-assistant/ha-staging-kit/scripts/deploy-quick.sh ui
```

No container restart required (static wwwroot copy).

---

## Not done / next steps

- [ ] User confirmation after hard refresh that list scroll + height match tallest detail.
- [ ] If confirm box open on selected issue (purge flow), visible detail grows — may need to include confirm state in max-height calc or accept transient taller detail.
- [ ] Git commit of kit work when ready (large diff spans entity deploy scan, deploy flow, diagnostics, etc. — not just this UI fix).
- [ ] Broader deploy gate still blocked until entity issues resolved + published (see `checkpoint-2026-06-15-lovelace-bundle-deploy.md`).

---

## Related checkpoints

- `docs/checkpoint-2026-06-15-lovelace-bundle-deploy.md` — Lovelace bundle deploy, parity gate API, DeployLovelaceGatePanel v1
- `docs/design-entity-deploy-scan.md` — entity scan design
