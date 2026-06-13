# ha-staging-kit

OS-agnostic Docker stack for **Home Assistant staging**: web UI, config sync, and optional MQTT mirror — **one container**.

Your HA YAML lives in a **separate config git repo**. This repo is infrastructure only — it applies git to **staging** (workbench); **prod HA** is live truth for the running home.

## Prerequisites

- Docker and Docker Compose on the host
- Git clone of your HA config (staging branch)
- Staging HA instance (Docker, VM, or appliance)
- Prod HA reachable on LAN (REST for person sync; SSH for secrets/`.storage` sync)
- Long-lived API tokens on prod (read) and staging (write)

## Getting started

**Recommended:** use the **web onboarding wizard** at `http://<host>:8081/` after deploy. Manual steps: [docs/setup.md](docs/setup.md).

```bash
git clone https://github.com/Unthred/ha-staging-kit.git
cd ha-staging-kit
cp config.example.env .env
# Edit .env — see docs/setup.md

bash scripts/init-data-dirs.sh
# Add $SIDECAR_DATA/secrets/*.token and id_ed25519 — see docs/setup.md

bash scripts/deploy.sh                 # one image: web + sync
bash scripts/deploy.sh --with-mirror   # + MQTT mirror config

# Faster redeploys after the first full build:
bash scripts/deploy-quick.sh ui        # React/UI only (~1–2 min)
bash scripts/deploy-quick.sh api       # C# API only (~2–3 min)
bash scripts/deploy-quick.sh full      # same as deploy.sh (~5–8 min)

docker exec ha-staging-kit /sidecar/sbin/apply-config.sh
docker exec ha-staging-kit tail -f /sidecar-data/sync.log
```

## Single container

| Container | Ports | Runs |
|-----------|-------|------|
| **`ha-staging-kit`** | `8081` (web), `1883` (MQTT mirror) | Web UI · config sync loop · optional mosquitto |

One `docker compose build` — no separate web/sync images.

## Operations

Use the **web UI** (`http://<host>:8081/` by default) or exec into the kit container:

```bash
docker exec ha-staging-kit /sidecar/sbin/apply-config.sh
docker exec ha-staging-kit /sidecar/sbin/person-poller.sh --once
docker exec ha-staging-kit /sidecar/sbin/sync-storage.sh
bash scripts/mirror-control-mode.sh status
```

Console pages: **Dashboard** · **Operations** · **Settings** · **Setup wizard**

## Config

| Path | Purpose |
|------|---------|
| `.env` | Host paths and URLs (from `config.example.env`) |
| `data/sidecar/config.env` | Sync runtime (from `sidecar/config.env.example`) |
| `data/sidecar/secrets/` | API tokens + SSH key (gitignored) |

## License

MIT — see [LICENSE](LICENSE)
