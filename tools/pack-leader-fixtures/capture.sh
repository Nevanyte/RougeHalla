#!/usr/bin/env bash
# Pack Leader source-first witness: one bounded actual-source execution per capture, or a REAL read-only byte check.
# The canonical corpus is mounted read-only; --check captures fresh bytes into a task-private /tmp path inside the
# container and compares ALL bytes with cmp (no semantic/provenance stripping). The canonical bytes are never written.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=${1-capture}
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
MOUNTS=(--mount "type=bind,src=$REPO,dst=/repo,readonly")
if [ "$MODE" = "--check" ]; then
  CANON=${RH_PACK_LEADER_CANONICAL_DIRECTORY:-$REPO/parity/pack-leader/repair}
  [ -f "$CANON/source.json" ] || { echo "Missing repaired pack-leader canonical corpus: $CANON/source.json" >&2; exit 1; }
  CANON=$(cd "$CANON" && pwd)
  MOUNTS+=(--mount "type=bind,src=$CANON,dst=/canonical,readonly")
  RUNTIME_OUTPUT=/tmp/pack-leader-check/source.json
else
  OUTPUT=${RH_PACK_LEADER_DIRECTORY:-$(mktemp -d "${TMPDIR:-/tmp}/rh-pack-leader.XXXXXX")}
  mkdir -p "$OUTPUT"
  OUTPUT=$(cd "$OUTPUT" && pwd)
  MOUNTS+=(--mount "type=bind,src=$OUTPUT,dst=/out")
  RUNTIME_OUTPUT=/out/source.json
fi
docker run --rm --platform linux/amd64 -e MODE="$MODE" -e RH_PACK_LEADER_OUTPUT="$RUNTIME_OUTPUT" \
 -e RH_PACK_LEADER_BASE="${RH_PACK_LEADER_BASE:-}" -e RH_PACK_LEADER_CONTROL="${RH_PACK_LEADER_CONTROL:-}" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 "${MOUNTS[@]}" \
 -w /repo "$IMAGE" sh -eu -c '
 mkdir -p /tmp/pack-leader-check
 npm ci --ignore-scripts --no-audit --no-fund >/tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
 node --max-old-space-size=4096 --import tsx tools/pack-leader-fixtures/capture.mts
 if [ "$MODE" = "--check" ]; then
   if ! cmp -s /tmp/pack-leader-check/source.json /canonical/source.json; then
     echo "CHECK-MISMATCH: fresh capture bytes differ from the readonly canonical corpus" >&2
     cmp /tmp/pack-leader-check/source.json /canonical/source.json >&2 || true
     exit 1
   fi
   echo "CHECK-OK: fresh capture reproduces the canonical corpus bytes exactly"
 fi
 '
if [ "$MODE" != "--check" ]; then printf 'Captured pack-leader source: %s/source.json\n' "$OUTPUT"; fi
