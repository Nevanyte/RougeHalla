#!/usr/bin/env bash
# Canonical actual-source quest human-eligibility witness (P-QUEST-HUMAN-ELIGIBILITY), pinned linux/amd64 Node 22.23.4.
#   bash tools/quest-human-eligibility-fixtures/capture.sh            # write parity/quest-human-eligibility/*.json
#   bash tools/quest-human-eligibility-fixtures/capture.sh --check    # compare every byte twice (output mounted read-only)
# RH_QUEST_HUMAN_OUTPUT redirects the output; it must stay inside this isolated worktree.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
if [ "$#" -eq 1 ]; then MODE="$1"; else MODE=capture; fi
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=$(printenv RH_QUEST_HUMAN_OUTPUT || true)
if [ -z "$OUTPUT" ]; then OUTPUT="$REPO/parity/quest-human-eligibility"; fi
case "$OUTPUT" in "$REPO"/*) ;; *) printf 'refusing an output outside the isolated worktree: %s\n' "$OUTPUT" >&2; exit 2 ;; esac
mkdir -p "$OUTPUT"
OUTPUT=$(cd "$OUTPUT" && pwd)
case "$OUTPUT" in "$REPO"/*) ;; *) printf 'refusing an output outside the isolated worktree: %s\n' "$OUTPUT" >&2; exit 2 ;; esac
if [ "$MODE" = "--check" ]; then
  for f in ordinary.json diagnostic.json manifest.json; do
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
 --mount "type=bind,src=$REPO/tools/quest-human-eligibility-fixtures,dst=/capture,readonly" \
 --mount "$MOUNT" -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 if [ "$MODE" = "--write" ] || [ "$MODE" = "capture" ]; then
   node --import tsx /capture/capture.mts --write /out
 fi
 echo "capture check 1/2"
 node --import tsx /capture/capture.mts --check /out
 echo "capture check 2/2"
 node --import tsx /capture/capture.mts --check /out
 '
if [ "$MODE" != "--check" ]; then printf 'Captured quest human-eligibility corpora: %s/{ordinary,diagnostic,manifest}.json\n' "$OUTPUT"; fi