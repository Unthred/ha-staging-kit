#!/bin/bash
# Disable LAN-touching integrations on staging so automations cannot actuate real hardware.
# Re-run after each apply (storage sync re-imports prod config entries).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"
load_config

LAN_DOMAINS=(esphome yamaha yamaha_musiccast androidtv androidtv_remote cast broadlink)

purge_staging_credentials() {
  local removed=0
  shopt -s nullglob
  for pattern in esphome.* androidtv_adbkey*; do
    for file in "$HA_CONFIG/.storage/$pattern"; do
      rm -f "$file"
      log "Removed stale credential file $(basename "$file")"
      removed=$((removed + 1))
    done
  done
  shopt -u nullglob
  if [[ "$removed" -eq 0 ]]; then
    log "No stale esphome/androidtv credential files to purge"
  fi
}

disable_entries_via_api() {
  local url token entries disabled=0 domain entry_id state
  if ! read_token_file "$STAGING_API_TOKEN_FILE" url token; then
    log "WARN: missing staging API token — skip config entry disable (YAML guards still apply)"
    return 0
  fi
  if ! curl -sf -o /dev/null "${STAGING_HA_URL}/"; then
    log "WARN: staging HA not reachable — skip config entry disable until after restart"
    return 0
  fi

  entries=$(curl -sf -H "Authorization: Bearer ${token}" \
    "${STAGING_HA_URL}/api/config/config_entries/entry" || true)
  if [[ -z "$entries" ]]; then
    log "WARN: could not list config entries"
    return 0
  fi

  for domain in "${LAN_DOMAINS[@]}"; do
    while IFS= read -r entry_id; do
      [[ -z "$entry_id" ]] && continue
      state=$(echo "$entries" | jq -r --arg id "$entry_id" '.[] | select(.entry_id==$id) | .state')
      if [[ "$state" == "loaded" || "$state" == "setup" || "$state" == "setup_retry" ]]; then
        if curl -sf -X POST \
          -H "Authorization: Bearer ${token}" \
          "${STAGING_HA_URL}/api/config/config_entries/entry/${entry_id}/disable" >/dev/null; then
          log "Disabled config entry ${entry_id} (${domain})"
          disabled=$((disabled + 1))
        else
          log "WARN: failed to disable config entry ${entry_id} (${domain})"
        fi
      fi
    done < <(echo "$entries" | jq -r --arg d "$domain" '.[] | select(.domain==$d) | .entry_id')
  done

  log "Disabled ${disabled} LAN config entries on staging"
}

log "Disable LAN integrations on staging"
purge_staging_credentials
disable_entries_via_api
log "LAN integration disable pass complete"
