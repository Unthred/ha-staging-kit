#!/bin/bash
# Remove config entries that cannot run on staging (analytics, voice, Z-Wave USB, …).
# LAN integrations (ESPHome, Cast, …) are disabled via WebSocket in StagingQuiesceService — not pruned here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"
load_config

CE="$HA_CONFIG/.storage/core.config_entries"
if [[ ! -f "$CE" ]]; then
  log "No core.config_entries to prune"
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  log "ERROR: jq required to prune staging config entries"
  exit 1
fi

STAGING_PRUNE_DOMAINS="${STAGING_PRUNE_DOMAINS:-analytics wyoming zwave_js homeassistant_sky_connect localtuya}"

read -r -a prune_domains <<< "$STAGING_PRUNE_DOMAINS"
read -r -a oauth_domains <<< "$OAUTH_PRESERVE_DOMAINS"

tmp="$(mktemp)"
prune_json="$(printf '%s\n' "${prune_domains[@]}" | jq -R . | jq -s .)"
oauth_json="$(printf '%s\n' "${oauth_domains[@]}" | jq -R . | jq -s .)"

before=$(jq '.data.entries | length' "$CE")
if ! jq --argjson prune "$prune_json" --argjson oauth "$oauth_json" '
  .data.entries |= map(
    select(
      (.domain as $d |
        ($prune | index($d)) == null or ($oauth | index($d)) != null)
    )
  )
' "$CE" >"$tmp"; then
  rm -f "$tmp"
  log "ERROR: jq failed pruning staging config entries"
  exit 1
fi

after=$(jq '.data.entries | length' "$tmp")
removed=$((before - after))
mv "$tmp" "$CE"

if [[ "$removed" -gt 0 ]]; then
  log "Pruned ${removed} staging config entr(y/ies) from disk (${before} → ${after})"
else
  log "No staging config entries to prune on disk"
fi
