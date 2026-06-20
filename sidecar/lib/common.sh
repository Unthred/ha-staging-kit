#!/bin/bash
# Shared helpers for ha-staging-sidecar scripts.
set -euo pipefail

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ha-staging-kit-sync: $*"; }

poll_log() {
  log "$@"
  local poll_file="${SIDECAR_DATA:-/sidecar-data}/person-poll.log"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ha-staging-kit-person-poll: $*" >>"$poll_file"
}

strip_cr() {
  local name="$1"
  printf -v "$name" '%s' "${!name//$'\r'/}"
}

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
  STAGING_MQTT_BROKER="${STAGING_MQTT_BROKER:-}"
  STAGING_MQTT_PORT="${STAGING_MQTT_PORT:-1883}"
  STAGING_HA_TYPE="${STAGING_HA_TYPE:-docker}"
  PROD_HA_TYPE="${PROD_HA_TYPE:-ha_os}"
  SKIP_MQTT_PATCH="${SKIP_MQTT_PATCH:-0}"
  OAUTH_PRESERVE_DOMAINS="${OAUTH_PRESERVE_DOMAINS:-smartthings tuya}"
  SKIP_OAUTH_PRESERVE="${SKIP_OAUTH_PRESERVE:-0}"

  GIT_USER_NAME="${GIT_USER_NAME:-ha-staging-kit}"
  GIT_USER_EMAIL="${GIT_USER_EMAIL:-ha-staging-kit@localhost}"

  for v in REPO_DIR HA_CONFIG HA_BRANCH STAGING_HA_URL PERSON_POLL_INTERVAL STORAGE_SYNC_INTERVAL \
    SECRETS_DIR PROD_API_TOKEN_FILE STAGING_API_TOKEN_FILE SSH_KEY_FILE SIDECAR_TEMPLATE \
    HA_SSH HA_SECRETS HA_STORAGE APPLY_ON_START SKIP_STORAGE_SYNC \
    STAGING_MQTT_BROKER STAGING_MQTT_PORT STAGING_HA_TYPE PROD_HA_TYPE SKIP_MQTT_PATCH \
    OAUTH_PRESERVE_DOMAINS SKIP_OAUTH_PRESERVE GIT_USER_NAME GIT_USER_EMAIL; do
    [[ -n "${!v+x}" ]] && strip_cr "$v"
  done
}

ensure_git_identity() {
  local repo="${1:-$REPO_DIR}"
  git -C "$repo" config user.name "$GIT_USER_NAME"
  git -C "$repo" config user.email "$GIT_USER_EMAIL"
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
