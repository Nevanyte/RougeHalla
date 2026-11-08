#!/usr/bin/env bash
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=capture; if [ "$#" -eq 1 ]; then MODE="$1"; fi
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT="${RH_SENTENCED_SEAM_A_OUTPUT:-$REPO/parity/sentenced-npc-group}"; mkdir -p "$OUTPUT"; OUTPUT=$(cd "$OUTPUT" && pwd)
if [ "$MODE" = "--check" ]; then MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"; else MOUNT="type=bind,src=$OUTPUT,dst=/out"; fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
mkdir -p "$REPO/node_modules"
docker run --rm --platform linux/amd64 -e MODE="$MODE" --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" --mount "type=bind,src=$REPO/tools/sentenced-npc-group-fixtures,dst=/capture,readonly" --mount "$MOUNT" -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund >/tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 if [ "$MODE" = "--check" ]; then node --import tsx /capture/capture-seam-a.mts --check /out; else node --import tsx /capture/capture-seam-a.mts --write /out; fi'
