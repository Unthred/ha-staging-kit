#!/bin/bash
# Snapshot UI-authored files from staging HA back into the config repo.
# Captures Lovelace dashboards and UI-created helpers — nothing credential or device-specific.
# Run this after making UI changes on staging HA to bring them into git for prod deploy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"
load_config

STAGING_STORAGE="$HA_CONFIG/.storage"
REPO_STORAGE="$REPO_DIR/.storage"

if [[ ! -d "$STAGING_STORAGE" ]]; then
  log "ERROR: staging .storage not found at $STAGING_STORAGE"
  exit 1
fi

mkdir -p "$REPO_STORAGE"

CAPTURE_FILES=(
  lovelace.lovelace
  lovelace.map
  lovelace_dashboards
  lovelace_resources
  input_boolean
  input_number
  input_select
  input_text
  input_datetime
  timer
  counter
  schedule
  todo
  scheduler.storage
)

captured=0
unchanged=0
for fname in "${CAPTURE_FILES[@]}"; do
  src="$STAGING_STORAGE/$fname"
  dest="$REPO_STORAGE/$fname"
  [[ -f "$src" ]] || continue
  if cmp -s "$src" "$dest" 2>/dev/null; then
    ((unchanged++)) || true
  else
    cp "$src" "$dest"
    log "Captured $fname"
    ((captured++)) || true
  fi
done

if [[ $captured -eq 0 ]]; then
  log "No UI changes — staging .storage matches repo ($unchanged file(s) unchanged)"
else
  log "Captured $captured file(s) from staging HA → repo/.storage/ ($unchanged unchanged)"
fi
