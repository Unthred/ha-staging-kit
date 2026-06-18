#!/bin/bash
# Shared helpers for deploy scripts — phased logging and health checks.
set -euo pipefail

DEPLOY_STOP_TIMEOUT="${DEPLOY_STOP_TIMEOUT:-12}"
DEPLOY_HEALTH_WAIT="${DEPLOY_HEALTH_WAIT:-90}"

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
  local max="${3:-$DEPLOY_HEALTH_WAIT}"
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

# Quick check — avoid restart while Docker daemon is unresponsive.
deploy_docker_reachable() {
  local timeout="${1:-8}"
  if timeout "$timeout" docker info >/dev/null 2>&1; then
    return 0
  fi
  deploy_log "WARN: Docker daemon did not respond within ${timeout}s"
  return 1
}

# Graceful stop + start (more reliable than docker restart on a busy Unraid host).
deploy_restart_container() {
  local name="$1"
  deploy_docker_reachable 10 || deploy_log "Continuing anyway — Docker may be slow"

  deploy_log "Stopping ${name} (SIGTERM, ${DEPLOY_STOP_TIMEOUT}s grace)…"
  if ! docker stop -t "$DEPLOY_STOP_TIMEOUT" "$name" >/dev/null 2>&1; then
    deploy_log "WARN: docker stop did not finish cleanly — forcing start"
  fi

  deploy_log "Starting ${name}…"
  docker start "$name" >/dev/null
}

# UI static files are read from disk — no dotnet restart required.
deploy_verify_ui_marker() {
  local container="$1"
  local dist_index="$2"
  local marker
  marker=$(grep -oE 'index-[^"]+\.(js|css)' "$dist_index" | head -1 || true)
  if [[ -z "$marker" ]]; then
    deploy_log "WARN: Could not read asset marker from ${dist_index}"
    return 0
  fi
  if docker exec "$container" grep -q "$marker" /app/wwwroot/index.html 2>/dev/null; then
    deploy_log "Verified UI bundle ${marker} in container"
    return 0
  fi
  deploy_log "UI marker ${marker} not found in container index.html"
  return 1
}

deploy_sync_entrypoint() {
  local container="$1"
  local entrypoint="$2"
  if [[ ! -f "$entrypoint" ]]; then
    return 0
  fi
  deploy_log "Syncing entrypoint.sh → ${container}:/entrypoint.sh"
  cat "$entrypoint" | docker exec -i "$container" tee /entrypoint.sh >/dev/null
  docker exec "$container" chmod +x /entrypoint.sh >/dev/null 2>&1 || true
}
