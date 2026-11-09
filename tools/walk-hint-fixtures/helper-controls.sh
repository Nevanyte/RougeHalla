#!/usr/bin/env bash
# Helper compiled-control runner. Fresh outside-Git output only; never removes caller/canonical dirs.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
LEGACY="$REPO/parity/walk-hint"
if [ -n "$(printenv RH_WALK_HINT_OUTPUT || true)" ]; then
  OUT=$(printenv RH_WALK_HINT_OUTPUT)
  if [ -e "$OUT" ]; then echo "refusing existing helper controls output: $OUT" >&2; exit 1; fi
  mkdir -p "$(dirname "$OUT")"; PARENT=$(cd "$(dirname "$OUT")" && pwd -P); OUT="$PARENT/$(basename "$OUT")"
else
  OUT=$(mktemp -d /tmp/walk-hint-helper-controls.XXXXXX)
fi
case "$OUT/" in
  "$LEGACY/"*) echo "refusing helper controls output inside canonical walk-hint: $OUT" >&2; exit 1 ;;
esac
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)
IMAGE=node@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
BASE=$(printenv RH_WALK_HINT_BASE || true)
[ -n "$BASE" ] || BASE=2547a1c5766a8046aa725f5f3b3b38d244c38371
docker run --rm --platform linux/amd64 \
  -e RH_WALK_HINT_OUTPUT=/out -e RH_WALK_HINT_BASE="$BASE" -e RH_WALK_HINT_IMAGE="$IMAGE" \
  --tmpfs /repo/node_modules:rw,exec,size=1500m \
  --mount "type=bind,src=$REPO,dst=/repo,readonly" \
  --mount "type=bind,src=$OUT,dst=/out" -w /repo "$IMAGE" sh -eu -c '
  npm ci --ignore-scripts --no-audit --no-fund >/tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
  node --import tsx /repo/tools/walk-hint-fixtures/helper-controls.mts
'
printf 'Wrote helper controls: %s/controls.json\n' "$OUT"
