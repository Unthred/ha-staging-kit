#!/bin/bash
# Shared helpers for ha-staging-sidecar scripts.
set -euo pipefail

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ha-staging-sidecar: $*"; }

load_config() {
  CONFIG_FILE="${SIDECAR_CONFIG:-/sidecar-data/config.env}"
  if [[ -f "$CONFIG_FILE" ]]; then
    # shellcheck disable=SC1090
    set -a
    source "$CONFIG_FILE"
    set +a
  fi
  REPO_DIR="${REPO_DIR:-/repo}"
  HA_CONFIG="${HA_CONFIG:-/ha-config}"
  HA_BRANCH="${HA_BRANCH:-staging}"
  STAGING_HA_URL="${STAGING_HA_URL:-http://127.0.0.1:8123}"
  PERSON_POLL_INTERVAL="${PERSON_POLL_INTERVAL:-60}"
  STORAGE_SYNC_INTERVAL="${STORAGE_SYNC_INTERVAL:-86400}"
  SECRETS_DIR="${SECRETS_DIR:-/sidecar-data/secrets}"
  PROD_API_TOKEN_FILE="${PROD_API_TOKEN_FILE:-${SECRETS_DIR}/ha-prod-api.token}"
  STAGING_API_TOKEN_FILE="${STAGING_API_TOKEN_FILE:-${SECRETS_DIR}/ha-staging-api.token}"
  SSH_KEY_FILE="${SSH_KEY_FILE:-${SECRETS_DIR}/id_ed25519}"
  SIDECAR_TEMPLATE="${SIDECAR_TEMPLATE:-/sidecar/templates/packages-sidecar.yaml}"
  HA_SSH="${HA_SSH:-ssh -i ${SSH_KEY_FILE} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes}"
  HA_SECRETS="${HA_SECRETS:-squiggley@192.168.13.2:/homeassistant/secrets.yaml}"
  HA_STORAGE="${HA_STORAGE:-squiggley@192.168.13.2:/homeassistant/.storage/}"
}

read_token_file() {
  local file="$1"
  local url_var="$2"
  local token_var="$3"
  if [[ ! -f "$file" ]]; then
    return 1
  fi
  # shellcheck disable=SC2034
  printf -v "$url_var" '%s' "$(sed -n '1p' "$file" | tr -d '\r\n' | sed 's/[[:space:]]*$//; s#/$##')"
  # shellcheck disable=SC2034
  printf -v "$token_var" '%s' "$(sed -n '2p' "$file" | tr -d '\r\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  [[ -n "${!url_var}" && -n "${!token_var}" ]]
}

wait_for_ha() {
  local url="${STAGING_HA_URL}/"
  local tries="${1:-60}"
  local i
  for ((i = 1; i <= tries; i++)); do
    if curl -sf -o /dev/null "$url"; then
      return 0
    fi
    sleep 2
  done
  return 1
}
