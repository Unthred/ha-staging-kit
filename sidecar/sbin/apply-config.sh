#!/bin/bash
# Apply identical git config to staging HA appdata + sidecar runtime overlay.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"
load_config

log "Apply config branch=${HA_BRANCH} repo=${REPO_DIR} → ${HA_CONFIG}"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  log "ERROR: git repo missing at $REPO_DIR"
  exit 1
fi

if [[ "${SKIP_GIT_FETCH:-0}" != 1 ]]; then
  if ! git -C "$REPO_DIR" fetch origin; then
    log "WARN: git fetch failed — continuing with local repo state (bind-mounted repo may be updated on host)"
  fi
else
  log "Skipping git fetch (SKIP_GIT_FETCH=1)"
fi
git -C "$REPO_DIR" checkout "$HA_BRANCH"
if ! git -C "$REPO_DIR" pull --ff-only origin "$HA_BRANCH"; then
  log "WARN: git pull failed — continuing with checked-out branch"
fi

mkdir -p "$HA_CONFIG/packages"

if [[ ! -f "$HA_CONFIG/.staging-initialized" ]]; then
  log "First bootstrap — clearing stale DB"
  rm -f "$HA_CONFIG"/*.db "$HA_CONFIG"/*.db-* 2>/dev/null || true
fi

log "Rsync shared git config (identical to prod source tree)"
rsync -av --delete \
  --exclude='.git/' \
  --exclude='.staging-initialized' \
  --exclude='.storage/' \
  --exclude='image/' \
  --exclude='secrets.yaml' \
  --exclude='packages/sidecar_generated.yaml' \
  --exclude='packages/staging_*.yaml' \
  --exclude='*.db' \
  --exclude='*.db-*' \
  --exclude='*.log' \
  --exclude='*.log.*' \
  --exclude='.ha_run.lock' \
  "$REPO_DIR/" "$HA_CONFIG/"

# Remove legacy staging-only packages if present from older applies.
rm -f "$HA_CONFIG/packages/staging_env.yaml" \
      "$HA_CONFIG/packages/staging_person_sync.yaml" 2>/dev/null || true

if [[ ! -f "$SIDECAR_TEMPLATE" ]]; then
  log "ERROR: missing sidecar template $SIDECAR_TEMPLATE"
  exit 1
fi
install -m 644 "$SIDECAR_TEMPLATE" "$HA_CONFIG/packages/sidecar_generated.yaml"
log "Installed runtime overlay packages/sidecar_generated.yaml"

log "Sync secrets.yaml from prod"
if ! rsync -av -e "$HA_SSH" "$HA_SECRETS" "$HA_CONFIG/secrets.yaml"; then
  if [[ -f "$HA_CONFIG/secrets.yaml" ]]; then
    log "WARN: secrets sync failed — keeping existing secrets.yaml"
  else
    log "ERROR: secrets sync failed and no secrets.yaml present"
    exit 1
  fi
fi

if [[ "${SKIP_STORAGE_SYNC:-0}" != 1 ]]; then
  if ! "$SCRIPT_DIR/sync-storage.sh"; then
    log "WARN: .storage sync failed — keeping existing staging .storage"
  fi
else
  log "Skipping .storage sync (SKIP_STORAGE_SYNC=1)"
fi

touch "$HA_CONFIG/.staging-initialized"
log "Apply complete — restart Home-Assistant-Container to load YAML changes"
