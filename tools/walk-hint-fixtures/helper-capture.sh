#!/usr/bin/env bash
# Helper corpus capture/check. Pinned recovered Node image; repo read-only; bounded deps.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=capture
if [ "$#" -eq 1 ]; then MODE="$1"; fi
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=$(printenv RH_WALK_HINT_OUTPUT || true)
[ -n "$OUTPUT" ] || OUTPUT="$REPO/parity/walk-hint/helpers"
if [ "$MODE" = "--check" ]; then
  [ -f "$OUTPUT/source.json" ] || { echo "Missing helper corpus: $OUTPUT/source.json" >&2; exit 1; }
  OUTPUT=$(cd "$OUTPUT" && pwd); MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"
else
  mkdir -p "$OUTPUT"; OUTPUT=$(cd "$OUTPUT" && pwd); MOUNT="type=bind,src=$OUTPUT,dst=/out"
fi
IMAGE=node@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
HELPER_DEBUG=$(printenv RH_HELPER_DEBUG || true)
BASE=$(printenv RH_WALK_HINT_BASE || true)
[ -n "$BASE" ] || BASE=2547a1c5766a8046aa725f5f3b3b38d244c38371
docker run --rm --platform linux/amd64 \
  -e RH_WALK_HINT_MODE="$MODE" -e RH_WALK_HINT_OUTPUT=/out -e RH_WALK_HINT_BASE="$BASE" -e RH_WALK_HINT_IMAGE="$IMAGE" -e RH_HELPER_DEBUG="$HELPER_DEBUG" \
  --tmpfs /repo/node_modules:rw,exec,size=1500m \
  --mount "type=bind,src=$REPO,dst=/repo,readonly" \
  --mount "$MOUNT" -w /repo "$IMAGE" sh -eu -c '
  npm ci --ignore-scripts --no-audit --no-fund >/tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
  node --import tsx /repo/tools/walk-hint-fixtures/helper-capture.mts
  node /repo/tools/walk-hint-fixtures/helper-verify.mjs /out
'