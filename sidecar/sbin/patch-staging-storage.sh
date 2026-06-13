#!/bin/bash
# Re-apply staging-only .storage overrides after prod sync (MQTT broker → mirror, etc.).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"
load_config

STAGING_MQTT_BROKER="${STAGING_MQTT_BROKER:-}"
STAGING_MQTT_PORT="${STAGING_MQTT_PORT:-1883}"
SKIP_MQTT_PATCH="${SKIP_MQTT_PATCH:-0}"

if [[ "$SKIP_MQTT_PATCH" == "1" ]]; then
  log "Skipping staging storage patch (SKIP_MQTT_PATCH=1)"
  exit 0
fi

if [[ -z "$STAGING_MQTT_BROKER" ]]; then
  log "Skipping MQTT broker patch — set STAGING_MQTT_BROKER in sidecar config when mirror is enabled"
  exit 0
fi

CE="$HA_CONFIG/.storage/core.config_entries"
if [[ ! -f "$CE" ]]; then
  log "WARN: no core.config_entries to patch"
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  log "ERROR: jq required to patch MQTT broker after storage sync"
  exit 1
fi

tmp="$(mktemp)"
if ! jq --arg broker "$STAGING_MQTT_BROKER" --argjson port "$STAGING_MQTT_PORT" '
  .data.entries |= map(
    if .domain == "mqtt" and (.data | type == "object") and (.data | has("broker")) then
      .data.broker = $broker | .data.port = $port
    else
      .
    end
  )
' "$CE" >"$tmp"; then
  rm -f "$tmp"
  log "ERROR: jq failed patching MQTT broker in core.config_entries"
  exit 1
fi

mv "$tmp" "$CE"
log "Patched staging MQTT broker → ${STAGING_MQTT_BROKER}:${STAGING_MQTT_PORT} (after prod storage sync)"
