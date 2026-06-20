#!/bin/bash
# Remove all staging .storage files except auth (kit LLAT / UI login) and OAuth preserve backup.
# Used by baseline-from-prod before apply-config repopulates from prod storage sync.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"
load_config

STORAGE="$HA_CONFIG/.storage"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

should_preserve() {
  local base="$1"
  case "$base" in
    auth | .kit-oauth-preserves.json) return 0 ;;
  esac
  [[ "$base" == auth_provider.* ]] && return 0
  return 1
}

log "Wiping staging .storage at ${STORAGE} (keeping auth only)"

"$SCRIPT_DIR/preserve-staging-oauth-entries.sh" backup

mkdir -p "$TMP/preserved"
if [[ -d "$STORAGE" ]]; then
  shopt -s nullglob
  for path in "$STORAGE"/*; do
    [[ -e "$path" ]] || continue
    base="$(basename "$path")"
    if should_preserve "$base"; then
      cp -a "$path" "$TMP/preserved/"
      log "Preserved $base"
    fi
  done
  shopt -u nullglob

  find "$STORAGE" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
else
  mkdir -p "$STORAGE"
fi

shopt -s nullglob
for path in "$TMP/preserved"/*; do
  [[ -e "$path" ]] || continue
  cp -a "$path" "$STORAGE/"
done
shopt -u nullglob

preserved_count="$(find "$STORAGE" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')"
log "Staging .storage wipe complete — ${preserved_count} preserved file(s); prod storage sync will repopulate the rest"
