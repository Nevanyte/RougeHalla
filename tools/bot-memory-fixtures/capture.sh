#!/usr/bin/env bash
set -euo pipefail
MODE=${1-capture}; case "$MODE" in capture|--check) ;; *) exit 2;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=${RH_BOT_MEMORY_OUTPUT:-$REPO/parity/policy}; mkdir -p "$OUTPUT"; OUTPUT=$(cd "$OUTPUT" && pwd)
MOUNT="type=bind,src=$OUTPUT,dst=/out"; if [ "$MODE" = --check ]; then MOUNT="$MOUNT,readonly"; fi
docker run --rm --platform linux/amd64 -e MODE="$MODE" --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" --mount "$MOUNT" -w /repo \
 node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292 sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund >/tmp/npm-ci.log 2>&1 || { cat /tmp/npm-ci.log; exit 1; }
 if [ "$MODE" != --check ]; then node --import tsx tools/bot-memory-fixtures/capture.mts --write /out/bot-memory-subset.json; fi
 node --import tsx tools/bot-memory-fixtures/capture.mts --check /out/bot-memory-subset.json'
