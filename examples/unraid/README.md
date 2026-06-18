# Unraid example

Yeradonkey-style deployment notes. Generic kit quick start: [README.md](../README.md).

## Unraid cutover (Yeradonkey)

Compose project: `/mnt/user/projects/ha-staging-kit` (symlink → cache workspace)  
Source/git: `/mnt/cache/cursor-workspace/home-assistant/ha-staging-kit`  
Appdata: `/mnt/user/appdata/ha-staging-kit/` (secrets, config.env, sync.log)

```bash
bash /boot/config/scripts/ha-staging-kit-deploy.sh
bash /boot/config/scripts/ha-mosquitto-mirror-deploy.sh
docker exec ha-staging-kit /sidecar/sbin/apply-config.sh
```

Boot: **User Scripts** — `boot-at-array-start` (swap, tunnels, …) then `docker-startup` tier3 (`compose:/mnt/user/projects/ha-staging-kit`).

Legacy `ha-staging-sidecar-deploy.sh` delegates to `ha-staging-kit-deploy.sh`.
