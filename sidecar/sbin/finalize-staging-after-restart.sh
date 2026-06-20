#!/bin/bash
# Wait for staging HA after container restart, then remove integrations that must not run on staging.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"
load_config

wait_tries="${FINALIZE_HA_WAIT_TRIES:-90}"
log "Finalize staging — waiting for HA (up to $((wait_tries * 2))s)"
if ! wait_for_ha "$wait_tries"; then
  log "WARN: staging HA not reachable — skip integration quiesce (restart may still be starting)"
  exit 0
fi

# HA needs a moment after / responds before config entry APIs are ready.
sleep 5

if ! "$SCRIPT_DIR/quiesce-staging-integrations.sh"; then
  log "WARN: quiesce-staging-integrations failed — check staging API token and sync.log"
  exit 0
fi

log "Finalize staging complete"
