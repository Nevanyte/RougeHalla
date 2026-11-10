#!/usr/bin/env bash
set -euo pipefail
MODE=${1:-capture}
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=${RH_BOT_MODULES_OUTPUT:-"$REPO/parity/policy/bot-private-modules"}
case "$OUTPUT" in "$REPO"/*) ;; *) exit 2 ;; esac
mkdir -p "$OUTPUT"
if [ "$MODE" = --check ]; then MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"; else MOUNT="type=bind,src=$OUTPUT,dst=/out"; fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/bot-private-modules-fixtures,dst=/capture,readonly" \
 --mount "$MOUNT" -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund >/tmp/rh-modules-npm.log 2>&1 || { cat /tmp/rh-modules-npm.log; exit 1; }
 if [ "$MODE" = capture ]; then node --import tsx /capture/capture.mts --write /out; fi
 node --import tsx /capture/capture.mts --check /out
 '
