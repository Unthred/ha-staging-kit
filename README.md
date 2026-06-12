# ha-staging-kit

OS-agnostic Docker stack for **Home Assistant staging**: sidecar (git apply, person sync, `.storage` sync) + optional **MQTT mirror** (prod → staging state).

Your HA YAML lives in a **separate config git repo**. This repo is infrastructure only.

## Prerequisites

- Docker and Docker Compose on the host
- Git clone of your HA config (staging branch)
- Staging HA instance (Docker, VM, or appliance)
- Prod HA reachable on LAN (REST for person sync; SSH for secrets/`.storage` sync)
- Long-lived API tokens on prod (read) and staging (write)

## Quick start

```bash
git clone https://github.com/Unthred/ha-staging-kit.git
cd ha-staging-kit
cp config.example.env .env
# Edit .env — set HA_CONFIG_REPO, HA_STAGING_CONFIG, prod/staging URLs

bash scripts/init-data-dirs.sh
# Add secrets/data/sidecar/secrets/ha-prod-api.token and ha-staging-api.token
# Add secrets/data/sidecar/secrets/id_ed25519 for SSH to prod

docker compose up -d --build
docker exec ha-staging-sidecar /sidecar/sbin/apply-config.sh
docker exec ha-staging-sidecar /sidecar/sbin/person-poller.sh --once
```

## Components

| Service | Role |
|---------|------|
| **ha-staging-sidecar** | Apply git config, runtime overlay, person poll, scheduled `.storage` sync |
| **mosquitto-mirror** | One-way MQTT state prod → staging (optional control mode for Z2M tests) |

## Operations

```bash
docker exec ha-staging-sidecar /sidecar/sbin/apply-config.sh
docker exec ha-staging-sidecar /sidecar/sbin/person-poller.sh --once
docker exec ha-staging-sidecar /sidecar/sbin/sync-storage.sh
bash scripts/mirror-control-mode.sh status   # read-only | control
bash scripts/mirror-control-mode.sh off      # always return to read-only after tests
```

## Config

| Path | Purpose |
|------|---------|
| `.env` | Host paths and URLs (from `config.example.env`) |
| `data/sidecar/config.env` | Sidecar runtime (from `sidecar/config.env.example`) |
| `data/sidecar/secrets/` | API tokens + SSH key (gitignored) |

## Roadmap

- Web console (#23 in [HomeAssistant](https://github.com/Unthred/HomeAssistant) config repo)
- Mirror deploy/init in compose (v0.1 uses manual mirror config setup)
- Published examples: Unraid, standalone Linux, HA OS + Docker staging

## Related

- [Unthred/HomeAssistant](https://github.com/Unthred/HomeAssistant) — example HA config repo using this kit
- [docs/architecture.md](docs/architecture.md)

## License

MIT — see [LICENSE](LICENSE)
