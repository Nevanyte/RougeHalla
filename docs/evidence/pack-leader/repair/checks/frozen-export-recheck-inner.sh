#!/bin/sh
set -eu
echo "CONTAINER-NODE $(node -v) $(uname -m)"
mkdir -p /tmp/pack-leader-check
npm ci --ignore-scripts --no-audit --no-fund >/tmp/rh-npm-ci.log 2>&1 || { cat /tmp/rh-npm-ci.log; exit 1; }
echo "NPM-CI-OK"
node --max-old-space-size=4096 --import tsx tools/pack-leader-fixtures/capture.mts
if ! cmp -s /tmp/pack-leader-check/source.json /canonical/source.json; then
  echo "CHECK-MISMATCH: fresh capture bytes differ from the readonly canonical corpus" >&2
  cmp /tmp/pack-leader-check/source.json /canonical/source.json >&2 || true
  exit 1
fi
echo "CHECK-OK: fresh capture reproduces the canonical corpus bytes exactly"
sha256sum /tmp/pack-leader-check/source.json /canonical/source.json /repo/tools/pack-leader-fixtures/capture.mts
node -e 'const d=require("/tmp/pack-leader-check/source.json"); console.log("FRESH-TOOL", JSON.stringify(d.tool)); console.log("FRESH-SOURCE-MODS", d.source["packages/server/src/sim/mods.ts"]); console.log("FRESH-WITNESS-CACHEPHASES", JSON.stringify(d.witness.cachePhases));'
