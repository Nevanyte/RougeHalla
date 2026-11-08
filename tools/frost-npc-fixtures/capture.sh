#!/usr/bin/env bash
# Canonical Linux/x64 witness; --check compares the immutable checked-in corpus.
# The official Node image pins the same Node binary as the original capture.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=${1-capture}
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
if [ "$MODE" = "--check" ]; then
    OUTPUT=${RH_FROST_NPC_OUTPUT:-$REPO/parity/frost-npc}
    [ -f "$OUTPUT/source.json" ] || { echo "Missing corpus: $OUTPUT/source.json" >&2; exit 1; }
    OUTPUT=$(cd "$OUTPUT" && pwd)
    OUTPUT_MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"
else
    OUTPUT=${RH_FROST_NPC_OUTPUT:-$REPO/parity/frost-npc}
    mkdir -p "$OUTPUT"
    OUTPUT=$(cd "$OUTPUT" && pwd)
    OUTPUT_MOUNT="type=bind,src=$OUTPUT,dst=/out"
fi
# docker fetches this immutable official image if it is not cached locally.
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/frost-npc-fixtures,dst=/capture,readonly" \
 --mount "$OUTPUT_MOUNT" -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 if [ "$MODE" != "--check" ]; then node --import tsx /capture/capture.mts; fi
 node --import tsx /capture/capture.mts --check
 '
if [ "$MODE" != "--check" ]; then printf 'Captured Frost NPC corpus: %s/source.json\n' "$OUTPUT"; fi