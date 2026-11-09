#!/usr/bin/env bash
# Pinned source-only room projection. No old producer corpus is written; no host source is writable in Docker.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=${1-capture}
case "$MODE" in capture|--check|--mutants) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT="$REPO/parity/quest-presentation"
if [ "$MODE" = capture ]; then
  mkdir -p "$OUTPUT"
  OUT_MOUNT="type=bind,src=$OUTPUT,dst=/out"
else
  [ -f "$OUTPUT/source.json" ] || { echo 'missing quest-presentation baseline' >&2; exit 1; }
  OUT_MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"
fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
NAME="rh-quest-presentation-$$"
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if docker container inspect "$NAME" >/dev/null 2>&1; then
    if ! docker rm -f "$NAME" >/dev/null; then status=1; fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
docker run --rm --name "$NAME" --platform linux/amd64 \
  --mount "type=bind,src=$REPO,dst=/source,readonly" \
  --mount "$OUT_MOUNT" --tmpfs /work:rw,exec,size=2000m \
  -w /work "$IMAGE" sh /source/tools/quest-presentation-fixtures/inner.sh "$MODE"
