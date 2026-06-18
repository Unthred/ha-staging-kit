# Checkpoint — 2026-06-16 (wardrobe Z2M + kit + diagnostics)

Resume here tomorrow — wardrobe git fix is committed locally; prod not deployed yet. Kit Z2M scan shipped live (uncommitted in kit git). Staging person-poll token broken since ~19:54 UTC after staging HA restart.

## Live state

| System | State |
|--------|--------|
| **Prod HA Green** | Deploy tracker `c300b61` — Z2M still has stale ieee + “Tbree” on prod until deploy + Z2M restart |
| **config-repo `staging`** | Commit `182d030` — wardrobe Z2M + automations fix; **1 commit ahead of origin/staging, not pushed** |
| **config-repo `main`** | Behind staging (wardrobe fix not merged) |
| **ha-staging-kit container** | API + UI deployed live via `deploy-quick.sh`; **large uncommitted diff in kit git** |
| **Staging person poll** | **Broken since 2026-06-16 19:54** — staging API returns `401` for stored token (after apply-config + HA container restart) |
| **Diagnostics UI** | Signals tab scroll fix deployed (`index-CYiOe4BU.js`); hard-refresh if stale |

## Wardrobe work (config-repo)

Committed on `staging` as `182d030`:

- `zigbee2mqtt/configuration.yaml` — removed stale `0x00158d0002ecef7b`; live `0xa4c13884c9cd9879` → **Large Wardrobe Three**
- `automations.yaml` — `tbree_contact` → `three_contact`

**Not done:** push → merge to `main` → kit **Deploy to prod** → restart **Zigbee2MQTT** add-on on prod → Recheck entity scan.

Preflight API (when Lovelace gate runs) should show one `z2mConfigIssues` entry until prod is fixed.

## Kit work (live in container, mostly uncommitted in kit git)

### Shipped today

- Z2M stale-config reader + detection in entity deploy preflight
- `POST /api/operations/fix-z2m-config` (git-side fix)
- `zigbee2mqtt/` in deploy path detection (`HaConfigPaths`, `DashboardBuilder`)
- Deploy gate blocks on prod Z2M stale ieee (informational if fix already on `origin/main`)
- UI: Z2M issues in deploy gate panel; post-deploy Z2M checklist; purge hidden during scan
- Diagnostics: grouped person-poll warnings; Signals tab scroll (whole tab + insight/poll sub-scrolls)

### Key files touched

- `console/HaStagingConsole/Services/ProdZigbee2MqttReader.cs` (new)
- `console/HaStagingConsole/Services/Zigbee2MqttStaleConfigAnalysis.cs` (new)
- `console/HaStagingConsole/Services/Zigbee2MqttConfigFixService.cs` (new)
- `ProdStorageDeployService.cs`, `OperationsService.cs`, `StatusService.cs`, `Program.cs`
- `console/web/src/components/dashboard/DeployLovelaceGatePanel.tsx`, `DeployFlowPanel.tsx`
- `console/web/src/styles.css` (diagnostics scroll)

## Staging token incident

| When | What |
|------|------|
| Until 2026-06-15 22:09 | Person poll OK — `Synced 4 person/tracker states from prod` every ~60s |
| 2026-06-16 19:54 | After sync loop **Apply complete — restart Home-Assistant-Container** → first `failed staging push` |
| Now | Token file unchanged since 2026-06-14; staging HA returns **401** for GET/POST with stored token |

**Fix:** New long-lived token in staging HA → Kit **Settings** → save → test → Person poll.

Not related to wardrobe prod deploy.

## Tomorrow — suggested order

1. **Refresh staging token** in kit Settings (2 min) — clears person-poll spam
2. **Push config-repo `staging`**, merge to **`main`**
3. **Deploy to prod** from kit ship wizard → restart **Zigbee2MQTT** on prod
4. **Recheck** entity deploy scan — wardrobe Z2M issue should clear
5. Optional: commit **ha-staging-kit** changes to kit git
6. Optional: rename `binary_sensor.large_wardrobe_tbree_battery_low` friendly name in prod HA UI

## Verify after resume

```bash
# Kit health
curl -sI http://127.0.0.1:8081/api/health | head -3

# Wardrobe Z2M preflight (when gate active)
curl -s http://127.0.0.1:8081/api/operations/prod-storage-preflight | jq '.z2mConfigIssues'

# Config-repo
cd /mnt/cache/cursor-workspace/home-assistant/config-repo
git log -1 --oneline staging
git status -sb

# Prod deploy tracker
docker exec ha-staging-kit cat /sidecar-data/last-prod-deploy.sha

# Staging token (expect 200 after refresh)
docker exec ha-staging-kit bash -c 'source /sidecar/lib/common.sh && load_config && read_token_file "$STAGING_API_TOKEN_FILE" U T && curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $T" "${STAGING_HA_URL}/api/"'
```

## Kit deploy commands (when continuing code work)

```bash
bash /boot/config/scripts/ha-staging-kit-deploy-quick.sh api
bash /boot/config/scripts/ha-staging-kit-deploy-quick.sh ui
```

## Policy reminders

- Prod changes via **git → Deploy to prod** (kit git bundle), not ad-hoc registry/Z2M edits during investigation
- Do **not** purge prod registry mid-scan — deploy phase only
- Z2M **must be restarted** after `configuration.yaml` deploy
