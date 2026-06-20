#!/bin/bash
# Fast deploy paths — skip full docker compose build when only UI or API changed.
#
#   ./scripts/deploy-quick.sh ui     # ~1–2 min — rebuild React, copy into running container
#   ./scripts/deploy-quick.sh api    # ~2–3 min — rebuild .NET, copy into running container
#   ./scripts/deploy-quick.sh sidecar # ~10s — copy sidecar scripts into running container (no image rebuild)
#
# Requires an existing ha-staging-kit container from at least one full deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/deploy-common.sh"

MODE="${1:-ui}"
KIT_CONTAINER="${KIT_CONTAINER:-ha-staging-kit}"
PORT="${CONSOLE_PORT:-8081}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
WEB="$ROOT/console/web"
CONSOLE="$ROOT/console/HaStagingConsole"
CACHE_DIR="$ROOT/.deploy-cache"
NPM_CACHE_VOLUME="${NPM_CACHE_VOLUME:-ha-staging-kit-npm-cache}"
NUGET_CACHE_VOLUME="${NUGET_CACHE_VOLUME:-ha-staging-kit-nuget-cache}"

copy_to_container() {
  local src="$1"
  local dest="$2"
  deploy_log "Copying $(basename "$src") → ${KIT_CONTAINER}:${dest}/"
  docker exec "$KIT_CONTAINER" mkdir -p "$dest"
  tar -C "$src" -cf - . | docker exec -i "$KIT_CONTAINER" tar -xf - -C "$dest"
}

require_container() {
  if ! deploy_container_running "$KIT_CONTAINER"; then
    deploy_log "Container ${KIT_CONTAINER} is not running."
    deploy_log "Run a full deploy first: bash scripts/deploy.sh"
    exit 1
  fi
}

build_web() {
  if [[ -x "$WEB/node_modules/.bin/tsc" ]]; then
    deploy_log "Building web UI on host (npm run build)…"
    (cd "$WEB" && npm run build)
    return
  fi

  deploy_log "Building web UI in node:20-alpine (cached node_modules volume)…"
  docker run --rm \
    -v "$WEB:/web" \
    -v "${NPM_CACHE_VOLUME}:/web/node_modules" \
    -w /web \
    node:20-alpine \
    sh -c "npm install && npm run build"
}

deploy_ui() {
  require_container
  deploy_phase "QUICK UI — build + copy wwwroot (no image rebuild)"

  build_web
  [[ -d "$WEB/dist" ]] || { deploy_log "Missing $WEB/dist after build"; exit 1; }

  copy_to_container "$WEB/dist" "/app/wwwroot"

  deploy_verify_ui_marker "$KIT_CONTAINER" "$WEB/dist/index.html"
  deploy_log "UI updated in place — skipping container restart (static files served from disk)"
  deploy_wait_http "$HEALTH_URL" "staging kit web UI" 15
}

deploy_api() {
  require_container
  deploy_phase "QUICK API — dotnet publish + copy /app (no image rebuild)"

  mkdir -p "$CACHE_DIR/wwwroot" "$CACHE_DIR/publish"
  deploy_log "Snapshotting current wwwroot from container…"
  rm -rf "$CACHE_DIR/wwwroot"
  mkdir -p "$CACHE_DIR/wwwroot"
  docker cp "${KIT_CONTAINER}:/app/wwwroot/." "$CACHE_DIR/wwwroot/" 2>/dev/null || true
  if [[ ! -f "$CACHE_DIR/wwwroot/index.html" ]]; then
    deploy_log "Could not read wwwroot from container — using local dist if present"
    if [[ -d "$WEB/dist" ]]; then
      cp -a "$WEB/dist/." "$CACHE_DIR/wwwroot/"
    else
      deploy_log "No wwwroot source; run deploy-quick.sh ui first or full deploy"
      exit 1
    fi
  fi

  deploy_log "Publishing HaStagingConsole in dotnet/sdk container…"
  rm -rf "$CACHE_DIR/build"
  mkdir -p "$CACHE_DIR/build"
  cp -a "$ROOT/console/HaStagingConsole/." "$CACHE_DIR/build/"
  cp -a "$CACHE_DIR/wwwroot/." "$CACHE_DIR/build/wwwroot/"
  docker run --rm \
    -v "$CACHE_DIR/build:/src/HaStagingConsole" \
    -v "$CACHE_DIR/publish:/out" \
    -v "${NUGET_CACHE_VOLUME}:/root/.nuget/packages" \
    -w /src/HaStagingConsole \
    mcr.microsoft.com/dotnet/sdk:8.0 \
    sh -c "dotnet restore HaStagingConsole.csproj && dotnet publish HaStagingConsole.csproj -c Release -o /out /p:UseAppHost=false"

  deploy_log "Copying publish output → ${KIT_CONTAINER}:/app/"
  copy_to_container "$CACHE_DIR/publish" "/app"

  deploy_sync_entrypoint "$KIT_CONTAINER" "$ROOT/docker/entrypoint.sh"
  deploy_restart_container "$KIT_CONTAINER"
  deploy_wait_http "$HEALTH_URL" "staging kit web UI"
}

deploy_sidecar() {
  require_container
  deploy_phase "QUICK SIDECAR — copy /sidecar/lib + /sidecar/sbin (no image rebuild)"

  while IFS= read -r -d '' f; do
    sed -i 's/\r$//' "$f"
  done < <(find "$ROOT/sidecar/sbin" "$ROOT/sidecar/lib" -name '*.sh' -print0 2>/dev/null)

  copy_to_container "$ROOT/sidecar/lib" "/sidecar/lib"
  copy_to_container "$ROOT/sidecar/sbin" "/sidecar/sbin"
  docker exec "$KIT_CONTAINER" chmod +x /sidecar/sbin/*.sh 2>/dev/null || true

  deploy_log "Sidecar scripts updated in ${KIT_CONTAINER} (no restart required)"
}

deploy_full() {
  deploy_phase "FULL — docker compose build (use when Dockerfile or system deps change)"
  exec bash "$ROOT/scripts/deploy.sh" "${@:2}"
}

case "$MODE" in
  ui|web|frontend)
    deploy_ui
    ;;
  api|backend|dotnet)
    deploy_api
    ;;
  sidecar|scripts)
    deploy_sidecar
    ;;
  full|image|docker)
    deploy_full "$@"
    ;;
  -h|--help|help)
    cat <<EOF
Usage: $(basename "$0") [ui|api|sidecar|full]

  ui      Fast path for React/Settings/Dashboard changes (~1–2 min)
  api     Fast path for C# API changes (~2–3 min)
  sidecar Copy sidecar shell scripts into running container (~10s)
  full    Full docker compose rebuild (~5–8 min on this host)

Examples:
  bash scripts/deploy-quick.sh ui
  bash scripts/deploy-quick.sh api
  bash scripts/deploy-quick.sh sidecar
EOF
    ;;
  *)
    deploy_log "Unknown mode: $MODE (use sidecar, ui, api, or full)"
    exit 1
    ;;
esac
