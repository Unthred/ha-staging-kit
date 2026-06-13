#!/bin/bash
# Shared helpers for deploy scripts — phased logging and health checks.
set -euo pipefail

deploy_log() {
  echo "[$(date '+%H:%M:%S')] $*"
}

deploy_phase() {
  echo ""
  echo "════════════════════════════════════════════════════════"
  deploy_log "$*"
  echo "════════════════════════════════════════════════════════"
}

# Poll until HTTP endpoint returns 2xx. Prints READY as soon as it works.
deploy_wait_http() {
  local url="$1"
  local label="$2"
  local max="${3:-60}"
  local i

  deploy_log "Waiting for ${label} at ${url} (max ${max}s)…"
  for ((i = 1; i <= max; i++)); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo ""
      deploy_log "✓ READY — ${label} is responding. You can use it now."
      deploy_log "  ${url}"
      return 0
    fi
    if (( i == 1 || i % 10 == 0 )); then
      deploy_log "  …still waiting (${i}s)"
    fi
    sleep 1
  done

  deploy_log "✗ TIMEOUT — ${label} did not respond within ${max}s"
  return 1
}

deploy_container_running() {
  docker ps --format '{{.Names}}' | grep -qx "$1"
}
