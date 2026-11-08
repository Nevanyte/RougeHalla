#!/usr/bin/env bash
# Canonical actual-source fair-view foundation witness (P-BOTS-1 remainder), pinned linux/amd64 Node 22.23.4.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=${1-capture}
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=${RH_PERCEPTION_OUTPUT:-$REPO/parity/policy}
mkdir -p "$OUTPUT"
OUTPUT=$(cd "$OUTPUT" && pwd)
MOUNT="type=bind,src=$OUTPUT,dst=/out"
if [ "$MODE" = "--check" ]; then MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"; fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/perception-fixtures,dst=/capture,readonly" \
 --mount "$MOUNT" -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 if [ "$MODE" != "--check" ]; then node --import tsx /capture/capture.mts --write /out/bot-perception.json; fi
 node --import tsx /capture/capture.mts --check /out/bot-perception.json
 '
if [ "$MODE" != "--check" ]; then printf 'Captured perception corpus: %s/bot-perception.json\n' "$OUTPUT"; fi
