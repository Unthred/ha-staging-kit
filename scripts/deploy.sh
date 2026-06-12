#!/bin/bash
# Deploy ha-staging-kit stack (sidecar + optional mirror).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ -f .env ]] || { echo "Missing .env — cp config.example.env .env and edit paths"; exit 1; }
# shellcheck disable=SC1091
set -a && source .env && set +a

log() { echo "[deploy] $*"; }

bash "$ROOT/scripts/init-data-dirs.sh"

log "Build and start ha-staging-sidecar"
docker rm -f ha-staging-sidecar 2>/dev/null || true
docker compose up -d --build ha-staging-sidecar

sleep 2
if ! docker ps --format '{{.Names}}' | grep -qx ha-staging-sidecar; then
  docker logs ha-staging-sidecar 2>&1 | tail -25
  exit 1
fi

if [[ "${1:-}" == "--with-mirror" ]]; then
  bash "$ROOT/scripts/deploy-mirror.sh"
else
  log "Sidecar running. Mirror: bash scripts/deploy-mirror.sh"
fi

log "Apply: docker exec ha-staging-sidecar /sidecar/sbin/apply-config.sh"
