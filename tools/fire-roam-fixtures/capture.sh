#!/usr/bin/env bash
# Capture the Fire roam slice in the pinned Linux x64 Node 22.23.4 container.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
PREFIX=${RH_FIRE_ROAM_PREFIX:-/Users/nevinmckinnon/.codex/tools/rougehalla-stage2}
OUT=${RH_FIRE_ROAM_OUT:-$PREFIX/fire-roam-capture}
PKG=${RH_FIRE_ROAM_PKG:-$PREFIX/fire-roam-capture/packages}
mkdir -p "$OUT" "$PKG"
docker run --rm --pull=never --platform linux/amd64 \
  --tmpfs /repo/node_modules:rw,exec,size=1500m \
  --mount "type=bind,src=$REPO,dst=/repo,readonly" \
  --mount "type=bind,src=$PREFIX/sentenced-capture/node-v22.23.4-linux-x64,dst=/node,readonly" \
  --mount "type=bind,src=$OUT,dst=/out" \
  --mount "type=bind,src=$PKG,dst=/pkgcache" \
  -w /repo c86ecead9e55 sh -eu -c '
    export npm_config_cache=/pkgcache
    npm ci --ignore-scripts --no-audit --no-fund > /out/npm-ci.log 2>&1
    /node/bin/node --import tsx parity/legacy-capture/capture.ts --out /out --only fire_roam_charge_burst
    /node/bin/node --import tsx parity/legacy-capture/capture.ts --out /out --only fire_roam_ranged_arm
    /node/bin/node --import tsx tools/fire-roam-fixtures/helpers.ts /out/helpers.json
  '
echo "captured: $OUT"
