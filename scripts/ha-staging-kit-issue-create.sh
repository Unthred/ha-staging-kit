#!/bin/bash
# Create a GitHub issue on Unthred/ha-staging-kit and add it to the ha-staging-kit project board (#4).
# Also supports adding existing issues: ha-staging-kit-issue-create.sh --add 10 11
set -euo pipefail

REPO="Unthred/ha-staging-kit"
PROJECT_OWNER="@me"
PROJECT_NUMBER="4"
PROJECT_ID="PVT_kwHOAFM-l84Badqi"
STATUS_FIELD_ID="PVTSSF_lAHOAFM-l84BadqizhVVHP8"
GH_BIN="${GH_BIN:-/tmp/gh}"
DEFAULT_STATUS="Todo"

log() { echo "[ha-staging-kit-issue-create] $*"; }

usage() {
  cat <<'EOF'
Usage:
  ha-staging-kit-issue-create.sh --title TITLE --body BODY [--label LABEL]... [--status STATUS]
  ha-staging-kit-issue-create.sh --add ISSUE_NUM [ISSUE_NUM...] [--status STATUS]

Creates issues on Unthred/ha-staging-kit and adds them to project board #4 (ha-staging-kit).
Default status: Todo. Board statuses: Todo, In Progress, Done.

Use ha-issue-create.sh for HomeAssistant config-repo work (project #2 HA Config Pipeline).

Examples:
  ha-staging-kit-issue-create.sh --title "Fix foo" --body "..." --label enhancement --status Todo
  ha-staging-kit-issue-create.sh --add 10 --status "In Progress"
EOF
}

ensure_auth() {
  if [[ -z "${GH_TOKEN:-}" ]] && [[ -f /boot/config/scripts/github-ha-project.token ]]; then
    GH_TOKEN=$(tr -d '\r\n' < /boot/config/scripts/github-ha-project.token)
    export GH_TOKEN
  fi
  if [[ -z "${GH_TOKEN:-}" ]]; then
    log "ERROR: Set GH_TOKEN or create /boot/config/scripts/github-ha-project.token"
    exit 1
  fi
}

gh_cmd() { "$GH_BIN" "$@"; }

status_option_id() {
  local name="$1"
  gh_cmd project field-list "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json \
    | jq -r --arg n "$name" '.fields[] | select(.name=="Status") | .options[] | select(.name==$n) | .id'
}

add_issue_to_board() {
  local issue_num="$1"
  local status="${2:-$DEFAULT_STATUS}"
  local url="https://github.com/$REPO/issues/$issue_num"
  local item_id option_id

  log "Add #$issue_num to project board"
  if item_id=$(gh_cmd project item-add "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --url "$url" --format json 2>/dev/null | jq -r '.id'); then
    :
  else
    log "Issue may already be on the board — looking up item id"
    item_id=$(gh_cmd project item-list "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json \
      | jq -r --arg n "$issue_num" '.items[] | select(.content.url | endswith("/issues/" + $n)) | .id' | head -1)
    if [[ -z "$item_id" || "$item_id" == "null" ]]; then
      log "ERROR: Could not add or find issue #$issue_num on the board"
      exit 1
    fi
  fi

  option_id=$(status_option_id "$status")
  if [[ -z "$option_id" || "$option_id" == "null" ]]; then
    log "WARN: Unknown status '$status' — card added but status not set"
    return 0
  fi

  gh_cmd project item-edit \
    --id "$item_id" \
    --project-id "$PROJECT_ID" \
    --field-id "$STATUS_FIELD_ID" \
    --single-select-option-id "$option_id" >/dev/null
  log "Issue #$issue_num on board (Status: $status) — $url"
}

TITLE=""
BODY=""
STATUS="$DEFAULT_STATUS"
LABELS=()
ADD_MODE=false
ADD_NUMS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) TITLE="$2"; shift 2 ;;
    --body) BODY="$2"; shift 2 ;;
    --body-file) BODY="$(cat "$2")"; shift 2 ;;
    --label) LABELS+=("$2"); shift 2 ;;
    --status) STATUS="$2"; shift 2 ;;
    --add) ADD_MODE=true; shift; while [[ $# -gt 0 && "$1" != --* ]]; do ADD_NUMS+=("$1"); shift; done ;;
    -h|--help) usage; exit 0 ;;
    *) log "Unknown argument: $1"; usage; exit 1 ;;
  esac
done

ensure_auth

if [[ ! -x "$GH_BIN" ]]; then
  log "ERROR: gh not found at $GH_BIN (run setup-github-ha-project.sh)"
  exit 1
fi

if $ADD_MODE; then
  if [[ ${#ADD_NUMS[@]} -eq 0 ]]; then
    log "ERROR: --add requires at least one issue number"
    exit 1
  fi
  for num in "${ADD_NUMS[@]}"; do
    add_issue_to_board "$num" "$STATUS"
  done
  exit 0
fi

if [[ -z "$TITLE" || -z "$BODY" ]]; then
  log "ERROR: --title and --body are required (or use --add)"
  usage
  exit 1
fi

CREATE_ARGS=(issue create --repo "$REPO" --title "$TITLE" --body "$BODY")
for label in "${LABELS[@]}"; do
  CREATE_ARGS+=(--label "$label")
done

ISSUE_URL=$(gh_cmd "${CREATE_ARGS[@]}")
ISSUE_NUM="${ISSUE_URL##*/}"
log "Created issue #$ISSUE_NUM — $ISSUE_URL"
add_issue_to_board "$ISSUE_NUM" "$STATUS"
