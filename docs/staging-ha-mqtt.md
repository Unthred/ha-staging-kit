# Staging HA → MQTT mirror

After the mirror is deployed, staging Home Assistant must use the **kit mirror broker** — not production Mosquitto directly.

**Not Settings → Apps.** Apps are HA OS only. On Docker staging, use **Settings → Devices & services → MQTT**.

## Mirror endpoint

| Item | Typical value |
|------|----------------|
| Host | Kit Docker host — LAN IP or a DNS name that resolves **directly** to that host (not HAProxy). Example: `192.168.13.1` or a host-level FQDN on port `1883`. HA URLs like `https://ha-staging-kit.yeradonkey.com` go through HAProxy and do **not** expose MQTT. |
| Port | `1883` (or `MIRROR_PORT` in `.env`) |
| Username / password | Same as prod Mosquitto (`homeassistant` user from synced `.storage` / secrets) |

## Configure in staging HA (Docker — e.g. Unraid)

1. Open staging HA UI.
2. **Settings → Devices & services** → **Integrations**.
3. Click **MQTT**.
4. On **Mosquitto MQTT Broker**, open **⋮** → **Configure** (reconfigure).
5. Change **Broker** from `core-mosquitto` (prod) to the **kit host** (e.g. `192.168.13.1` or `KIT_MQTT_BROKER` from kit Settings). Port `1883`.
6. Keep prod username/password. Save; reload MQTT if needed.

After storage sync from prod, the integration often still points at `core-mosquitto` — that name means prod on HA OS. On Docker staging, point it at the mirror IP explicitly.

## After storage sync (automatic patch)

When the mirror is enabled, set **`STAGING_MQTT_BROKER`** in kit/sidecar config (onboarding mirror step or Settings). Every **storage sync** then runs `patch-staging-storage.sh`, which jq-patches `core.config_entries` so MQTT entries use the mirror host/port instead of prod's `core-mosquitto`.

You should not need to reconfigure MQTT in the HA UI after every sync. Restart staging HA if entities stay unavailable after sync.

Set `SKIP_MQTT_PATCH=1` to disable the patch (not recommended when using the mirror).

### Optional: keep hostname `core-mosquitto`

Add to the staging HA container extra parameter:

```
--add-host=core-mosquitto:<kit-host-lan-ip>
```

Then `core-mosquitto:1883` resolves to the mirror without editing the integration. Using the LAN IP in the integration is usually clearer.

## HA OS / physical staging

Same path: **Settings → Devices & services → MQTT** → configure broker to mirror host IP and port.

## Verify

From the kit host:

```bash
docker run --rm --network host eclipse-mosquitto:2 \
  mosquitto_sub -h 127.0.0.1 -p 1883 -u homeassistant -P '<password>' \
  -t 'zigbee2mqtt/bridge/state' -C 1 -W 10
```

Staging HA should show live Zigbee entities after reload.

## Control mode

Default is read-only. Enable only for automation testing:

```bash
bash scripts/mirror-control-mode.sh on
# test…
bash scripts/mirror-control-mode.sh off
```
