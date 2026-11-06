#!/usr/bin/env bash
set -euo pipefail
STATUS_REPO=$(cd "$(dirname "$0")/../.." && pwd)
STATUS_PREFIX=${RH_STATUS_PREFIX:-/Users/nevinmckinnon/.codex/tools/rougehalla-stage2}
STATUS_OUTPUT=${RH_STATUS_V3_OUTPUT:-$STATUS_PREFIX/status-source-work-v3/output}
STATUS_MODE=${1:-capture}
case "$STATUS_MODE" in capture|--check) ;; *) exit 2 ;; esac
mkdir -p "$STATUS_OUTPUT"
docker run --rm --pull=never --platform linux/amd64 -e STATUS_MODE="$STATUS_MODE" \
  --tmpfs /repo/node_modules:rw,exec,size=1500m \
  --mount "type=bind,src=$STATUS_REPO,dst=/repo,readonly" \
  --mount "type=bind,src=$STATUS_PREFIX/sentenced-capture/node-v22.23.4-linux-x64,dst=/node,readonly" \
  --mount "type=bind,src=$STATUS_OUTPUT,dst=/out" -w /repo c86ecead9e55 sh -eu -c '
  npm ci --ignore-scripts --no-audit --no-fund > /out/npm-ci.log 2>&1
  if [ "$STATUS_MODE" != "--check" ]; then /node/bin/node --import tsx tools/status-fixtures/capture-v3.ts --output=/out/boundaries-v3.json; fi
  /node/bin/node --import tsx tools/status-fixtures/capture-v3.ts --output=/out/boundaries-v3.json --check
'
