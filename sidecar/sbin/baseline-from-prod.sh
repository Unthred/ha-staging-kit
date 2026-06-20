#!/bin/bash
# Export live prod HA into the git config repo (YAML + Lovelace/helpers .storage), commit on staging branch.
# Orchestrated by kit Operations → Baseline from prod (BaselineFromProdService).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"
load_config

# HA_STORAGE is typically user@host:/homeassistant/.storage/
if [[ -n "${HA_PROD_CONFIG:-}" ]]; then
  PROD_CONFIG="${HA_PROD_CONFIG%/}/"
else
  PROD_CONFIG="${HA_STORAGE%/.storage/}"
  PROD_CONFIG="${PROD_CONFIG%/.storage}"
  PROD_CONFIG="${PROD_CONFIG%/}/"
fi

log "Baseline from prod — export ${PROD_CONFIG} → ${REPO_DIR}"

[[ -d "$REPO_DIR/.git" ]] || { log "ERROR: git repo missing at $REPO_DIR"; exit 1; }

git -C "$REPO_DIR" checkout "$HA_BRANCH" 2>/dev/null || git -C "$REPO_DIR" checkout -B "$HA_BRANCH"

log "Rsync prod YAML tree into repo (secrets, db, and full .storage excluded)"
# No --delete: git repo also tracks kit/docs/scripts not present on prod disk.
rsync -avz \
  --exclude='.git/' \
  --exclude='.gitignore' \
  --exclude='.storage/' \
  --exclude='.cloud/' \
  --exclude='.cache/' \
  --exclude='.venv/' \
  --exclude='deps/' \
  --exclude='tmp/' \
  --exclude='secrets.yaml' \
  --exclude='*.db' \
  --exclude='*.db-*' \
  --exclude='*.log' \
  --exclude='*.log.*' \
  --exclude='*.pickle' \
  --exclude='*.sqlite' \
  --exclude='home-assistant_v2.db*' \
  --exclude='.ha_run.lock' \
  --exclude='zigbee2mqtt/database.db*' \
  --exclude='zigbee2mqtt/coordinator_backup.json' \
  --exclude='zigbee2mqtt/*.backup*' \
  --exclude='zigbee2mqtt/configuration.yaml.backup*' \
  --exclude='image/' \
  --exclude='tts/' \
  -e "$HA_SSH" \
  "$PROD_CONFIG" "$REPO_DIR/"

if [[ -f "$REPO_DIR/scripts/unraid/ha-config.gitignore" ]]; then
  cp "$REPO_DIR/scripts/unraid/ha-config.gitignore" "$REPO_DIR/.gitignore"
elif [[ -f /boot/config/scripts/ha-config.gitignore ]]; then
  cp /boot/config/scripts/ha-config.gitignore "$REPO_DIR/.gitignore"
fi

mkdir -p "$REPO_DIR/.storage"

STORAGE_CAPTURE=(
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

log "Rsync prod .storage UI files into repo/.storage/"
captured=0
for fname in "${STORAGE_CAPTURE[@]}"; do
  remote="${HA_STORAGE}${fname}"
  dest="$REPO_DIR/.storage/$fname"
  if rsync -av -e "$HA_SSH" "$remote" "$dest" 2>/dev/null; then
    log "Captured $fname from prod"
    ((captured++)) || true
  fi
done
log "Captured $captured prod .storage file(s) into git"

if [[ "${BASELINE_SKIP_COMMIT:-0}" == "1" ]]; then
  log "BASELINE_SKIP_COMMIT=1 (commit deferred to kit automation export + git commit)"
  echo "BASELINE_EXPORT_ONLY=1"
  exit 0
fi

log "Git commit on branch ${HA_BRANCH}"
ensure_git_identity
git -C "$REPO_DIR" add -A
if git -C "$REPO_DIR" diff --cached --quiet; then
  log "No file changes — keeping existing HEAD commit"
else
  if ! git -C "$REPO_DIR" commit -m "baseline: prod snapshot $(date -u +%Y-%m-%dT%H:%M:%SZ)"; then
    log "ERROR: git commit failed (check author identity and repo mount)"
    exit 1
  fi
fi

SHA="$(git -C "$REPO_DIR" rev-parse HEAD)"
log "BASELINE_SHA=${SHA}"
echo "BASELINE_SHA=${SHA}"
