# Staging HA → MQTT mirror

After `deploy-mirror.sh`, staging Home Assistant must use the **mirror broker** as its MQTT server — not prod directly.

## Mirror endpoint

| Item | Typical value |
|------|----------------|
| Host | IP of machine running `mosquitto-mirror` |
| Port | `1883` (or `MIRROR_PORT` in `.env`) |
| Username / password | Same as prod Mosquitto (`homeassistant` user from synced `.storage`) |

## Docker staging (e.g. Unraid)

Add to staging HA container extra parameter:

```
--add-host=core-mosquitto:<mirror-host-ip>
```

In staging HA, MQTT integration broker: `core-mosquitto:1883`.

## HA OS / physical staging

Use the mirror host LAN IP and port in the MQTT integration (Settings → Devices & services → MQTT).

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

*(Onboarding wizard will generate these steps from your topology answers — issue tracked on kit board.)*
