# Unraid example

Yeradonkey-style deployment notes. Generic kit quick start: [README.md](../README.md).

## Unraid cutover (Yeradonkey)

Kit path: `/mnt/cache/cursor-workspace/home-assistant/ha-staging-kit`  
`.env` points at existing appdata (secrets preserved).

```bash
bash /boot/config/scripts/ha-staging-sidecar-deploy.sh
bash /boot/config/scripts/ha-mosquitto-mirror-deploy.sh
docker exec ha-staging-sidecar /sidecar/sbin/apply-config.sh
```

Wrappers in `/boot/config/scripts/` delegate to the kit repo. Do not edit `config-repo/scripts/unraid/ha-staging-sidecar/` — see `DEPRECATED.md` there.
