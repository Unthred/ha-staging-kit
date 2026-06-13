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

[[ -f "$STORAGE" ]] || { log "Missing $STORAGE — run config sync apply-config / storage sync first"; exit 1; }

MQTT_USER=$(jq -r '.data.entries[] | select(.domain=="mqtt" and .title=="Mosquitto Mqtt Broker") | .data.username' "$STORAGE")
MQTT_PASS=$(jq -r '.data.entries[] | select(.domain=="mqtt" and .title=="Mosquitto Mqtt Broker") | .data.password' "$STORAGE")
[[ -n "$MQTT_USER" && "$MQTT_USER" != null && -n "$MQTT_PASS" && "$MQTT_PASS" != null ]] || {
  log "Could not read MQTT credentials from staging .storage"; exit 1
}

mkdir -p "$CONFIG_DIR/conf.d" "$APP_ROOT/data" "$APP_ROOT/log"
install -m 644 "$TEMPLATE_DIR/mosquitto.conf" "$CONFIG_DIR/mosquitto.conf"
# Template uses eclipse-mosquitto container paths; rewrite for in-kit native mosquitto.
sed -i \
  -e "s|/mosquitto/data/|${APP_ROOT}/data/|g" \
  -e "s|/mosquitto/log/mosquitto.log|${APP_ROOT}/log/mosquitto.log|g" \
  -e "s|/mosquitto/config/passwd|${CONFIG_DIR}/passwd|g" \
  -e "s|/mosquitto/config/acl|${CONFIG_DIR}/acl|g" \
  -e "s|/mosquitto/config/conf.d|${CONFIG_DIR}/conf.d|g" \
  "$CONFIG_DIR/mosquitto.conf"

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
chmod 640 "$CONFIG_DIR/conf.d/bridge.conf"

rm -f "$CONFIG_DIR/passwd"
if docker ps --format '{{.Names}}' | grep -qx "${KIT_CONTAINER:-ha-staging-kit}"; then
  docker exec "${KIT_CONTAINER:-ha-staging-kit}" mosquitto_passwd -b -c "$CONFIG_DIR/passwd" "$MQTT_USER" "$MQTT_PASS"
elif command -v mosquitto_passwd >/dev/null 2>&1; then
  mosquitto_passwd -b -c "$CONFIG_DIR/passwd" "$MQTT_USER" "$MQTT_PASS"
else
  docker run --rm -v "$CONFIG_DIR:/mosquitto/config" eclipse-mosquitto:2 \
    mosquitto_passwd -b -c /mosquitto/config/passwd "$MQTT_USER" "$MQTT_PASS"
fi
chmod 644 "$CONFIG_DIR/passwd"

# Native mosquitto in kit runs as user mosquitto — ensure it can read config and write data/log.
if docker ps --format '{{.Names}}' | grep -qx "${KIT_CONTAINER:-ha-staging-kit}"; then
  docker exec "${KIT_CONTAINER:-ha-staging-kit}" bash -lc \
    "chown -R mosquitto:mosquitto '$APP_ROOT/log' '$APP_ROOT/data' '$CONFIG_DIR/passwd' '$CONFIG_DIR/conf.d/bridge.conf' 2>/dev/null || true"
fi

log "Refresh MQTT mirror config (mode: $MODE, in-container mosquitto)"

# If kit is running, restart mosquitto inside it; otherwise mirror starts on next kit boot.
if docker ps --format '{{.Names}}' | grep -qx "${KIT_CONTAINER:-ha-staging-kit}"; then
  docker exec "${KIT_CONTAINER:-ha-staging-kit}" bash -lc \
    "pkill -x mosquitto 2>/dev/null || true; sleep 0.5; su -s /bin/bash mosquitto -c \"mosquitto -c '$CONFIG_DIR/mosquitto.conf' >> '$APP_ROOT/log/mosquitto.log' 2>&1 &\"" \
    && log "Mirror config applied; mosquitto restarted in kit container" \
    || log "WARN: could not restart mosquitto inside kit — restart ha-staging-kit"
else
  log "Kit container not running — config written; start with: bash scripts/deploy.sh --with-mirror"
fi
log "Mirror up on :${MIRROR_PORT:-1883}"
