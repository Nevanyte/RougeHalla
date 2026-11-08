#!/usr/bin/env bash
# Canonical actual-source neutral-trader witness (spawn/placement, wandering, the broker's stat offers and one exchange,
# and the barter villager's three trades with their cooldown/refusals). Capture and compare each execute once in the pinned
# Linux/x64 Node 22.23.4 container.
set -eo pipefail
[ "$#" -le 1 ] || exit 2
MODE="$1"
[ -n "$MODE" ] || MODE=capture
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
if [ "$MODE" = "--check" ]; then
    OUTPUT="$RH_TRADE_OUTPUT"
    [ -n "$OUTPUT" ] || OUTPUT="$REPO/parity/trade"
    [ -f "$OUTPUT/runtime.json" ] || { echo "Missing trade corpus: $OUTPUT/runtime.json" >&2; exit 1; }
    OUTPUT=$(cd "$OUTPUT" && pwd)
    OUTPUT_MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"
else
    OUTPUT="$RH_TRADE_OUTPUT"
    if [ -z "$OUTPUT" ]; then
        if [ -z "$TMPDIR" ]; then TMP=/tmp; else TMP="$TMPDIR"; fi
        OUTPUT=$(mktemp -d "$TMP/rh-trade.XXXXXX")
    fi
    mkdir -p "$OUTPUT"
    OUTPUT=$(cd "$OUTPUT" && pwd)
    OUTPUT_MOUNT="type=bind,src=$OUTPUT,dst=/out"
fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/trade-fixtures,dst=/capture,readonly" \
 --mount "$OUTPUT_MOUNT" -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 if [ "$MODE" != "--check" ]; then node --import tsx /capture/capture.mts --write /out/runtime.json; fi
 node --import tsx /capture/capture.mts --check /out/runtime.json
 '
if [ "$MODE" != "--check" ]; then printf 'Captured trade corpus: %s/runtime.json\n' "$OUTPUT"; fi
