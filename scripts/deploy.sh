#!/bin/bash
# Deploy ha-staging-kit (single container: web + sync + optional mirror).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/scripts/deploy-common.sh"

[[ -f .env ]] || { deploy_log "Missing .env — cp config.example.env .env and edit paths"; exit 1; }
# shellcheck disable=SC1091
set -a && source .env && set +a

KIT_CONTAINER="${KIT_CONTAINER:-ha-staging-kit}"
PORT="${CONSOLE_PORT:-8081}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
OPEN_URL="http://127.0.0.1:${PORT}/"

bash "$ROOT/scripts/init-data-dirs.sh"

deploy_phase "1/3 BUILD kit image (one build — web + sync + mirror tools)"
deploy_log "Building ha-staging-kit:local …"
deploy_log "Tip: UI-only changes → bash scripts/deploy-quick.sh ui  (~1–2 min)"
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose build staging-kit
deploy_log "Build finished."

deploy_phase "2/3 SWAP container → ${KIT_CONTAINER}"
docker rm -f "$KIT_CONTAINER" \
  ha-staging-kit-web ha-staging-kit-sync ha-staging-kit-mqtt-mirror \
  ha-staging-console ha-staging-sidecar mosquitto-mirror 2>/dev/null || true

deploy_phase "3/3 START ${KIT_CONTAINER}"
docker compose up -d staging-kit

if [[ "${1:-}" == "--with-mirror" ]]; then
  deploy_log "Configuring MQTT mirror (in-container mosquitto)…"
  bash "$ROOT/scripts/deploy-mirror.sh"
fi

if deploy_wait_http "$HEALTH_URL" "staging kit web UI" 45; then
  echo ""
  deploy_log "Deploy complete at $(date '+%H:%M:%S')"
  deploy_log "Open: ${OPEN_URL}"
  deploy_log "Sync log: docker exec ${KIT_CONTAINER} tail -f /sidecar-data/sync.log"
else
  deploy_log "Last logs:"
  docker logs "$KIT_CONTAINER" 2>&1 | tail -40
  exit 1
fi
