#!/bin/bash
# Drop staging recorder DB and bootstrap marker so the next apply-config starts clean.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"
load_config

log "Preparing fresh staging HA data dir at ${HA_CONFIG}"
rm -f "$HA_CONFIG"/*.db "$HA_CONFIG"/*.db-* 2>/dev/null || true
rm -f "$HA_CONFIG/.staging-initialized" 2>/dev/null || true
log "Removed recorder DB and .staging-initialized (apply-config will re-bootstrap)"

bash "$SCRIPT_DIR/wipe-staging-storage.sh"

# Person pictures are repopulated by sync-storage.sh from prod.
rm -rf "$HA_CONFIG/image" 2>/dev/null || true
log "Cleared staging image/ (prod sync will restore person pictures)"
