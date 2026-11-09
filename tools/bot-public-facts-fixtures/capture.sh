#!/usr/bin/env bash
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=${1-capture}
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$REPO/node_modules"
OUTPUT=${RH_BOT_PUBLIC_OUTPUT:-$REPO/parity/policy/bot-public-facts}
mkdir -p "$OUTPUT"
OUTPUT=$(cd "$OUTPUT" && pwd)
OUT="type=bind,src=$OUTPUT,dst=/out"
if [ "$MODE" = --check ]; then OUT="$OUT,readonly"; fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" --mount "$OUT" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m --tmpfs /tmp:rw,exec,size=1500m \
 -e npm_config_cache=/tmp/npm-cache -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund >/tmp/npm.log 2>&1 || { cat /tmp/npm.log; exit 1; }
 if [ "$MODE" != --check ]; then node --import tsx tools/bot-public-facts-fixtures/capture.mts --write /out/source.json; fi
 node --import tsx tools/bot-public-facts-fixtures/capture.mts --check /out/source.json
 '
