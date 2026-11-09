#!/usr/bin/env bash
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=${1:---check}
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=${RH_BRAIN_PREFIX_OUTPUT:-$REPO/parity/policy/bot-brain-prefix}
mkdir -p "$OUTPUT"
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
MOUNT="type=bind,src=$OUTPUT,dst=/out"
if [ "$MODE" = --check ]; then MOUNT="$MOUNT,readonly"; fi
docker run --rm --platform linux/amd64 -e MODE="$MODE" \
 --mount "type=bind,src=$REPO,dst=/repo" \
 --mount "$MOUNT" -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund >/tmp/npm.log 2>&1 || { cat /tmp/npm.log; exit 1; }
 if [ "$MODE" = capture ]; then node --import tsx tools/bot-brain-prefix-fixtures/capture.mts --write /out/source.json; fi
 node --import tsx tools/bot-brain-prefix-fixtures/capture.mts --check /out/source.json
 '
