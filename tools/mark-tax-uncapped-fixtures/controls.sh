#!/bin/bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
out=${1:-$repo/docs/evidence/mark-tax-uncapped/controls}
mkdir -p "$repo/node_modules" "$out"
out=$(cd "$out" && pwd)
docker run --rm --pull=never --platform linux/amd64 --memory=3g --cpus=1 \
 --mount "type=bind,src=$repo,dst=/repo,readonly" --mount "type=bind,src=$out,dst=/out" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m --tmpfs /tmp:rw,exec,size=1000m --tmpfs /work:rw,exec,size=250m -w /repo \
 node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292 sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund >/tmp/npm.log 2>&1 || { cat /tmp/npm.log; exit 1; }
 cp /repo/package.json /repo/package-lock.json /repo/tsconfig.base.json /work/
 mkdir -p /work/packages/client /work/tools
 cp /repo/packages/client/package.json /work/packages/client/
 cp -a /repo/packages/server /repo/packages/shared /work/packages/
 cp -a /repo/tools/mark-tax-uncapped-fixtures /work/tools/
 ln -s /repo/node_modules /work/node_modules
 node tools/mark-tax-uncapped-fixtures/controls.mjs'
