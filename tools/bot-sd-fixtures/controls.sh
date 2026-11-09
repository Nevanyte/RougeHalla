#!/usr/bin/env bash
set -euo pipefail
[ "$#" -eq 1 ] || exit 2
REPO=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$REPO/node_modules" "$1"
OUTPUT=$(cd "$1" && pwd)
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" --mount "type=bind,src=$OUTPUT,dst=/out" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m --tmpfs /tmp:rw,exec,size=1500m --tmpfs /work:rw,exec,size=500m \
 -e npm_config_cache=/tmp/npm-cache -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund >/tmp/npm.log 2>&1 || { cat /tmp/npm.log; exit 1; }
 node tools/bot-sd-fixtures/controls.mjs
 '
