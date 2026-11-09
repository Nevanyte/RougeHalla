#!/bin/bash
set -euo pipefail
mode=${1-capture}
case "$mode" in capture|--check) ;; *) exit 2 ;; esac
repo=$(cd "$(dirname "$0")/../.." && pwd)
out=${RH_MARK_TAX_OUTPUT:-$repo/parity/mark-tax-uncapped}
mkdir -p "$repo/node_modules" "$out"
out=$(cd "$out" && pwd)
mount="type=bind,src=$out,dst=/out"
if test "$mode" = --check; then mount="$mount,readonly"; fi
docker run --rm --pull=never --platform linux/amd64 --memory=3g --cpus=1 \
 --mount "type=bind,src=$repo,dst=/repo,readonly" --mount "$mount" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m --tmpfs /tmp:rw,exec,size=1200m -e MODE="$mode" -w /repo \
 node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292 sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund >/tmp/npm.log 2>&1 || { cat /tmp/npm.log; exit 1; }
 if test "$MODE" != --check; then node --import tsx tools/mark-tax-uncapped-fixtures/capture.mts --write /out/source.json; fi
 node --import tsx tools/mark-tax-uncapped-fixtures/capture.mts --check /out/source.json'
