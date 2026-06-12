#!/bin/bash
set -euo pipefail
SIDECAR_ROOT="/sidecar"
# shellcheck source=lib/common.sh
source "$SIDECAR_ROOT/lib/common.sh"
load_config
exec "$SIDECAR_ROOT/sbin/run.sh"
