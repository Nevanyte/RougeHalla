#!/usr/bin/env bash
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=${1:---check}
case "$MODE" in --write|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=${RH_MODULE_KEY_OUTPUT:-"$REPO/parity/policy/bot-module-goal-key"}
OUTPUT=$(cd "$OUTPUT" && pwd)
case "$OUTPUT" in "$REPO"/*) ;; *) exit 2 ;; esac
if [ "$MODE" = --write ]; then MOUNT="type=bind,src=$OUTPUT,dst=/out"; else MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"; fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/bot-module-goal-key-fixtures,dst=/capture,readonly" \
 --mount "$MOUNT" -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund >/tmp/rh-module-key-npm.log 2>&1 || { cat /tmp/rh-module-key-npm.log; exit 1; }
 node /capture/controls.mjs "$MODE"
 '
