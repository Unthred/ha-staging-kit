# Checkpoint — 2026-06-21 (console UI polish)

Resume here for staging-kit console UI work. **UI pass is done for now** — live on Unraid `:8081` via quick deploy; committed to `main`.

---

## Shipped this session

### Overview / Compare instances

- **`ResizableSplitPane.tsx`** + **`splitPanePreferences.ts`** — shared split pane (8–92% ratio, persisted per pane id).
- **Overview parity board** — split pane no longer squeezed by parent grid; wider travel; detail footer pinned.
- **Review / show-all links in footer** — `+ N more — show all`, **Review dashboard diff**, **Review diffs**, push preview, main-prod pending, etc. moved from scroll body → `dash-detail-actions` above **All operations** / **More operations**.
- **Entity parity dialog** — `EntityParityListDialog` uses same shell as git diff dialog (`dash-git-files-dialog` panel, head, backdrop, Close).

### HA logs (Diagnostics)

- Unified inset master-detail (`ui-split-pane--inset`); list + detail in one column flow (no separate cards).

### Entity Janitor (Deploy gate)

- Split pane layout fix (removed conflicting grid on parent).
- Prod entity scan list styling aligned with HA logs integration issues.
- **Blocking / Awaiting / Deferred / Naming** tabs moved to panel header (under eyebrow), not inside resizable list.
- Opaque row backgrounds (`--ui-row-bg`) — fixes brown tint over panel gradient.

### Environment

- Control mode back as 4th stat tile (`dash-stat-card` + `inline` on `MirrorControlModeToggle`).

### Appearance

- Removed green **Saved** toast/state — only **Saving…** and errors show.

### Global

- Thin muted scrollbars app-wide (`--ui-scrollbar-*` on `:root`).

### API (small fix)

- **`OperationsService.cs`** — preflight scan reports 19 steps from `BeginScan(19)` (was 3 then `SetTotalSteps(19)` mid-scan); **`usePreflightScanProgress.ts`** aligned.

---

## Deployed (Unraid)

```bash
bash /boot/config/scripts/ha-staging-kit-deploy-quick.sh ui
# (multiple times during session — last bundle: index-5tElpIog.js)
```

API rebuild **not** required for UI-only work unless you change `OperationsService.cs` on live container:

```bash
bash /boot/config/scripts/ha-staging-kit-deploy-quick.sh api
```

---

## Key files

| Area | Files |
|------|-------|
| Split pane | `console/web/src/components/ResizableSplitPane.tsx`, `lib/splitPanePreferences.ts` |
| Overview | `components/dashboard/DashboardInstanceMonitoring.tsx` |
| Entity parity dialog | `components/dashboard/EntityParityListDialog.tsx` |
| HA logs | `components/diagnostics/HaDiagnosticsPanel.tsx` |
| Entity Janitor | `components/dashboard/DeployLovelaceGatePanel.tsx` |
| Environment | `components/dashboard/DashboardEnvironmentKitPanel.tsx`, `MirrorControlModeToggle.tsx` |
| Appearance | `components/settings/AppearanceSettingsPanel.tsx` |
| Styles | `console/web/src/styles.css` |
| Preflight progress | `OperationsService.cs`, `hooks/usePreflightScanProgress.ts` |

---

## Verify after pull

1. Overview → **Sensors** — footer shows **+ N more — show all** without scrolling list.
2. Overview → **Dashboard** — **Review dashboard diff** in footer above **All operations**.
3. Overview → resize split pane — persists on refresh.
4. Diagnostics → HA logs — unified list/detail inset.
5. Entity Janitor — tabs under header; list row colors sane on unselected rows.
6. Open entity parity **show all** — dialog matches git diff look.

---

## Not done / optional follow-ups

- Confirm selected vs unselected row highlight in Entity Janitor matches HA logs exactly (opaque rows fixed brown; blue selected state may still differ).
- Border-only selection (no fill difference) if user wants identical unselected/selected fill.
- Promote `OperationsService` preflight fix to live API container if not yet deployed.
- Broader `#14` release agent / `#12` pilots — unchanged; see [RESUME.md](../RESUME.md).

---

## Git

Committed on **`main`** @ `8c2eb1b` (pushed to GitHub).
