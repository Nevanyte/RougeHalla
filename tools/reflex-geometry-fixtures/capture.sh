#!/usr/bin/env bash
# Actual-source reflex geometry capture/check/controls. Pinned Node 22.23.4 Linux amd64; source repo
# mounted read-only; output mount writable for write/controls and read-only for --check. No source edit.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=capture
if [ "$#" -eq 1 ]; then MODE="$1"; fi
case "$MODE" in capture|--check|controls) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=$(printenv RH_REFLEX_GEOMETRY_OUTPUT || true)
case "$MODE" in
  --check)
    [ -n "$OUTPUT" ] || OUTPUT="$REPO/parity/policy/reflex-geometry"
    [ -f "$OUTPUT/source.json" ] || { echo "Missing source corpus: $OUTPUT/source.json" >&2; exit 1; }
    OUTPUT=$(cd "$OUTPUT" && pwd); MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly" ;;
  controls)
    [ -n "$OUTPUT" ] || OUTPUT=/tmp/reflex-geometry-controls
    rm -rf "$OUTPUT"; mkdir -p "$OUTPUT"; OUTPUT=$(cd "$OUTPUT" && pwd)
    MOUNT="type=bind,src=$OUTPUT,dst=/out" ;;
  *)
    [ -n "$OUTPUT" ] || OUTPUT="$REPO/parity/policy/reflex-geometry"
    mkdir -p "$OUTPUT"; OUTPUT=$(cd "$OUTPUT" && pwd); MOUNT="type=bind,src=$OUTPUT,dst=/out" ;;
esac
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
MUTATION=$(printenv RH_REFLEX_GEOMETRY_MUTATION || true)
BASE=$(printenv RH_REFLEX_GEOMETRY_BASE || true)
[ -n "$BASE" ] || BASE=a0c4818ce9df8ad0f4124db31e65ba1244bddc3b
docker run --rm --platform linux/amd64 \
  -e RH_REFLEX_GEOMETRY_MODE="$MODE" \
  -e RH_REFLEX_GEOMETRY_OUTPUT=/out \
  -e RH_REFLEX_GEOMETRY_BASE="$BASE" \
  -e RH_REFLEX_GEOMETRY_IMAGE="$IMAGE" \
  -e RH_REFLEX_GEOMETRY_MUTATION="$MUTATION" \
  --tmpfs /repo/node_modules:rw,exec,size=1500m \
  --mount "type=bind,src=$REPO,dst=/repo,readonly" \
  --mount "$MOUNT" -w /repo "$IMAGE" sh -eu -c '
  npm ci --ignore-scripts --no-audit --no-fund >/tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
  node --import tsx /repo/tools/reflex-geometry-fixtures/capture.mts
'
if [ "$MODE" = "capture" ]; then printf 'Wrote reflex geometry corpus: %s/source.json\n' "$OUTPUT"; fi
if [ "$MODE" = "controls" ]; then printf 'Wrote reflex geometry controls: %s/controls.json\n' "$OUTPUT"; fi
