#!/usr/bin/env bash
# Thin wrapper around kit release-agent HTTP API.
set -euo pipefail

KIT_URL="${KIT_URL:-http://127.0.0.1:8081}"
GIT_REF="${GIT_REF:-origin/main}"

cmd="${1:-plan}"
shift || true

case "$cmd" in
  plan)
    curl -sS "${KIT_URL}/api/release-agent/plan?gitRef=${GIT_REF}" | jq .
    ;;
  history)
    curl -sS "${KIT_URL}/api/release-agent/history" | jq .
    ;;
  apply)
    msg=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --ref) GIT_REF="$2"; shift 2 ;;
        --message) msg="$2"; shift 2 ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
      esac
    done
    body=$(jq -n --arg ref "$GIT_REF" --arg msg "$msg" '{gitRef:$ref, message: ($msg | select(length>0))}')
    curl -sS -X POST "${KIT_URL}/api/release-agent/apply" \
      -H 'Content-Type: application/json' \
      -d "$body" | jq .
    ;;
  rollback)
    steps=""
    to_sha=""
    to_index=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --steps) steps="$2"; shift 2 ;;
        --to-sha) to_sha="$2"; shift 2 ;;
        --to-index) to_index="$2"; shift 2 ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
      esac
    done
    body=$(jq -n \
      --argjson steps "${steps:-null}" \
      --arg toSha "$to_sha" \
      --argjson toIndex "${to_index:-null}" \
      '{steps:$steps, toSha: ($toSha | select(length>0)), toIndex:$toIndex}')
    curl -sS -X POST "${KIT_URL}/api/release-agent/rollback" \
      -H 'Content-Type: application/json' \
      -d "$body" | jq .
    ;;
  *)
    echo "Usage: $0 {plan|apply|history|rollback} [options]" >&2
    exit 1
    ;;
esac
