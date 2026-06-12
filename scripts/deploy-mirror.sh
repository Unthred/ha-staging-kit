#!/bin/bash
# Deploy / refresh MQTT mirror config and container via compose.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ -f .env ]] || { echo "Missing .env — cp config.example.env .env"; exit 1; }
# shellcheck disable=SC1091
set -a && source .env && set +a

TEMPLATE_DIR="$ROOT/mirror"
APP_ROOT="${MIRROR_DATA:?Set MIRROR_DATA in .env}"
CONFIG_DIR="$APP_ROOT/config"
STATE_FILE="$APP_ROOT/control-mode"
STORAGE="${HA_STAGING_CONFIG:?}/.storage/core.config_entries"
PROD_MQTT_HOST="${PROD_MQTT_HOST:?}"
PROD_MQTT_PORT="${PROD_MQTT_PORT:-1883}"

log() { echo "[deploy-mirror] $*"; }

[[ -f "$STORAGE" ]] || { log "Missing $STORAGE — run sidecar apply-config / storage sync first"; exit 1; }

MQTT_USER=$(jq -r '.data.entries[] | select(.domain=="mqtt" and .title=="Mosquitto Mqtt Broker") | .data.username' "$STORAGE")
MQTT_PASS=$(jq -r '.data.entries[] | select(.domain=="mqtt" and .title=="Mosquitto Mqtt Broker") | .data.password' "$STORAGE")
[[ -n "$MQTT_USER" && "$MQTT_USER" != null && -n "$MQTT_PASS" && "$MQTT_PASS" != null ]] || {
  log "Could not read MQTT credentials from staging .storage"; exit 1
}

mkdir -p "$CONFIG_DIR/conf.d" "$APP_ROOT/data" "$APP_ROOT/log"
install -m 644 "$TEMPLATE_DIR/mosquitto.conf" "$CONFIG_DIR/mosquitto.conf"

BRIDGE_TEMPLATE="$TEMPLATE_DIR/bridge.conf.template"
ACL_FILE="$TEMPLATE_DIR/acl"
MODE="read-only"
if [[ -f "$STATE_FILE" ]] && [[ "$(cat "$STATE_FILE")" == "control" ]]; then
  BRIDGE_TEMPLATE="$TEMPLATE_DIR/bridge.conf.control.template"
  ACL_FILE="$TEMPLATE_DIR/acl.control"
  MODE="control"
fi
install -m 644 "$ACL_FILE" "$CONFIG_DIR/acl"

sed -e "s|__MQTT_USER__|${MQTT_USER}|g" \
    -e "s|__MQTT_PASSWORD__|${MQTT_PASS}|g" \
    -e "s|__PROD_MQTT_HOST__|${PROD_MQTT_HOST}|g" \
    -e "s|__PROD_MQTT_PORT__|${PROD_MQTT_PORT}|g" \
    "$BRIDGE_TEMPLATE" > "$CONFIG_DIR/conf.d/bridge.conf"
echo "$MODE" > "$STATE_FILE"
chmod 600 "$CONFIG_DIR/conf.d/bridge.conf"

rm -f "$CONFIG_DIR/passwd"
docker run --rm -v "$CONFIG_DIR:/mosquitto/config" eclipse-mosquitto:2 \
  mosquitto_passwd -b -c /mosquitto/config/passwd "$MQTT_USER" "$MQTT_PASS"
chmod 644 "$CONFIG_DIR/passwd"

log "Start mosquitto-mirror via compose (mode: $MODE)"
docker rm -f mosquitto-mirror 2>/dev/null || true
docker compose up -d mosquitto-mirror

sleep 2
docker ps --format '{{.Names}}' | grep -qx mosquitto-mirror || {
  docker logs mosquitto-mirror 2>&1 | tail -20; exit 1
}
log "Mirror up on :${MIRROR_PORT:-1883}"
