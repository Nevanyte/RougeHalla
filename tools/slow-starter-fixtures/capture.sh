#!/usr/bin/env bash
set -euo pipefail
umask 0077
[[ $# == 1 ]] || { echo 'usage: capture.sh NEW_OUTPUT_DIRECTORY' >&2; exit 2; }
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=$1
[[ ! -e "$OUTPUT" ]] || { echo 'Output already exists; retain first outcomes.' >&2; exit 2; }
mkdir -m 700 "$OUTPUT"
OUTPUT=$(cd "$OUTPUT" && pwd)
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
trap 'result=$?; cat "$OUTPUT/capture.log"; exit "$result"' EXIT
docker run --rm --platform linux/amd64 -e RH_CARD_NO_INSPECTOR=1 -e RH_SLOW_STARTER_OUTPUT=/out/source.json \
  --tmpfs /repo:rw,exec,size=1500m \
  --mount "type=bind,src=$REPO,dst=/source,readonly" --mount "type=bind,src=$OUTPUT,dst=/out" \
  -w /repo "$IMAGE" sh -eu -c '
  cp /source/package.json /source/package-lock.json /source/tsconfig.base.json /repo/
  cp -R /source/packages /repo/
  mkdir -p tools parity/card-runtime
  cp -R /source/tools/card-runtime-fixtures /source/tools/slow-starter-fixtures tools/
  cp /source/parity/card-runtime/source.json parity/card-runtime/
  npm ci --ignore-scripts --no-audit --no-fund >/out/npm-ci.log 2>&1
  node --max-old-space-size=4096 --import tsx tools/slow-starter-fixtures/capture.mts
  ' >"$OUTPUT/capture.log" 2>&1
