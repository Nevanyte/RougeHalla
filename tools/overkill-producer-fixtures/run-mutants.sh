#!/usr/bin/env bash
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
CANON=$REPO/parity/overkill-producer/source.json
TMP=$(mktemp -d /tmp/ovk-mut.XXXXXX); trap 'rm -rf "$TMP"' EXIT
runtime_equal(){ python3 - "$1" "$2" <<'PY'
import json,sys
a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2]))
raise SystemExit(0 if a.get('format')==b.get('format') and a.get('cases')==b.get('cases') else 1)
PY
}
prepare_variant(){ V=$1; mkdir -p "$V/repo"; (cd "$REPO" && git archive HEAD) | tar -x -C "$V/repo"; mkdir -p "$V/repo/tools/overkill-producer-fixtures"; cp "$REPO/tools/overkill-producer-fixtures/capture.mts" "$V/repo/tools/overkill-producer-fixtures/capture.mts"; cp "$REPO/tools/overkill-producer-fixtures/capture.sh" "$V/repo/tools/overkill-producer-fixtures/capture.sh"; cp "$REPO/tools/overkill-producer-fixtures/run-mutants.sh" "$V/repo/tools/overkill-producer-fixtures/run-mutants.sh"; mkdir -p "$V/out"; }
killed=0; total=0
for patch in tools/overkill-producer-fixtures/mutants/*.patch; do
  total=$((total+1)); name=$(basename "$patch" .patch); V=$TMP/$name; prepare_variant "$V"
  (cd "$V/repo" && patch -p1 < "$REPO/$patch") >/dev/null || { echo "PATCH FAILED $name"; exit 1; }
  if ! (cd "$V/repo" && RH_OVERKILL_PRODUCER_OUTPUT="$V/out" bash tools/overkill-producer-fixtures/capture.sh) >"$TMP/$name.log" 2>&1; then echo "CAPTURE FAILED $name"; tail -8 "$TMP/$name.log"; exit 1; fi
  if runtime_equal "$V/out/source.json" "$CANON"; then echo "SURVIVED $name"; exit 1; fi
  echo "killed $name by actual runtime-output mismatch"; killed=$((killed+1))
done
# Provenance-only comment mutation: real runtime cases must stay identical.
V=$TMP/provenance; prepare_variant "$V"
(cd "$V/repo" && patch -p1 < "$REPO/tools/overkill-producer-fixtures/provenance-only.patch") >/dev/null || { echo "PROVENANCE PATCH FAILED"; exit 1; }
if ! (cd "$V/repo" && RH_OVERKILL_PRODUCER_OUTPUT="$V/out" bash tools/overkill-producer-fixtures/capture.sh) >"$TMP/provenance.log" 2>&1; then echo "PROVENANCE CAPTURE FAILED"; tail -8 "$TMP/provenance.log"; exit 1; fi
runtime_equal "$V/out/source.json" "$CANON" || { echo "PROVENANCE-ONLY CHANGE CHANGED RUNTIME (unexpected)"; exit 1; }
echo "provenance-only mutation: runtime equal (non-kill)"
# Host source must be untouched by every copy-only variant; canonical control required.
[ -z "$(cd "$REPO" && git status --porcelain -- packages/server/src/sim/ledger.ts)" ] || { echo "HOST_SOURCE_DIRTY"; exit 1; }
(cd "$REPO" && RH_OVERKILL_PRODUCER_OUTPUT="$REPO/parity/overkill-producer" bash tools/overkill-producer-fixtures/capture.sh --check >/dev/null) || { echo CONTROL_FAILED; exit 1; }
echo "$killed/$total source mutants killed by actual runtime mismatch; provenance-only non-kill; unchanged control passes; host source untouched"
