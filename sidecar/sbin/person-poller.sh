#!/bin/bash
# Mirror prod person/device_tracker states to staging via REST API (no webhook package).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"
load_config

STORAGE="${HA_CONFIG}/.storage/person"
REGISTRY="${HA_CONFIG}/.storage/core.entity_registry"

fetch_prod_state() {
  local entity="$1"
  curl -sf -H "Authorization: Bearer ${PROD_TOKEN}" \
    "${PROD_URL}/api/states/${entity}"
}

push_staging_state() {
  local entity="$1"
  local payload="$2"
  curl -sf -X POST \
    -H "Authorization: Bearer ${STAGING_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "${STAGING_HA_URL}/api/states/${entity}" >/dev/null
}

poll_once() {
  if ! read_token_file "$PROD_API_TOKEN_FILE" PROD_URL PROD_TOKEN; then
    poll_log "WARN: missing prod API token ($PROD_API_TOKEN_FILE) — skip person poll"
    return 0
  fi
  if ! read_token_file "$STAGING_API_TOKEN_FILE" _STAGING_URL STAGING_TOKEN; then
    poll_log "WARN: missing staging API token ($STAGING_API_TOKEN_FILE) — skip person poll"
    return 0
  fi
  if [[ ! -f "$STORAGE" ]]; then
    poll_log "WARN: missing $STORAGE — run storage sync first"
    return 0
  fi

  mapfile -t entities < <(jq -r -s '
    (.[0].data.entities[]? | select(.platform=="person") | .entity_id),
    (.[1].data.items[]?.device_trackers[]?)
  ' "$REGISTRY" "$STORAGE" | sort -u)

  if [[ ${#entities[@]} -eq 0 ]]; then
    poll_log "WARN: no person/tracker entities in registry"
    return 0
  fi

  local entity state_json filtered synced=0 state
  for entity in "${entities[@]}"; do
    if ! state_json=$(fetch_prod_state "$entity"); then
      poll_log "WARN: failed prod fetch for $entity"
      continue
    fi
    filtered=$(echo "$state_json" | jq -c '{
      state: .state,
      attributes: (
        (.attributes // {} | del(
          .restored, .supported_features, .icon, .device_class,
          .unit_of_measurement, .state_class,
          .source_last_changed, .source_last_updated, .source_mirrored_at
        )) + {
          source_last_changed: .last_changed,
          source_last_updated: .last_updated,
          source_mirrored_at: (now | strftime("%Y-%m-%dT%H:%M:%S%z"))
        }
      )
    }')
    state=$(echo "$filtered" | jq -r '.state')
    if [[ "$state" == "unknown" || "$state" == "unavailable" ]]; then
      if [[ "$entity" != person.* ]]; then
        continue
      fi
    fi
    if [[ "$entity" == device_tracker.* ]]; then
      if ! echo "$filtered" | jq -e '.attributes.latitude != null' >/dev/null; then
        continue
      fi
    fi
    if push_staging_state "$entity" "$filtered"; then
      synced=$((synced + 1))
    else
      poll_log "WARN: failed staging push for $entity (staging API rejected — regenerate staging LLAT in kit Settings → Staging)"
    fi
  done

  if [[ $synced -gt 0 ]]; then
    poll_log "Synced $synced person/tracker states from prod"
  fi
}

MODE="${1:---once}"
case "$MODE" in
  --once) poll_once ;;
  --loop)
    poll_log "Person poll loop every ${PERSON_POLL_INTERVAL}s"
    while true; do
      poll_once || true
      sleep "$PERSON_POLL_INTERVAL"
    done
    ;;
  *) echo "Usage: person-poller.sh [--once|--loop]" >&2; exit 1 ;;
esac
