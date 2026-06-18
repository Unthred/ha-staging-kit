#!/bin/bash
# Main sidecar loop: periodic person poll + optional storage sync.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"
load_config

# auto = apply only on first bootstrap; 1 = always; 0 = never
APPLY_ON_START="${APPLY_ON_START:-auto}"
should_apply=0
case "$APPLY_ON_START" in
  1|true|yes|always) should_apply=1 ;;
  0|false|no|never) should_apply=0 ;;
  auto)
    if [[ ! -f "${HA_CONFIG}/.staging-initialized" ]]; then
      should_apply=1
    fi
    ;;
  *)
    log "WARN: unknown APPLY_ON_START=${APPLY_ON_START} — treating as auto"
    if [[ ! -f "${HA_CONFIG}/.staging-initialized" ]]; then
      should_apply=1
    fi
    ;;
esac

if [[ "$should_apply" == 1 ]]; then
  log "Running apply-config on start (APPLY_ON_START=${APPLY_ON_START})"
  "$SCRIPT_DIR/apply-config.sh" || log "WARN: initial apply failed (will retry on schedule)"
else
  log "Skipping apply-config on start (staging already initialized; APPLY_ON_START=${APPLY_ON_START})"
fi

last_storage_sync=$(date +%s)

while true; do
  if wait_for_ha 3; then
    "$SCRIPT_DIR/person-poller.sh" --once || true
  else
    log "WARN: staging HA not reachable at ${STAGING_HA_URL}"
  fi

  now=$(date +%s)
  if (( now - last_storage_sync >= STORAGE_SYNC_INTERVAL )); then
    if [[ "${SKIP_STORAGE_SYNC:-0}" != 1 ]]; then
      log "Scheduled .storage sync"
      SKIP_STORAGE_SYNC=0 "$SCRIPT_DIR/sync-storage.sh" || log "WARN: storage sync failed"
    fi
    last_storage_sync=$now
  fi

  sleep "$PERSON_POLL_INTERVAL"
done
