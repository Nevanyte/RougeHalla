#!/usr/bin/env bash
# Canonical Linux/x64 loot-world runtime witness; --check compares the immutable checked-in corpus.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=${1-capture}
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
if [ "$MODE" = "--check" ]; then
  OUTPUT=${RH_LOOT_WORLD_DIRECTORY:-$REPO/parity/loot-world}
  [ -f "$OUTPUT/source.json" ] || { echo "Missing corpus: $OUTPUT/source.json" >&2; exit 1; }
  OUTPUT=$(cd "$OUTPUT" && pwd)
  OUTPUT_MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"
else
  OUTPUT=${RH_LOOT_WORLD_DIRECTORY:-$(mktemp -d "${TMPDIR:-/tmp}/rh-loot-world.XXXXXX")}
  mkdir -p "$OUTPUT"
  OUTPUT=$(cd "$OUTPUT" && pwd)
  OUTPUT_MOUNT="type=bind,src=$OUTPUT,dst=/out"
fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" -e RH_LOOT_WORLD_OUTPUT=/out/source.json \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "$OUTPUT_MOUNT" -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 if [ "$MODE" != "--check" ]; then node --import tsx tools/loot-world-fixtures/capture.mts; fi
 node --import tsx tools/loot-world-fixtures/capture.mts --check
 '
if [ "$MODE" != "--check" ]; then printf 'Captured corpus: %s/source.json\n' "$OUTPUT"; fi
