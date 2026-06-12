#!/bin/bash
# Create local data dirs and seed sidecar config from examples.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
SIDECAR_DATA="${SIDECAR_DATA:-$ROOT/data/sidecar}"
MIRROR_DATA="${MIRROR_DATA:-$ROOT/data/mirror}"
SECRETS="$SIDECAR_DATA/secrets"

mkdir -p "$SECRETS" "$MIRROR_DATA"/{config/conf.d,data,log}
chmod 700 "$SECRETS"

[[ -f "$SIDECAR_DATA/config.env" ]] || install -m 600 "$ROOT/sidecar/config.env.example" "$SIDECAR_DATA/config.env"
for f in ha-prod-api.token.example ha-staging-api.token.example; do
  [[ -f "$SECRETS/$f" ]] || cp "$ROOT/sidecar/secrets/$f" "$SECRETS/"
done

echo "Initialized $SIDECAR_DATA and $MIRROR_DATA"
echo "Edit $SIDECAR_DATA/config.env and secrets/*.token before starting compose."
