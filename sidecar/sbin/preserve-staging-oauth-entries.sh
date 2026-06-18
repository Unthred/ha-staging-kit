#!/bin/bash
# Backup / restore cloud OAuth config entries on staging across prod storage sync.
# Same idea as MQTT broker patch: sync prod baseline, then re-apply staging-only creds.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"
load_config

OAUTH_PRESERVE_DOMAINS="${OAUTH_PRESERVE_DOMAINS:-smartthings tuya}"
SKIP_OAUTH_PRESERVE="${SKIP_OAUTH_PRESERVE:-0}"
CE="${HA_CONFIG}/.storage/core.config_entries"
BACKUP="${HA_CONFIG}/.storage/.kit-oauth-preserves.json"

usage() {
  echo "Usage: $(basename "$0") backup|restore" >&2
  exit 1
}

domain_jq_filter() {
  local -a domains=()
  read -r -a domains <<<"$OAUTH_PRESERVE_DOMAINS"
  local json="["
  local first=1
  for d in "${domains[@]}"; do
    [[ -z "$d" ]] && continue
    [[ "$first" -eq 1 ]] || json+=","
    json+="\"${d//\"/\\\"}\""
    first=0
  done
  json+="]"
  printf '%s' "$json"
}

backup_oauth_entries() {
  if [[ "$SKIP_OAUTH_PRESERVE" == "1" ]]; then
    log "Skipping OAuth preserve backup (SKIP_OAUTH_PRESERVE=1)"
    return 0
  fi

  if [[ ! -f "$CE" ]]; then
    log "Skipping OAuth preserve backup — no core.config_entries yet"
    return 0
  fi

  if ! command -v jq >/dev/null 2>&1; then
    log "WARN: jq required for OAuth preserve — skipping backup"
    return 0
  fi

  local domains_json
  domains_json="$(domain_jq_filter)"
  local tmp
  tmp="$(mktemp)"
  if ! jq --argjson domains "$domains_json" '
    {version: 1, preserved_at: (now | todate), domains: $domains,
     entries: [.data.entries[] | select(.domain as $d | $domains | index($d))]}
  ' "$CE" >"$tmp"; then
    rm -f "$tmp"
    log "WARN: jq failed backing up OAuth config entries"
    return 0
  fi

  local count
  count="$(jq '.entries | length' "$tmp")"
  mv "$tmp" "$BACKUP"
  log "Backed up ${count} staging OAuth config entr$( [[ "$count" == "1" ]] && echo y || echo ies ) (${OAUTH_PRESERVE_DOMAINS})"
}

restore_oauth_entries() {
  if [[ "$SKIP_OAUTH_PRESERVE" == "1" ]]; then
    log "Skipping OAuth preserve restore (SKIP_OAUTH_PRESERVE=1)"
    return 0
  fi

  if [[ ! -f "$BACKUP" ]]; then
    log "No OAuth preserve backup — using prod OAuth entries as synced"
    return 0
  fi

  if [[ ! -f "$CE" ]]; then
    log "WARN: no core.config_entries to restore OAuth entries into"
    return 0
  fi

  if ! command -v jq >/dev/null 2>&1; then
    log "WARN: jq required for OAuth preserve — skipping restore"
    return 0
  fi

  local count
  count="$(jq '.entries | length' "$BACKUP" 2>/dev/null || echo 0)"
  if [[ "$count" == "0" ]]; then
    log "OAuth preserve backup empty — nothing to restore"
    return 0
  fi

  local tmp
  tmp="$(mktemp)"
  if ! jq -s '
    .[0] as $ce | .[1].entries as $preserved |
    ($preserved | map({(.entry_id): .}) | add // {}) as $by_id |
    $ce | .data.entries |= map($by_id[.entry_id] // .)
  ' "$CE" "$BACKUP" >"$tmp"; then
    rm -f "$tmp"
    log "ERROR: jq failed restoring OAuth config entries"
    return 1
  fi

  mv "$tmp" "$CE"
  log "Restored ${count} staging OAuth config entr$( [[ "$count" == "1" ]] && echo y || echo ies ) after prod storage sync"
}

case "${1:-}" in
  backup) backup_oauth_entries ;;
  restore) restore_oauth_entries ;;
  *) usage ;;
esac
