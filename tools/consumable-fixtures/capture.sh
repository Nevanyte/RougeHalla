#!/usr/bin/env bash
# Canonical Linux/x64 actual-source consumable witness (potions + the camp-clear reward).
# capture writes parity/consumables/source.json; --check regenerates it and compares byte for byte.
set -euo pipefail
[ "$#" -le 1 ] || exit 2
MODE=${1-capture}
case "$MODE" in capture|--check) ;; *) exit 2 ;; esac
REPO=$(cd "$(dirname "$0")/../.." && pwd)
if [ "$MODE" = "--check" ]; then
  OUTPUT=$(mktemp -d "${TMPDIR:-/tmp}/rh-consumables-check.XXXXXX")
  trap 'rm -rf "$OUTPUT"' EXIT
else
  OUTPUT=${RH_CONSUMABLES_OUTPUT:-$REPO/parity/consumables}
  mkdir -p "$OUTPUT"
  OUTPUT=$(cd "$OUTPUT" && pwd)
fi
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
docker run --rm --platform linux/amd64 \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$OUTPUT,dst=/out" \
 -w /repo "$IMAGE" sh -eu -c '
 npm ci --ignore-scripts --no-audit --no-fund >/tmp/npm.log 2>&1 || { cat /tmp/npm.log; exit 1; }
 node --import tsx tools/consumable-fixtures/potions.ts /out/source.json
 '
if [ "$MODE" = "--check" ]; then
  cmp "$OUTPUT/source.json" "$REPO/parity/consumables/source.json"
  echo "source.json matches byte for byte"
else
  printf 'Captured %s/source.json\n' "$OUTPUT"
fi
