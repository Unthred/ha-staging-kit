# Unraid example

Yeradonkey-style deployment notes. Generic kit quick start: [README.md](../README.md).

## Paths (example)

| Item | Path |
|------|------|
| Kit clone | `/mnt/cache/cursor-workspace/home-assistant/ha-staging-kit` |
| HA config git | `/mnt/cache/cursor-workspace/home-assistant/config-repo` |
| Staging appdata | `/mnt/user/appdata/Home-Assistant-Container` |
| Sidecar data | `/mnt/user/appdata/ha-staging-sidecar` |

Set these in `.env` before `docker compose up`.

## Legacy transition

Until the web console ships, Unraid may still use `/boot/config/scripts/ha-staging-sidecar-deploy.sh` — it builds the same `sidecar/` Dockerfile. Prefer compose from this repo for new installs.

## MQTT mirror on Unraid

Point staging HA at the mirror with `--add-host=core-mosquitto:<unraid-ip>` and MQTT to `core-mosquitto:1883`. See HomeAssistant config repo `docs/staging-environment.md`.
