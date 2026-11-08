#!/usr/bin/env bash
# Canonical actual-source Witness capture for P-WISH-PUBLIC-WITNESS-1, pinned linux/amd64 Node 22.23.4.
#   bash tools/wish-public-fixtures/capture.sh            # write parity/wish-public/*.json
#   bash tools/wish-public-fixtures/capture.sh --check    # compare every byte (output mounted read-only)
# RH_WISH_PUBLIC_OUTPUT redirects the output; it must stay inside this isolated worktree.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=${1-capture}
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=${RH_WISH_PUBLIC_OUTPUT:-$REPO/parity/wish-public}
case "$OUTPUT" in "$REPO"/*) ;; *) printf 'refusing an output outside the isolated worktree: %s\n' "$OUTPUT" >&2; exit 2 ;; esac
mkdir -p "$OUTPUT"
OUTPUT=$(cd "$OUTPUT" && pwd)
case "$OUTPUT" in "$REPO"/*) ;; *) printf 'refusing an output outside the isolated worktree: %s\n' "$OUTPUT" >&2; exit 2 ;; esac
if [ "$MODE" = "--check" ]; then
  for f in r-input.json stock-clocks.json fx-timing.json wishfx-endpoints.json perceive-wish.json manifest.json; do
    [ -f "$OUTPUT/$f" ] || { echo "Missing corpus: $OUTPUT/$f" >&2; exit 1; }
  done
  MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"
else
  MOUNT="type=bind,src=$OUTPUT,dst=/out"
fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/wish-public-fixtures,dst=/capture,readonly" \
 --mount "$MOUNT" -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 LOADER="--experimental-loader /capture/stub-loader.mjs"
 if [ "$MODE" = "--check" ]; then node --import tsx $LOADER /capture/capture.mts --check /out --repo /repo;
 else node --import tsx $LOADER /capture/capture.mts --write /out --repo /repo; fi
 '
if [ "$MODE" != "--check" ]; then printf 'Captured Wish-public corpora: %s/{r-input,stock-clocks,fx-timing,wishfx-endpoints,perceive-wish,manifest}.json\n' "$OUTPUT"; fi
