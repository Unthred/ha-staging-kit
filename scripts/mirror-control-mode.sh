#!/bin/bash
# Toggle MQTT mirror read-only vs control mode. Requires mirror deployed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TEMPLATE_DIR="$ROOT/mirror"
APP_ROOT="${MIRROR_DATA:-$ROOT/data/mirror}"
CONFIG_DIR="$APP_ROOT/config"
STATE_FILE="$APP_ROOT/control-mode"
STORAGE="${HA_STAGING_CONFIG:-}/.storage/core.config_entries"
CONTAINER="${MIRROR_CONTAINER:-ha-staging-kit}"

log() { echo "[mirror-control-mode] $*"; }

usage() {
  echo "Usage: mirror-control-mode.sh on|off|status"
}

read_creds() {
  if [[ -f "$CONFIG_DIR/conf.d/bridge.conf" ]]; then
    MQTT_USER=$(grep -E '^remote_username ' "$CONFIG_DIR/conf.d/bridge.conf" | awk '{print $2}')
    MQTT_PASS=$(grep -E '^remote_password ' "$CONFIG_DIR/conf.d/bridge.conf" | awk '{print $2}')
  elif [[ -f "$STORAGE" ]]; then
    MQTT_USER=$(jq -r '.data.entries[] | select(.domain=="mqtt" and .title=="Mosquitto Mqtt Broker") | .data.username' "$STORAGE")
    MQTT_PASS=$(jq -r '.data.entries[] | select(.domain=="mqtt" and .title=="Mosquitto Mqtt Broker") | .data.password' "$STORAGE")
  else
    log "ERROR: No bridge.conf or staging .storage — deploy mirror first"
    exit 1
  fi
}

write_bridge() {
  sed -e "s|__MQTT_USER__|${MQTT_USER}|g" \
      -e "s|__MQTT_PASSWORD__|${MQTT_PASS}|g" \
      -e "s|__PROD_MQTT_HOST__|${PROD_MQTT_HOST:?Set PROD_MQTT_HOST in .env}|g" \
      -e "s|__PROD_MQTT_PORT__|${PROD_MQTT_PORT:-1883}|g" \
      "$1" > "$CONFIG_DIR/conf.d/bridge.conf"
  chmod 600 "$CONFIG_DIR/conf.d/bridge.conf"
}

apply_mode() {
  local mode="$1"
  mkdir -p "$CONFIG_DIR/conf.d"
  read_creds
  case "$mode" in
    on)
      write_bridge "$TEMPLATE_DIR/bridge.conf.control.template"
      install -m 644 "$TEMPLATE_DIR/acl.control" "$CONFIG_DIR/acl"
      echo "control" > "$STATE_FILE"
      log "Control mode ON — WARNING: staging can actuate prod Z2M devices"
      ;;
    off)
      write_bridge "$TEMPLATE_DIR/bridge.conf.template"
      install -m 644 "$TEMPLATE_DIR/acl" "$CONFIG_DIR/acl"
      echo "read-only" > "$STATE_FILE"
      log "Control mode OFF — read-only (safe default)"
      ;;
  esac
  restart_mosquitto() {
    if [[ -f /.dockerenv ]]; then
      pkill -x mosquitto 2>/dev/null || true
      sleep 0.5
      mosquitto -c "$CONFIG_DIR/mosquitto.conf" >> "$APP_ROOT/log/mosquitto.log" 2>&1 &
      log "Restarted mosquitto (in kit container)"
    elif docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
      docker exec "$CONTAINER" bash -lc "pkill -x mosquitto 2>/dev/null || true; sleep 0.5; mosquitto -c '$CONFIG_DIR/mosquitto.conf' >> '$APP_ROOT/log/mosquitto.log' 2>&1 &" \
        && log "Restarted mosquitto in $CONTAINER" \
        || log "WARN: mosquitto restart failed"
    else
      log "WARN: kit container not running — restart ha-staging-kit after deploy"
    fi
  }
  restart_mosquitto
}

[[ $# -eq 1 ]] || { usage; exit 1; }
case "$1" in
  on) apply_mode on ;;
  off) apply_mode off ;;
  status) [[ -f "$STATE_FILE" ]] && log "Mode: $(cat "$STATE_FILE")" || log "Mode: read-only" ;;
  *) usage; exit 1 ;;
esac
