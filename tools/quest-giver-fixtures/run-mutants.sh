#!/usr/bin/env bash
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd); cd "$REPO"
FILES=(packages/server/src/sim/projectiles.ts packages/server/src/sim/combatant.ts packages/server/src/sim/mobLife.ts)
BACKUP=$(mktemp -d); OUT=$(mktemp -d)
name(){ printf '%s' "${1//\//__}"; }
# Runtime-output comparison: source-file hashes/provenance are deliberately excluded, so a provenance-only change is not a kill.
runtime_equal() {
  python3 - "$1" "$2" <<'PY'
import json, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
raise SystemExit(0 if a.get("format") == b.get("format") and a.get("cases") == b.get("cases") else 1)
PY
}
restore(){ for f in "${FILES[@]}"; do cp "$BACKUP/$(name "$f")" "$f"; done; }
trap 'restore; rm -rf "$BACKUP" "$OUT"' EXIT
for f in "${FILES[@]}"; do cp "$f" "$BACKUP/$(name "$f")"; done
killed=0; total=0
for patch in tools/quest-giver-fixtures/mutants/*.patch; do
  total=$((total+1)); pname=$(basename "$patch" .patch)
  git apply --check "$patch" || { echo "FAIL $pname: patch does not apply"; exit 1; }
  git apply "$patch"
  set +e; RH_QUEST_GIVER_OUTPUT=$OUT bash tools/quest-giver-fixtures/capture.sh >/tmp/qg-$pname.log 2>&1; status=$?; set -e
  restore
  if [ "$status" -ne 0 ]; then echo "NOT AN ACTUAL OUTPUT MISMATCH (capture failed): $pname"; tail -10 /tmp/qg-$pname.log; exit 1; fi
  if ! runtime_equal "$OUT/source.json" "$REPO/parity/quest-giver/source.json"; then echo "killed by actual runtime-output mismatch: $pname"; killed=$((killed+1)); else echo "SURVIVED $pname (runtime output unchanged; provenance-only changes are not kills)"; exit 1; fi
  rm -f "$OUT/source.json"
done
RH_QUEST_GIVER_OUTPUT=$REPO/parity/quest-giver bash tools/quest-giver-fixtures/capture.sh --check >/dev/null || { echo CONTROL_FAILED; exit 1; }
echo "$killed/$total source mutants killed by actual corpus mismatch; unchanged control passes"
