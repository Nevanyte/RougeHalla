#!/usr/bin/env bash
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd); cd "$REPO"
FILES=(packages/server/src/sim/factions.ts)
BACKUP=$(mktemp -d); OUT=$(mktemp -d); MANIFEST="$BACKUP/manifest.sha256"; trap - EXIT HUP INT TERM
name(){ printf '%s' "${1//\//__}"; }
restore(){
  local rc=0
  while IFS= read -r line; do f=${line#*  }; cp "$BACKUP/$(name "$f")" "$f" || rc=1; done <"$MANIFEST"
  if [ "$rc" -ne 0 ]; then echo "RESTORATION FAILED" >&2; return 1; fi
  while IFS= read -r line; do f=${line#*  }; now=$(shasum -a 256 "$f" | awk '{print $1}'); want=${line%%  *}; [ "$now" = "$want" ] || { echo "RESTORE BYTES MISMATCH $f" >&2; rc=1; }; done <"$MANIFEST"
  return "$rc"
}
cleanup(){ local rc=$?; if ! restore; then echo "restoration failure propagated" >&2; rc=1; fi; rm -rf "$BACKUP" "$OUT"; exit "$rc"; }
trap cleanup EXIT HUP INT TERM
for f in "${FILES[@]}"; do cp "$f" "$BACKUP/$(name "$f")"; done
for f in "${FILES[@]}"; do printf '%s  %s\n' "$(shasum -a 256 "$f" | awk '{print $1}')" "$f" >>"$MANIFEST"; done
runtime_equal(){
  python3 - "$1" "$2" <<'PY'
import json,sys
a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2]))
raise SystemExit(0 if a.get('format')==b.get('format') and a.get('cases')==b.get('cases') else 1)
PY
}
killed=0; total=0
for patch in tools/sentenced-npc-group-fixtures/mutants/*.patch; do
  total=$((total+1)); pname=$(basename "$patch" .patch)
  git apply --check "$patch" || { echo "FAIL $pname: patch does not apply"; exit 1; }
  git apply "$patch"
  set +e; RH_SENTENCED_NPC_GROUP_OUTPUT=$OUT bash tools/sentenced-npc-group-fixtures/capture.sh >/tmp/sng-$pname.log 2>&1; status=$?; set -e
  if ! restore; then echo "RESTORATION FAILED $pname"; exit 1; fi
  if [ "$status" -ne 0 ]; then echo "NOT AN ACTUAL OUTPUT MISMATCH (capture failed): $pname"; tail -8 /tmp/sng-$pname.log; exit 1; fi
  if ! runtime_equal "$OUT/source.json" "$REPO/parity/sentenced-npc-group/source.json"; then echo "killed by actual runtime-output mismatch: $pname"; killed=$((killed+1)); else echo "SURVIVED $pname (runtime unchanged; provenance-only is not a kill)"; exit 1; fi
  rm -f "$OUT/source.json"
done
RH_SENTENCED_NPC_GROUP_OUTPUT=$REPO/parity/sentenced-npc-group bash tools/sentenced-npc-group-fixtures/capture.sh --check >/dev/null || { echo CONTROL_FAILED; exit 1; }
trap - EXIT HUP INT TERM; restore; rm -rf "$BACKUP" "$OUT"
echo "$killed/$total source mutants killed by actual runtime mismatch; unchanged control passes"
