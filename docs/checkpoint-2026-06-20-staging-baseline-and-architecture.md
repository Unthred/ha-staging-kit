# Checkpoint — 2026-06-20 (staging baseline + architecture)

Resume here after overnight break. WIP — little has been deployed to prod for real.

---

## North star (agreed)

### Kit does two jobs

1. **Examine & fix** — read prod + staging, find problems, **apply fixes when automatable** (not hand user a prod checklist).
2. **Review & release** — user changes **staging HA**; kit **writes git**, runs scans; user approves; changes reach prod via **git + release agent**.

### Boundaries

| Rule | Detail |
|------|--------|
| **Kit owns git** | User does not edit repo by hand in normal workflow |
| **Prod read-only during review** | Except onboarding/setup; no ad-hoc kit SSH registry fixes long-term |
| **Prod changes via release** | Approved `main` + optional migrations; executed by **release agent outside HA** |
| **Goal** | User never manually operates prod when automatable |
| **Community** | OS/install agnostic; SSH or local config path at setup; **optional** MQTT mirror; **no** Unraid/OPNsense requirement |

### Release agent (not built yet)

- Cross-platform program (Windows Service / systemd / Docker / GitHub runner — same logic).
- Watches approved git SHA → checkout on agent host → migrations → apply YAML + Lovelace `.storage` to prod via SSH/API → reload/restart.
- **Not** an HA add-on; **not** “prod runs git pull” alone.
- Kit diagnoses + commits; agent executes.

### Staging = copy of prod (+ documented exceptions)

See [plan-staging-prod-baseline.md](plan-staging-prod-baseline.md).

---

## Media player / naming context (prod today)

Suffix collisions and cast renames identified on prod:

| Issue | Kind | Target |
|-------|------|--------|
| `squigglebear_tv` / `_2` | Suffix collision | DLNA blocker + SmartThings → `squigglebear_tv` |
| `marvin`, `slartibartfarst` | Suffix `_2` | Remove stale cast; androidtv_remote → base name |
| `marvin_3`, `slartibartfarst_3` | Cast numeric | → `marvin_cast`, `slartibartfarst_cast` |
| `zaphod_shield` + `_cast` | Already correct | Template for others |
| Dashboard `zaphod_shield_3` | Dashboard typo | → `zaphod_shield_cast` (git fix) |

User rule: `_2` = naming mistake; `_3` on Shields → `_cast`.

Kit naming scan found **99** issues on prod (97 suffix_collision, 2 cast_numeric_suffix) — **all** had `prodFixAction` set (automatable one-at-a-time via current WIP UI).

Git refs for SquiggleBear: `scripts.yaml` still uses `squigglebear_tv_2`; dashboard has mixed `_2` and base ids.

---

## Code/docs shipped this session

### New / updated files

| File | Purpose |
|------|---------|
| `console/HaStagingConsole/Services/ProdEntityNamingAnalysis.cs` | Scan prod registry for `_2` / cast `_N` issues |
| `console/HaStagingConsole/Services/ProdStorageDeployService.cs` | Wire naming scan; `ScanProdNamingIssuesAsync`; `AttachProdNamingIssues` |
| `console/HaStagingConsole/Services/OperationsService.cs` | Always run naming scan on preflight |
| `console/HaStagingConsole/Models/DashboardModels.cs` | `ProdEntityNamingIssue`; `RelaxedUniqueId` on fix request |
| `console/HaStagingConsole/Services/ProdEntitySuffixFixService.cs` | `FixWrongEntityIdAsync(..., relaxedUniqueId)` for cast renames |
| `console/web/.../ProdNamingIssueDetailBody.tsx` | Detail + fix buttons for naming issues |
| `console/web/.../DeployLovelaceGatePanel.tsx` | **Naming tab** in deploy gate (not separate 99-item section) |
| `docs/architecture.md` | Principles, WIP vs target table |
| `docs/design-entity-deploy-scan.md` | Naming hygiene section |
| `docs/plan-staging-prod-baseline.md` | **Baseline reset plan** (phases 1–5 + roadmap) |
| `README.md` | Link to architecture principles |

### Deployed to live kit (Unraid)

```bash
bash /boot/config/scripts/ha-staging-kit-deploy-quick.sh ui   # twice
bash /boot/config/scripts/ha-staging-kit-deploy-quick.sh api    # twice (incl. always-on naming scan)
```

Kit path: `/mnt/user/projects/ha-staging-kit` → workspace `ha-staging-kit/`.

### UI change (user feedback)

- Moved prod naming issues from messy standalone list into deploy gate **Naming (N)** tab with list/detail pattern.
- Naming issues **do not block deploy** (advisory).

---

## Current WIP vs target (explicit gap)

| Today | Target |
|-------|--------|
| Kit SSH **Fix entity id on prod** | Migration in git + **release agent** |
| Kit SSH **Deploy to prod** | Release agent applies `main` |
| Kit generates naming list + optional SSH fix | Kit generates **migration manifest + git patches** |
| Staging drifted from prod | **Baseline reset** per plan |

---

## Next steps (morning)

### A. Baseline staging (recommended first)

Follow [plan-staging-prod-baseline.md](plan-staging-prod-baseline.md):

1. `ha-config-backup.sh` if prod YAML ahead of git `main`
2. Align `staging` branch with `main`
3. Kit **Reset workbench**
4. Post-sync: staging LLAT, MQTT patch, OAuth once if needed
5. Verify parity + deploy scan baseline

### B. Prod naming (after baseline)

- Do **not** run 99 kit SSH fixes — conflicts with north star.
- Either: small set manually via future migration, or design migration export first.
- Priority media players: SquiggleBear → Marvin/Slartibartfarst → cast renames.
- Fix dashboard `zaphod_shield_3` in git (kit parity fix).

### C. Architecture build (medium term)

1. `docs/design-release-agent.md` (stub not created yet — optional)
2. Migration manifest format in git
3. Release agent binary/service
4. Deprecate kit direct prod writes

### D. Git commit

Session code/docs **not committed** to ha-staging-kit git unless user asks.

---

## Deploy gate blockers (last known scan)

From `entity-deploy-scan-last.json` (may be stale):

- `media_player.squigglebear_tv`
- `media_player.zaphod_shield_3`
- `timer.wee_bear_boost_timer`

Plus local WIP: many items in awaiting/deferred/publish-pending from parity experiments.

---

## Key doc links

- [architecture.md](architecture.md) — principles
- [plan-staging-prod-baseline.md](plan-staging-prod-baseline.md) — reset plan
- [staging-prod-parity-rules.md](staging-prod-parity-rules.md) — what must differ on staging
- [design-entity-deploy-scan.md](design-entity-deploy-scan.md) — deploy gate
