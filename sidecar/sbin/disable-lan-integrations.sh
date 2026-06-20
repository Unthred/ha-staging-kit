#!/bin/bash
# Back-compat wrapper — use quiesce-staging-integrations.sh (LAN + staging-unsafe domains).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/quiesce-staging-integrations.sh"
