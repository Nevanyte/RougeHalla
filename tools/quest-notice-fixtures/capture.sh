#!/usr/bin/env bash
# Canonical actual-source quest notice witness (six bounded producers), pinned linux/amd64 Node 22.23.4 container.
#   bash tools/quest-notice-fixtures/capture.sh            # write parity/quest-notices/source.json
#   bash tools/quest-notice-fixtures/capture.sh --check    # exact bytes (output mounted read-only) + independent verifier
# RH_QUEST_NOTICE_OUTPUT redirects the output directory (used for genuine external write reproduction).
set -eo pipefail
[ $# -le 1 ] || exit 2
MODE=${1-capture}
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
if [ "$MODE" = "--check" ]; then
    OUTPUT=${RH_QUEST_NOTICE_OUTPUT:-$REPO/parity/quest-notices}
    [ -f "$OUTPUT/source.json" ] || { echo "Missing quest notice corpus: $OUTPUT/source.json" >&2; exit 1; }
    OUTPUT=$(cd "$OUTPUT" && pwd)
    OUTPUT_MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"
else
    OUTPUT=${RH_QUEST_NOTICE_OUTPUT:-$REPO/parity/quest-notices}
    mkdir -p "$OUTPUT"
    OUTPUT=$(cd "$OUTPUT" && pwd)
    OUTPUT_MOUNT="type=bind,src=$OUTPUT,dst=/out"
fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/quest-notice-fixtures,dst=/capture,readonly" \
 --mount "$OUTPUT_MOUNT" -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 if [ "$MODE" != "--check" ]; then node --import tsx /capture/capture.mts --write /out/source.json --repo /repo; fi
 node --import tsx /capture/capture.mts --check /out/source.json --repo /repo
 node /capture/verify.mjs /out/source.json /repo
 '
if [ "$MODE" != "--check" ]; then printf 'Captured quest notice corpus: %s\n' "$OUTPUT/source.json"; fi
