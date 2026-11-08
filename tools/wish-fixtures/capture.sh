#!/usr/bin/env bash
# Canonical actual-source Wish/ability-policy witness, captured from the unmodified legacy policy in the pinned Linux/x64
# Node 22.23.4 container.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=${1-capture}
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
if [ "$MODE" = "--check" ]; then
    OUTPUT=${RH_WISH_OUTPUT:-$REPO/parity/policy}
    [ -f "$OUTPUT/bot-wish.json" ] || { echo "Missing wish corpus: $OUTPUT/bot-wish.json" >&2; exit 1; }
    OUTPUT=$(cd "$OUTPUT" && pwd)
    OUTPUT_MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"
else
    OUTPUT=${RH_WISH_OUTPUT:-$REPO/parity/policy}
    mkdir -p "$OUTPUT"
    OUTPUT=$(cd "$OUTPUT" && pwd)
    OUTPUT_MOUNT="type=bind,src=$OUTPUT,dst=/out"
fi
# docker fetches this immutable official image if it is not cached locally. This Docker release cannot create a tmpfs
# mountpoint over a read-only repo bind, so the repo is mounted writable: npm ci only writes the ignored node_modules.
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" \
 --mount "type=bind,src=$REPO,dst=/repo" \
 --mount "type=bind,src=$REPO/tools/wish-fixtures,dst=/capture,readonly" \
 --mount "$OUTPUT_MOUNT" -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 if [ "$MODE" != "--check" ]; then node --import tsx /capture/capture.mts --write /out/bot-wish.json; fi
 node --import tsx /capture/capture.mts --check /out/bot-wish.json
 '
if [ "$MODE" != "--check" ]; then printf 'Captured wish corpus: %s/bot-wish.json\n' "$OUTPUT"; fi
