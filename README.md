# ha-staging-kit

OS-agnostic Docker stack for **Home Assistant staging**: sidecar (git apply, person sync, `.storage` sync) + optional **MQTT mirror** (prod → staging state).

Your HA YAML lives in a **separate config git repo**. This repo is infrastructure only.

## Prerequisites

- Docker and Docker Compose on the host
- Git clone of your HA config (staging branch)
- Staging HA instance (Docker, VM, or appliance)
- Prod HA reachable on LAN (REST for person sync; SSH for secrets/`.storage` sync)
- Long-lived API tokens on prod (read) and staging (write)

## Getting started

**Recommended:** use the **web onboarding wizard** at `http://<host>:8080/` after starting the console (see below). Manual steps: [docs/setup.md](docs/setup.md).

Design: [docs/design-onboarding-wizard.md](docs/design-onboarding-wizard.md) · Epic [#1](https://github.com/Unthred/ha-staging-kit/issues/1) / UI [#6](https://github.com/Unthred/ha-staging-kit/issues/6)

```bash
git clone https://github.com/Unthred/ha-staging-kit.git
cd ha-staging-kit
cp config.example.env .env
# Edit .env — see docs/setup.md

bash scripts/init-data-dirs.sh
# Add $SIDECAR_DATA/secrets/*.token and id_ed25519 — see docs/setup.md

bash scripts/deploy-console.sh            # web wizard (recommended first run)
bash scripts/deploy.sh                    # sidecar only
bash scripts/deploy.sh --with-mirror      # sidecar + MQTT mirror

docker exec ha-staging-sidecar /sidecar/sbin/apply-config.sh
docker exec ha-staging-sidecar /sidecar/sbin/person-poller.sh --once
```

## Components

| Service | Role |
|---------|------|
| **ha-staging-console** | Web onboarding wizard + future ops dashboard |
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

- **Onboarding wizard (web UI)** — initial scaffold shipped; polish + dashboard in [#1](https://github.com/Unthred/ha-staging-kit/issues/1) / [#6](https://github.com/Unthred/ha-staging-kit/issues/6)
- **Web console** — [#23](https://github.com/Unthred/HomeAssistant/issues/23) in [HomeAssistant](https://github.com/Unthred/HomeAssistant) config repo
- Published examples: Unraid, standalone Linux, HA OS + Docker staging

## Related

- [Unthred/HomeAssistant](https://github.com/Unthred/HomeAssistant) — example HA config repo using this kit
- [docs/architecture.md](docs/architecture.md)
- [docs/setup.md](docs/setup.md) — manual setup (until wizard ships)
- [docs/staging-ha-mqtt.md](docs/staging-ha-mqtt.md) — point staging HA at the mirror broker
- [docs/person-presence-sync.md](docs/person-presence-sync.md) — why and how person/tracker sync works

## License

MIT — see [LICENSE](LICENSE)
