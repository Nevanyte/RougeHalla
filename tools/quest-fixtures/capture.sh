#!/usr/bin/env bash
# Canonical actual-source quest witnesses (pinned linux/amd64 Node 22.23.4 container): the data layer (catalog, roster,
# placement and reward rules) and the lifecycle (spawn, accept, reveal, pickups/carriers, turn-in rewards, expiry, the real
# player kill and the coliseum teleport close). Capture writes both corpora; --check requires the checked-in bytes.
set -eo pipefail
[ "$#" -le 1 ] || exit 2
MODE="$1"
[ -n "$MODE" ] || MODE=capture
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
if [ "$MODE" = "--check" ]; then
    OUTPUT="$RH_QUEST_OUTPUT"
    [ -n "$OUTPUT" ] || OUTPUT="$REPO/parity/quests"
    [ -f "$OUTPUT/data.json" ] || { echo "Missing quest corpus: $OUTPUT/data.json" >&2; exit 1; }
    [ -f "$OUTPUT/lifecycle.json" ] || { echo "Missing quest corpus: $OUTPUT/lifecycle.json" >&2; exit 1; }
    OUTPUT=$(cd "$OUTPUT" && pwd)
    OUTPUT_MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"
else
    OUTPUT="$RH_QUEST_OUTPUT"
    if [ -z "$OUTPUT" ]; then
        if [ -z "$TMPDIR" ]; then TMP=/tmp; else TMP="$TMPDIR"; fi
        OUTPUT=$(mktemp -d "$TMP/rh-quest.XXXXXX")
    fi
    mkdir -p "$OUTPUT"
    OUTPUT=$(cd "$OUTPUT" && pwd)
    OUTPUT_MOUNT="type=bind,src=$OUTPUT,dst=/out"
fi
# docker fetches this immutable official image if it is not cached locally.
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/quest-fixtures,dst=/capture,readonly" \
 --mount "$OUTPUT_MOUNT" -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 if [ "$MODE" != "--check" ]; then node --import tsx /capture/capture.mts --write /out/data.json; fi
 node --import tsx /capture/capture.mts --check /out/data.json
 if [ "$MODE" != "--check" ]; then node --import tsx /capture/lifecycle.mts --write /out/lifecycle.json; fi
 node --import tsx /capture/lifecycle.mts --check /out/lifecycle.json
 '
if [ "$MODE" != "--check" ]; then printf 'Captured quest corpora: %s/{data,lifecycle}.json\n' "$OUTPUT"; fi
