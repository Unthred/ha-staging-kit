#!/bin/bash
# Remove staging-unsafe integrations that cannot run in Docker (REST DELETE).
# LAN integrations (ESPHome, Cast, …) are disabled via kit StagingQuiesceService — registry preserved.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"
load_config

STAGING_DELETE_DOMAINS="${STAGING_DELETE_DOMAINS:-analytics wyoming zwave_js homeassistant_sky_connect localtuya}"

domain_in_list() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

remove_entries_via_api() {
  local url token entries removed=0 domain entry_id
  read -r -a delete_domains <<< "$STAGING_DELETE_DOMAINS"
  read -r -a oauth_domains <<< "$OAUTH_PRESERVE_DOMAINS"

  if ! read_token_file "$STAGING_API_TOKEN_FILE" url token; then
    log "WARN: missing staging API token — skip integration quiesce"
    return 0
  fi
  if ! curl -sf -o /dev/null "${STAGING_HA_URL}/"; then
    log "WARN: staging HA not reachable — skip integration quiesce"
    return 0
  fi

  entries=$(curl -sf -H "Authorization: Bearer ${token}" \
    "${STAGING_HA_URL}/api/config/config_entries/entry" || true)
  if [[ -z "$entries" ]]; then
    log "WARN: could not list config entries"
    return 0
  fi

  while IFS=$'\t' read -r domain entry_id; do
    [[ -z "$entry_id" ]] && continue
    if domain_in_list "$domain" "${oauth_domains[@]}"; then
      continue
    fi
    if ! domain_in_list "$domain" "${delete_domains[@]}"; then
      continue
    fi
    http_code="000"
    http_code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
      -H "Authorization: Bearer ${token}" \
      "${STAGING_HA_URL}/api/config/config_entries/entry/${entry_id}" 2>/dev/null || echo "000")
    if [[ "$http_code" == "200" ]]; then
      log "Removed config entry ${entry_id} (${domain})"
      removed=$((removed + 1))
      sleep 1
    elif [[ "$http_code" == "000" ]]; then
      log "WARN: staging HA unavailable while removing ${entry_id} (${domain})"
    else
      log "WARN: failed to remove config entry ${entry_id} (${domain}) HTTP ${http_code}"
    fi
  done < <(echo "$entries" | jq -r '.[] | [.domain, .entry_id] | @tsv')

  log "Removed ${removed} staging-unsafe config entr(y/ies) via API"
}

log "Quiesce staging integrations (delete broken domains only)"
remove_entries_via_api
log "LAN integrations are disabled by kit after restart (registry preserved)"
