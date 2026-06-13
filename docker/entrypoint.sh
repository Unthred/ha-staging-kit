#!/bin/bash
# Start config sync loop, optional MQTT mirror, then web UI (foreground).
set -euo pipefail

PID_DIR=/var/run/ha-staging-kit
mkdir -p "$PID_DIR"
SIDECAR_CONFIG="${SIDECAR_CONFIG:-/sidecar-data/config.env}"
MIRROR_DATA="${MIRROR_DATA:-}"

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
}

trap stop_children SIGTERM SIGINT

start_sync
start_mirror

echo "[entrypoint] Starting web UI on ${ASPNETCORE_URLS:-http://0.0.0.0:8080}"
exec dotnet /app/HaStagingConsole.dll
