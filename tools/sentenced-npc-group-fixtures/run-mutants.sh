#!/usr/bin/env bash
# Actual-source mutant runner. Backups are completed and verified (size>0 + SHA-256) before the EXIT/HUP/INT/TERM trap
# is armed; backup failures are fail-closed with the source untouched. SIGKILL is untrappable and is not claimed.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd); cd "$REPO"
FILES="packages/server/src/sim/factions.ts"
BACKUP=$(mktemp -d); OUT=$(mktemp -d); MANIFEST="$BACKUP/manifest.sha256"
ARMED=0
sha_of(){
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}
name(){ printf '%s' "$1" | sed 's#/#__#g'; }
restore(){
  local rc=0 want f got now b
  while read -r want f; do
    b="$BACKUP/$(name "$f")"
    cp "$b" "$f" || rc=1
  done <"$MANIFEST"
  if [ "$rc" -ne 0 ]; then echo "RESTORATION FAILED (copy); recovery bytes retained at $BACKUP" >&2; return 1; fi
  while read -r want f; do
    b="$BACKUP/$(name "$f")"
    [ -f "$b" ] && [ -s "$b" ] || { echo "RESTORATION FAILED (missing backup $b)" >&2; rc=1; continue; }
    now=$(sha_of "$f"); got=$(sha_of "$b")
    if [ "$now" != "$want" ] || [ "$got" != "$want" ]; then
      echo "RESTORE BYTES MISMATCH $f (recovery bytes retained at $BACKUP)" >&2
      rc=1
    fi
  done <"$MANIFEST"
  return "$rc"
}
cleanup(){
  local rc=$?
  if [ "$ARMED" -eq 1 ]; then
    if restore; then rm -rf "$BACKUP" "$OUT"; else echo "RESTORATION FAILED; recovery bytes retained at $BACKUP" >&2; rc=1; fi
  else
    rm -rf "$BACKUP" "$OUT"
  fi
  exit "$rc"
}
# 1. Copy every file, then build the manifest, then verify the completed backup against both the manifest and source.
set -- $FILES
count=$#
: >"$MANIFEST"
for f in $FILES; do
  b="$BACKUP/$(name "$f")"
  if ! cp "$f" "$b"; then echo "BACKUP COPY FAILED $f (source untouched; trap not armed)" >&2; exit 1; fi
  if [ ! -f "$b" ] || [ ! -s "$b" ]; then echo "BACKUP EMPTY/MISSING $b (source untouched; trap not armed)" >&2; exit 1; fi
  src_sha=$(sha_of "$f"); b_sha=$(sha_of "$b")
  if [ "$src_sha" != "$b_sha" ]; then echo "BACKUP BYTES MISMATCH $f (source untouched; trap not armed)" >&2; exit 1; fi
  printf '%s  %s\n' "$b_sha" "$f" >>"$MANIFEST"
done
verified=0
while read -r want f; do
  b="$BACKUP/$(name "$f")"
  if [ ! -f "$b" ] || [ ! -s "$b" ]; then echo "MANIFEST BACKUP MISSING $f (trap not armed)" >&2; exit 1; fi
  got=$(sha_of "$b"); src=$(sha_of "$f")
  if [ "$got" != "$want" ] || [ "$src" != "$want" ]; then echo "MANIFEST VERIFY FAILED $f (trap not armed)" >&2; exit 1; fi
  verified=$((verified+1))
done <"$MANIFEST"
if [ "$verified" -ne "$count" ]; then echo "MANIFEST INCOMPLETE $verified/$count (trap not armed)" >&2; exit 1; fi
# 2. Only a complete, size/SHA-verified backup may arm the restoration trap.
ARMED=1
trap cleanup EXIT HUP INT TERM
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
  LOG=$(mktemp /tmp/sng-patch-log.XXXXXX)
  if ! git apply --check "$patch"; then echo "FAIL $pname: patch does not apply"; exit 1; fi
  git apply "$patch"
  set +e; RH_SENTENCED_NPC_GROUP_OUTPUT=$OUT bash tools/sentenced-npc-group-fixtures/capture.sh >"$LOG" 2>&1; status=$?; set -e
  if ! restore; then echo "RESTORATION FAILED $pname (recovery bytes retained at $BACKUP; log $LOG)"; exit 1; fi
  if [ "$status" -ne 0 ]; then echo "NOT AN ACTUAL OUTPUT MISMATCH (capture failed): $pname"; tail -8 "$LOG"; exit 1; fi
  if ! runtime_equal "$OUT/source.json" "$REPO/parity/sentenced-npc-group/source.json"; then echo "killed by actual runtime-output mismatch: $pname (log $LOG)"; killed=$((killed+1)); else echo "SURVIVED $pname (runtime unchanged; provenance-only is not a kill) (log $LOG)"; exit 1; fi
  rm -f "$OUT/source.json"
done
if ! restore; then echo "FINAL RESTORATION FAILED (recovery bytes retained at $BACKUP)"; exit 1; fi
CONTROL_LOG=$(mktemp /tmp/sng-control-log.XXXXXX)
if ! RH_SENTENCED_NPC_GROUP_OUTPUT=$REPO/parity/sentenced-npc-group bash tools/sentenced-npc-group-fixtures/capture.sh --check >"$CONTROL_LOG" 2>&1; then echo "CONTROL_FAILED (log $CONTROL_LOG)"; exit 1; fi
ARMED=0
trap - EXIT HUP INT TERM
rm -rf "$BACKUP" "$OUT"
echo "$killed/$total source mutants killed by actual runtime mismatch; unchanged control passes"
