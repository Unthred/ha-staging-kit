#!/bin/bash
# Start web UI first so /api/health responds before sidecar apply/docker work competes.
set -euo pipefail

PID_DIR=/var/run/ha-staging-kit
mkdir -p "$PID_DIR"
SIDECAR_CONFIG="${SIDECAR_CONFIG:-/sidecar-data/config.env}"
MIRROR_DATA="${MIRROR_DATA:-}"
WEB_PORT="${WEB_PORT:-8080}"
DOTNET_PID=""

start_sync() {
  echo "[entrypoint] Starting config sync loop"
  /sidecar/sbin/run.sh >> /sidecar-data/sync.log 2>&1 &
  echo $! > "$PID_DIR/sync.pid"
}

start_mirror() {
  local cfg="${MIRROR_DATA}/config/mosquitto.conf"
  if [[ -n "$MIRROR_DATA" && -f "$cfg" ]]; then
    echo "[entrypoint] Starting MQTT mirror (mosquitto)"
    pkill -x mosquitto 2>/dev/null || true
    sleep 0.5
    chown -R mosquitto:mosquitto "${MIRROR_DATA}/log" "${MIRROR_DATA}/data" \
      "${MIRROR_DATA}/config/passwd" "${MIRROR_DATA}/config/conf.d/bridge.conf" 2>/dev/null || true
    su -s /bin/bash mosquitto -c "mosquitto -c \"$cfg\" >> \"${MIRROR_DATA}/log/mosquitto.log\" 2>&1 &"
    echo $! > "$PID_DIR/mirror.pid"
  fi
}

stop_children() {
  [[ -f "$PID_DIR/sync.pid" ]] && kill "$(cat "$PID_DIR/sync.pid")" 2>/dev/null || true
  [[ -f "$PID_DIR/mirror.pid" ]] && kill "$(cat "$PID_DIR/mirror.pid")" 2>/dev/null || true
  pkill -x mosquitto 2>/dev/null || true
  if [[ -n "$DOTNET_PID" ]]; then
    kill -TERM "$DOTNET_PID" 2>/dev/null || true
    for _ in $(seq 1 10); do
      kill -0 "$DOTNET_PID" 2>/dev/null || break
      sleep 1
    done
    kill -KILL "$DOTNET_PID" 2>/dev/null || true
  fi
}

wait_for_web() {
  local max="${WEB_READY_WAIT:-45}"
  local i
  for ((i = 1; i <= max; i++)); do
    if curl -sf "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1; then
      echo "[entrypoint] Web UI ready (${i}s)"
      return 0
    fi
    sleep 1
  done
  echo "[entrypoint] WARN: Web UI health not confirmed after ${max}s — starting sidecar anyway"
  return 1
}

trap stop_children SIGTERM SIGINT

echo "[entrypoint] Starting web UI on ${ASPNETCORE_URLS:-http://0.0.0.0:${WEB_PORT}}"
dotnet /app/HaStagingConsole.dll &
DOTNET_PID=$!

wait_for_web || true
start_sync
start_mirror

wait "$DOTNET_PID"
