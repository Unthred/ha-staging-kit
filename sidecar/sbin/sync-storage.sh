#!/bin/bash
# Copy prod .storage subset to staging so UI/registry/helpers match prod.
# Does not copy device state (restore_state, bluetooth) — devices stay on prod only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"
load_config

# Instance id must differ between prod and staging.
# `counter` is NOT synced: prod counters clash with sidecar_generated.yaml log counters.
STORAGE_INCLUDES=(
  onboarding
  auth
  auth_provider.homeassistant
  core.config_entries
  core.entity_registry
  core.device_registry
  core.area_registry
  core.floor_registry
  core.label_registry
  core.category_registry
  core.config
  homeassistant.exposed_entities
  lovelace_dashboards
  lovelace_resources
  person
  zone
  http
  http.auth
  repairs.issue_registry
  timer
  input_boolean
  input_datetime
  input_number
  input_select
  input_text
  scheduler.storage
  image
  local_calendar.*
  local_todo.*
  alarmo.storage
  switch_manager
  home_maintenance.storage
)

mkdir -p "$HA_CONFIG/.storage"

RSYNC_INCLUDE=()
for name in "${STORAGE_INCLUDES[@]}"; do
  RSYNC_INCLUDE+=(--include="$name")
done

log "Rsync .storage from prod (${#STORAGE_INCLUDES[@]} files)"
rsync -av \
  -e "$HA_SSH" \
  --rsync-path="sudo rsync" \
  --include='*/' \
  "${RSYNC_INCLUDE[@]}" \
  --include='frontend.user_data*' \
  --include='frontend.system_data' \
  --include='lovelace.*' \
  --exclude='*' \
  "$HA_STORAGE" \
  "$HA_CONFIG/.storage/"

log "Rsync uploaded images (person pictures) from prod"
rsync -av \
  -e "$HA_SSH" \
  --rsync-path="sudo rsync" \
  "${HA_STORAGE%.storage/}image/" \
  "$HA_CONFIG/image/"

log "Storage sync complete"
