#!/usr/bin/env bash
# Actual-source mutant runner. Backups are completed and verified (size>0 + SHA-256) before the EXIT/HUP/INT/TERM trap
# is armed; backup failures are fail-closed with the source untouched. SIGKILL is untrappable and is not claimed.
set -eo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd); cd "$REPO"
FILES="packages/server/src/sim/factions.ts packages/shared/src/mark.ts"
BACKUP=$(mktemp -d); OUT=$(mktemp -d); MANIFEST="$BACKUP/manifest.sha256"
ARMED=0
CLEANED=0
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
  local rc=$1
  if [ "$CLEANED" -eq 1 ]; then exit "$rc"; fi
  CLEANED=1
  trap - EXIT HUP INT TERM
  if [ "$ARMED" -eq 1 ]; then
    if restore; then rm -rf "$BACKUP" "$OUT"; else echo "RESTORATION FAILED; recovery bytes retained at $BACKUP" >&2; rc=1; fi
  else
    rm -rf "$BACKUP" "$OUT"
  fi
  exit "$rc"
}
on_exit(){ local rc=$?; cleanup "$rc"; }
on_signal(){ cleanup "$1"; }
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
# Deterministic test seam: sleep before arming, after the verified backup exists. Unset in normal use.
pause_before_arm="$SNG_TEST_PAUSE_BEFORE_ARM"
if [ -n "$pause_before_arm" ]; then
  ready_before="$SNG_TEST_READY_FILE"
  if [ -n "$ready_before" ]; then : >"$ready_before"; fi
  sleep "$pause_before_arm"
fi
ARMED=1
trap on_exit EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
runtime_equal(){
  python3 - "$1" "$2" <<'PY'
import json,sys
a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2]))
raise SystemExit(0 if a.get('format')==b.get('format') and a.get('cases')==b.get('cases') else 1)
PY
}
killed=0; total=0
for patch in tools/sentenced-npc-group-fixtures/seam-a-mutants/*.patch; do
  total=$((total+1)); pname=$(basename "$patch" .patch)
  LOG=$(mktemp /tmp/sng-seam-a-patch-log.XXXXXX)
  if ! git apply --check "$patch"; then echo "FAIL $pname: patch does not apply"; exit 1; fi
  git apply "$patch"
  # Deterministic test seam: signals during the applied-mutation window are exercised with this pause.
  pause_after_mutation="$SNG_TEST_PAUSE_AFTER_MUTATION"
  if [ -n "$pause_after_mutation" ]; then
    ready_after="$SNG_TEST_READY_FILE"
    if [ -n "$ready_after" ]; then : >"$ready_after"; fi
    sleep "$pause_after_mutation"
  fi
  set +e; RH_SENTENCED_SEAM_A_OUTPUT=$OUT bash tools/sentenced-npc-group-fixtures/capture-seam-a.sh >"$LOG" 2>&1; status=$?; set -e
  if ! restore; then echo "RESTORATION FAILED $pname (recovery bytes retained at $BACKUP; log $LOG)"; exit 1; fi
  if [ "$status" -ne 0 ]; then echo "NOT AN ACTUAL OUTPUT MISMATCH (capture failed): $pname"; tail -8 "$LOG"; exit 1; fi
  if ! runtime_equal "$OUT/source-seam-a-holy.json" "$REPO/parity/sentenced-npc-group/source-seam-a-holy.json"; then echo "killed by actual runtime-output mismatch: $pname (log $LOG)"; killed=$((killed+1)); else echo "SURVIVED $pname (runtime unchanged; provenance-only is not a kill) (log $LOG)"; exit 1; fi
  rm -f "$OUT/source-seam-a-holy.json"
done
if ! restore; then echo "FINAL RESTORATION FAILED (recovery bytes retained at $BACKUP)"; exit 1; fi
CONTROL_LOG=$(mktemp /tmp/sng-seam-a-control-log.XXXXXX)
if ! RH_SENTENCED_SEAM_A_OUTPUT=$REPO/parity/sentenced-npc-group bash tools/sentenced-npc-group-fixtures/capture-seam-a.sh --check >"$CONTROL_LOG" 2>&1; then echo "CONTROL_FAILED (log $CONTROL_LOG)"; exit 1; fi
ARMED=0
trap - EXIT HUP INT TERM
rm -rf "$BACKUP" "$OUT"
echo "$killed/$total source mutants killed by actual runtime mismatch; unchanged control passes"
