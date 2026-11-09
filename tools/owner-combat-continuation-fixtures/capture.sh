#!/usr/bin/env bash
# Canonical actual-source owner-combat continuation capture (OWNER_COMBAT_SOURCE_WITNESS bounded continuation),
# pinned linux/amd64 Node 22.23.4.
#   bash tools/owner-combat-continuation-fixtures/capture.sh            # write the two corpora, then check them
#   bash tools/owner-combat-continuation-fixtures/capture.sh --check    # compare byte for byte (output mounted read-only)
# RH_OWNER_COMBAT_CONTINUATION_OUTPUT points the capture elsewhere; the output must stay inside this isolated worktree.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=${1-capture}
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=${RH_OWNER_COMBAT_CONTINUATION_OUTPUT:-$REPO/parity/policy/owner-combat-continuation}
case "$OUTPUT" in "$REPO"/*) ;; *) printf 'refusing an output outside the isolated worktree: %s\n' "$OUTPUT" >&2; exit 2 ;; esac
mkdir -p "$OUTPUT"
OUTPUT=$(cd "$OUTPUT" && pwd)
case "$OUTPUT" in "$REPO"/*) ;; *) printf 'refusing an output outside the isolated worktree: %s\n' "$OUTPUT" >&2; exit 2 ;; esac
MOUNT="type=bind,src=$OUTPUT,dst=/out"
if [ "$MODE" = "--check" ]; then MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"; fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" -e RH_OWNER_COMBAT_CONTINUATION_RECORD \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/owner-combat-continuation-fixtures,dst=/capture,readonly" \
 --mount "$MOUNT" -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 LOADER="--experimental-loader /capture/client-stub-loader.mjs"
 if [ "$MODE" != "--check" ]; then node --import tsx $LOADER /capture/capture.mts --write /out --repo /repo; fi
 node --import tsx $LOADER /capture/capture.mts --check /out --repo /repo
 '
if [ "$MODE" != "--check" ]; then printf 'Captured owner-combat continuation corpora: %s/{producer,human-projection}.json\n' "$OUTPUT"; fi
