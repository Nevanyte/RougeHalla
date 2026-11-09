#!/usr/bin/env bash
# Actual-source walk-hint fixture capture/check. Pinned Node 22.23.4 linux/amd64, read-only repo,
# bounded memory-backed dependencies. No Rust/Cargo/target/native/protocol path.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=capture
if [ "$#" -eq 1 ]; then MODE="$1"; fi
case "$MODE" in capture|--check|controls) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=$(printenv RH_WALK_HINT_OUTPUT || true)
if [ -z "$OUTPUT" ]; then OUTPUT="$REPO/parity/walk-hint"; fi
if [ "$MODE" = "--check" ]; then
  [ -f "$OUTPUT/source.json" ] || { echo "Missing walk-hint corpus: $OUTPUT/source.json" >&2; exit 1; }
  OUTPUT=$(cd "$OUTPUT" && pwd); MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"
elif [ "$MODE" = "controls" ]; then
  if [ -z "$OUTPUT" ]; then OUTPUT=/tmp/walk-hint-controls; fi
  rm -rf "$OUTPUT"; mkdir -p "$OUTPUT"; OUTPUT=$(cd "$OUTPUT" && pwd); MOUNT="type=bind,src=$OUTPUT,dst=/out"
else
  mkdir -p "$OUTPUT"; OUTPUT=$(cd "$OUTPUT" && pwd); MOUNT="type=bind,src=$OUTPUT,dst=/out"
fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
BASE=$(printenv RH_WALK_HINT_BASE || true)
[ -n "$BASE" ] || BASE=db5ed80b2b89a156eae09cd0bd3f4c9e77e9e6de
docker run --rm --platform linux/amd64 \
  -e RH_WALK_HINT_MODE="$MODE" -e RH_WALK_HINT_OUTPUT=/out -e RH_WALK_HINT_BASE="$BASE" -e RH_WALK_HINT_IMAGE="$IMAGE" \
  --tmpfs /repo/node_modules:rw,exec,size=1500m \
  --mount "type=bind,src=$REPO,dst=/repo,readonly" \
  --mount "$MOUNT" -w /repo "$IMAGE" sh -eu -c '
  npm ci --ignore-scripts --no-audit --no-fund >/tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
  if [ "$RH_WALK_HINT_MODE" = "controls" ]; then
    node --import tsx /repo/tools/walk-hint-fixtures/controls.mts
  else
    node --import tsx /repo/tools/walk-hint-fixtures/capture.mts
    node /repo/tools/walk-hint-fixtures/verify.mjs /out
  fi
'
if [ "$MODE" = "capture" ]; then printf 'Wrote walk-hint corpus: %s/source.json\n' "$OUTPUT"; fi
if [ "$MODE" = "controls" ]; then printf 'Wrote walk-hint controls: %s/controls.json\n' "$OUTPUT"; fi