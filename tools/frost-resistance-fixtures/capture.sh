#!/usr/bin/env bash
# Pinned linux/amd64 Node22.23.4 actual-source capture for the native Frost slow-resistance correction.
# Writes/checks ONLY parity/frost-resistance/source.json; existing frost fixtures are read-only.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=capture
if [ "$#" -ge 1 ]; then MODE=$1; fi
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=$REPO/parity/frost-resistance
if printenv RH_FROST_RESISTANCE_OUTPUT >/dev/null 2>&1; then OUTPUT=$(printenv RH_FROST_RESISTANCE_OUTPUT); fi
mkdir -p "$OUTPUT"
OUTPUT=$(cd "$OUTPUT" && pwd)
MOUNT="type=bind,src=$OUTPUT,dst=/out"
if [ "$MODE" = "--check" ]; then MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"; fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/frost-resistance-fixtures,dst=/capture,readonly" \
 --mount "$MOUNT" -w /repo "$IMAGE" sh -eu -c '
 rm -rf /tmp/rh-frost-resistance-capture
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 if [ "$MODE" != "--check" ]; then node --import tsx /capture/capture.mts --write /out/source.json; fi
 node --import tsx /capture/capture.mts --check /out/source.json
 '
if [ "$MODE" != "--check" ]; then printf "Captured Frost-resistance source corpus: %s/source.json\n" "$OUTPUT"; fi
