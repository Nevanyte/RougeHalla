#!/usr/bin/env bash
# Actual-source walk-hint fixture capture/check/controls. Pinned Node 22.23.4 linux/amd64,
# read-only repo, bounded memory-backed dependencies. No Rust/Cargo/target/native/protocol path.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=capture
if [ "$#" -eq 1 ]; then MODE="$1"; fi
case "$MODE" in capture|--check|controls|--output-guard) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
LEGACY="$REPO/parity/walk-hint"
CANONICAL="$LEGACY/repair"
LEGACY_REAL=$(cd "$LEGACY" && pwd -P)

# Controls output must be fresh, owned and outside Git. Existing caller-selected destinations are
# refused, never removed; the default is a fresh /tmp directory. Canonical corpus paths are refused.
select_control_output() {
  local supplied parent abs tmp
  supplied=$(printenv RH_WALK_HINT_OUTPUT || true)
  if [ -n "$supplied" ]; then
    if [ -e "$supplied" ]; then
      echo "refusing existing controls output: $supplied" >&2
      return 1
    fi
    mkdir -p "$(dirname "$supplied")" || return 1
    parent=$(cd "$(dirname "$supplied")" && pwd -P) || return 1
    abs="$parent/$(basename "$supplied")"
    case "$abs/" in
      "$LEGACY_REAL/"*) echo "refusing controls output inside canonical walk-hint corpus: $abs" >&2; return 1 ;;
    esac
    mkdir -p "$abs" || return 1
    printf '%s\n' "$abs"
    return 0
  fi
  tmp=$(mktemp -d /tmp/walk-hint-controls.XXXXXX) || return 1
  case "$tmp/" in
    "$LEGACY_REAL/"*) echo "refusing controls output inside canonical walk-hint corpus: $tmp" >&2; return 1 ;;
  esac
  printf '%s\n' "$tmp"
}

OUTPUT_ENV=$(printenv RH_WALK_HINT_OUTPUT || true)
case "$MODE" in
  --output-guard)
    select_control_output
    exit $?
    ;;
  --check)
    if [ -n "$OUTPUT_ENV" ]; then OUTPUT="$OUTPUT_ENV"; else OUTPUT="$CANONICAL"; fi
    [ -f "$OUTPUT/source.json" ] || { echo "Missing repair corpus: $OUTPUT/source.json" >&2; exit 1; }
    OUTPUT=$(cd "$OUTPUT" && pwd); MOUNT="type=bind,src=$OUTPUT,dst=/out,readonly"
    ;;
  controls)
    OUTPUT=$(select_control_output) || exit 1
    OUTPUT=$(cd "$OUTPUT" && pwd); MOUNT="type=bind,src=$OUTPUT,dst=/out"
    ;;
  *)
    if [ -n "$OUTPUT_ENV" ]; then OUTPUT="$OUTPUT_ENV"; else OUTPUT="$CANONICAL"; fi
    mkdir -p "$OUTPUT"; OUTPUT=$(cd "$OUTPUT" && pwd); MOUNT="type=bind,src=$OUTPUT,dst=/out"
    ;;
esac
IMAGE=node@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
BASE=$(printenv RH_WALK_HINT_BASE || true)
[ -n "$BASE" ] || BASE=db5ed80b2b89a156eae09cd0bd3f4c9e77e9e6de
docker run --rm --platform linux/amd64 \
  -e RH_WALK_HINT_MODE="$MODE" -e RH_WALK_HINT_OUTPUT=/out -e RH_WALK_HINT_BASE="$BASE" -e RH_WALK_HINT_IMAGE="$IMAGE" \
  --tmpfs /repo/node_modules:rw,exec,size=1500m \
  --mount "type=bind,src=$REPO,dst=/repo,readonly" \
  --mount "$MOUNT" -w /repo "$IMAGE" sh -eu -c '
  npm ci --ignore-scripts --no-audit --no-fund >/tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
  if [ "$RH_WALK_HINT_MODE" = "controls" ]; then
    node --import tsx /repo/tools/walk-hint-fixtures/controls.mts
  else
    node --import tsx /repo/tools/walk-hint-fixtures/capture.mts
    node /repo/tools/walk-hint-fixtures/verify.mjs /out
  fi
'
if [ "$MODE" = "capture" ]; then printf 'Wrote walk-hint repair corpus: %s/source.json\n' "$OUTPUT"; fi
if [ "$MODE" = "controls" ]; then printf 'Wrote walk-hint controls: %s/controls.json\n' "$OUTPUT"; fi
