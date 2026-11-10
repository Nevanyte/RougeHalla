#!/usr/bin/env bash
# All mutations occur in a disposable container directory. /repo and canonical output are read-only.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=${1:---check}
case "$MODE" in --write|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=${RH_QUEST_TOUR_OUTPUT:-"$REPO/parity/quest-tour-supply"}
OUTPUT=$(cd "$OUTPUT" && pwd)
case "$OUTPUT" in "$REPO"/*) ;; *) echo 'output must resolve inside this worktree' >&2; exit 2 ;; esac
[ -f "$OUTPUT/source.json" ] || exit 1
if [ "$MODE" = --write ]; then MOUNT="type=bind,src=$OUTPUT,dst=/out"; else MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"; fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/quest-tour-supply-fixtures,dst=/capture,readonly" \
 --mount "$MOUNT" -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund >/tmp/rh-quest-tour-npm.log 2>&1 || { cat /tmp/rh-quest-tour-npm.log; exit 1; }
 node /capture/run-mutants.mjs "$MODE"
 '
