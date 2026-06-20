# Checkpoint — 2026-06-19 (evening)

Resume here after baseline reset + release-agent planning. WIP — little deployed to prod yet.

---

## North star (agreed)

| Rule | Detail |
|------|--------|
| **Kit job 1** | Examine prod + staging, find problems, **apply fixes when automatable** (not “go click on prod”) |
| **Kit job 2** | User changes **staging HA**; kit **reviews** and promotes **`staging` → `main` → prod via git** |
| **Kit owns git** | User does not hand-edit the repo in normal workflow |
| **Prod during review** | **Read-only** to kit (except onboarding) |
| **Prod apply** | **Release agent** outside HA (Windows service / systemd / Docker / GH runner — same binary) executes approved `main` + migrations — **not built yet** |
| **MQTT mirror** | Optional — live device state on staging; not required for community |
| **OS** | Agnostic — API + SSH/local path; no Unraid/OPNsense requirement |

Docs: [architecture.md](architecture.md), [plan-staging-prod-baseline.md](plan-staging-prod-baseline.md).

---

## What we built this session

### Prod entity naming scan (kit)

- **`ProdEntityNamingAnalysis.cs`** — detects `_2` suffix collisions + cast `_3` → should be `_cast`
- Runs on every preflight; **99 issues** on prod today (**97** suffix, **2** cast); all have `prodFixAction` set
- **Media players (5):** `squigglebear_tv`, `marvin`, `marvin_3`, `slartibartfarst`, `slartibartfarst_3`
- **UI:** **Naming** tab in entity deploy gate (list + detail) — not a separate 99-item wall
- **Deployed:** `ha-staging-kit-deploy-quick.sh ui` + `api` (kit container live)

### Architecture / plan docs

- Updated [architecture.md](architecture.md) — principles, WIP vs target table
- New [plan-staging-prod-baseline.md](plan-staging-prod-baseline.md) — reset staging to prod copy + phased roadmap

### Still WIP / wrong shape vs north star

- **Fix entity id on prod** / purge tombstones — kit SSH writes prod (shortcut; should become **migration in git + release agent**)
- **Deploy to prod** — kit SSH bundle (should become release agent)
- **No migration export** or batch apply yet
- **Baseline reset not run** — staging may still drift from prod + git WIP (defer/undo/parity edits)

---

## Prod naming snapshot (media_player)

| Issue | Kind | Target |
|-------|------|--------|
| `squigglebear_tv` | suffix `_2` | Remove DLNA blocker → rename SmartThings to base |
| `marvin` / `slartibartfarst` | suffix `_2` | Remove stale cast → rename androidtv_remote to base |
| `marvin_3` / `slartibartfarst_3` | cast | → `marvin_cast` / `slartibartfarst_cast` |
| `zaphod_shield` + `_cast` | — | **Already correct** on prod |

**Git refs:** `scripts.yaml` still uses `squigglebear_tv_2`; Lovelace mixed `_2` and base name.

---

## Deploy gate blockers (last scan)

From `entity-deploy-scan-last.json`:

1. `media_player.squigglebear_tv` — dashboard expects base; prod live is `_2`; DLNA blocker
2. `media_player.zaphod_shield_3` — **dashboard typo** → should be `zaphod_shield_cast` (git/staging fix)
3. `timer.wee_bear_boost_timer` — separate timer-platform issue

Plus many **local draft** fixes awaiting publish (ship wizard).

---

## Next steps (morning)

### A. Baseline reset (recommended first)

Follow [plan-staging-prod-baseline.md](plan-staging-prod-baseline.md):

1. `ha-config-backup.sh` if prod YAML ahead of git `main`
2. Align **`staging` = `main`** (WIP — OK to discard branch experiments)
3. Kit → **Reset workbench**
4. Post-sync: staging LLAT, MQTT patch, OAuth once if needed
5. Recheck deploy gate — clean parity baseline

### B. Clear deploy blockers (after baseline)

1. **SquiggleBear** — migration manifest (future) or one-off fix; update `scripts.yaml` + Lovelace to one id
2. **zaphod_shield_3** → `zaphod_shield_cast` in Lovelace (kit git fix)
3. **Timer** — registry rename migration or kit fix path

### C. Architecture (medium term)

1. Design **`docs/design-release-agent.md`** — triggers, apply order, idempotency
2. Migration manifest format in config-repo
3. Kit: **Export migration** instead of/in addition to “Fix prod”
4. Deprecate kit SSH prod registry fixes when agent exists

---

## Key paths

| Item | Path |
|------|------|
| Kit repo | `/mnt/user/projects/ha-staging-kit` → workspace `ha-staging-kit/` |
| Config repo | `config-repo/` (`staging` / `main`) |
| Kit secrets | `/mnt/user/appdata/ha-staging-kit/secrets/` |
| Staging HA appdata | `/mnt/user/appdata/Home-Assistant-Container` |
| Prod HA | `squiggley@192.168.13.2:/homeassistant` |
| Quick deploy | `bash /boot/config/scripts/ha-staging-kit-deploy-quick.sh {ui\|api\|sidecar}` |

---

## Do not forget

- User goal: **automate prod changes** via checked-in artifacts + **release agent**, not manual prod UI or kit SSH during review
- **99 naming issues** are advisory (Naming tab) — do not block deploy; prod registry cleanup is backlog
- **Mosquitto mirror** = optional staging realism, keep documenting as recommended not required
