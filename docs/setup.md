# Setup guide

**Recommended:** start the web onboarding wizard — `bash scripts/deploy-console.sh`, then open `http://<host>:8080/` (or your `CONSOLE_PORT`).

Manual steps below if you prefer the CLI path or need to troubleshoot.

## Workflow (config-repo)

**Prod HA** runs the home (live truth). **Staging HA** is the workbench. Edit YAML in the config git repo → kit applies `staging` branch → test → merge `main` → GitHub Actions deploys to prod (see config-repo `docs/prod-deploy.md`).

For **person / presence sync** (prod read + staging write tokens), see [person-presence-sync.md](person-presence-sync.md).

## Before you start

- [ ] Docker + Docker Compose v2
- [ ] Git clone of your **HA config repo** (staging branch)
- [ ] **Staging HA** running (Docker, VM, or appliance)
- [ ] **Prod HA** on same LAN
- [ ] Long-lived tokens: prod (read), staging (write)
- [ ] SSH key authorized on prod for secrets + `.storage` sync

## 1. Clone and configure

```bash
git clone https://github.com/Unthred/ha-staging-kit.git
cd ha-staging-kit
cp config.example.env .env
```

Edit `.env`:

| Variable | Meaning |
|----------|---------|
| `HA_CONFIG_REPO` | Path to HA config git checkout |
| `HA_STAGING_CONFIG` | Staging HA configuration directory |
| `SIDECAR_DATA` | Sidecar secrets + config.env (persistent) |
| `MIRROR_DATA` | Mirror broker data (if using mirror) |
| `PROD_MQTT_HOST` | Prod Mosquitto IP (mirror only) |

## 2. Secrets

```bash
bash scripts/init-data-dirs.sh
```

Create (mode 600):

| File | Content |
|------|---------|
| `$SIDECAR_DATA/secrets/ha-prod-api.token` | Line 1: prod URL, line 2: token |
| `$SIDECAR_DATA/secrets/ha-staging-api.token` | Line 1: staging URL, line 2: token |
| `$SIDECAR_DATA/secrets/id_ed25519` | SSH private key for prod |

See `sidecar/secrets/*.token.example`.

## 3. Deploy sidecar

```bash
bash scripts/deploy.sh
docker exec ha-staging-sidecar /sidecar/sbin/apply-config.sh
docker exec ha-staging-sidecar /sidecar/sbin/person-poller.sh --once
```

## 4. MQTT mirror (optional)

**Do you need live Zigbee/device states from prod on staging?**

If yes:

1. Complete storage sync first (mirror reads MQTT creds from staging `.storage`):
   ```bash
   docker exec ha-staging-sidecar /sidecar/sbin/sync-storage.sh
   ```
2. Deploy mirror:
   ```bash
   bash scripts/deploy-mirror.sh
   # or: bash scripts/deploy.sh --with-mirror
   ```
3. **Point staging HA at the mirror broker** — see [staging-ha-mqtt.md](staging-ha-mqtt.md) (TODO).

Mirror defaults to **read-only**. Control mode is for hands-on testing only.

## 5. Verify

```bash
docker ps | grep -E 'sidecar|mosquitto'
docker exec ha-staging-sidecar /sidecar/sbin/person-poller.sh --once
bash scripts/mirror-control-mode.sh status   # if mirror enabled
```

## Operations (day two)

```bash
docker exec ha-staging-sidecar /sidecar/sbin/apply-config.sh
bash scripts/mirror-control-mode.sh off    # after any control-mode test
```

## Get help

- [architecture.md](architecture.md)
- [GitHub Issues](https://github.com/Unthred/ha-staging-kit/issues)
