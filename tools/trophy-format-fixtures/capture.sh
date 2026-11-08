#!/usr/bin/env bash
# Canonical actual-source P-TROPHY-NATIVE-CONSUMER-1 formatting corpus: one execution per capture or check.
# The output is guarded to this worktree; --check mounts it read-only and requires byte-identical output.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE="${1:-capture}"
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT="${RH_TROPHY_FORMAT_OUTPUT:-$REPO/parity/trophy-format}"
mkdir -p "$OUTPUT"
OUTPUT=$(cd "$OUTPUT" && pwd)
case "$OUTPUT" in
  "$REPO"/*) ;;
  *) echo "refusing output outside the worktree: $OUTPUT" >&2; exit 3 ;;
esac
if [ "$MODE" = "--check" ]; then
  [ -f "$OUTPUT/format.json" ] || { echo "Missing trophy-format corpus" >&2; exit 1; }
  OUTPUT_MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"
else
  OUTPUT_MOUNT="type=bind,src=$OUTPUT,dst=/out"
fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" -e RH_TROPHY_FORMAT_OUTPUT=/out \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" --mount "$OUTPUT_MOUNT" \
 -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund >/tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 if [ "$MODE" = "--check" ]; then node --import tsx tools/trophy-format-fixtures/capture.mts --check "$RH_TROPHY_FORMAT_OUTPUT";
 else node --import tsx tools/trophy-format-fixtures/capture.mts --write "$RH_TROPHY_FORMAT_OUTPUT"; fi
 '
if [ "$MODE" != "--check" ]; then printf 'Captured trophy-format source corpus: %s/format.json\n' "$OUTPUT"; fi
