#!/usr/bin/env bash
# Canonical actual-source Frozen Justice witness (P-FACTION-5), captured and compared in the pinned Linux/x64 Node
# 22.23.4 container. The corpus is immutable expected output; never regenerate it from Rust.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=${1-capture}
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
if [ "$MODE" = "--check" ]; then
    OUTPUT=${RH_BRUISER_FIXTURE_OUTPUT:-$REPO/parity/bruiser}
    [ -f "$OUTPUT/frozen-justice.json" ] || { echo "Missing Frozen Justice corpus: $OUTPUT/frozen-justice.json" >&2; exit 1; }
    OUTPUT=$(cd "$OUTPUT" && pwd)
    OUTPUT_MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"
else
    OUTPUT=${RH_BRUISER_FIXTURE_OUTPUT:-$(mktemp -d "${TMPDIR:-/tmp}/rh-bruiser-fixtures.XXXXXX")}
    mkdir -p "$OUTPUT"
    OUTPUT=$(cd "$OUTPUT" && pwd)
    OUTPUT_MOUNT="type=bind,src=$OUTPUT,dst=/out"
fi
# docker fetches this immutable official image if it is not cached locally.
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 -e MODE="$MODE" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/bruiser-fixtures,dst=/capture,readonly" \
 --mount "$OUTPUT_MOUNT" -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund > /tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 if [ "$MODE" != "--check" ]; then node --import tsx /capture/capture.mts --write /out/frozen-justice.json; fi
 node --import tsx /capture/capture.mts --check /out/frozen-justice.json
 '
if [ "$MODE" != "--check" ]; then printf 'Captured Frozen Justice corpus: %s/frozen-justice.json\n' "$OUTPUT"; fi
