#!/bin/bash
# Build and start ha-staging-console (web onboarding UI).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ -f .env ]] || { echo "Missing .env — cp config.example.env .env and edit paths"; exit 1; }

echo "[deploy-console] Build and start ha-staging-console"
docker rm -f ha-staging-console 2>/dev/null || true
docker compose up -d --build ha-staging-console

sleep 2
if docker ps --format '{{.Names}}' | grep -qx ha-staging-console; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
  echo "[deploy-console] Open http://127.0.0.1:${CONSOLE_PORT:-8080}/"
else
  docker logs ha-staging-console 2>&1 | tail -30
  exit 1
fi
