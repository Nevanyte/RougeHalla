#!/usr/bin/env bash
# Actual-source quest-giver mutant runner. Complete checked backups + manifest are built and verified before the
# EXIT/HUP/INT/TERM restoration trap is armed; backup failures are fail-closed with the originals untouched.
# SIGKILL is untrappable and is not claimed.
set -eo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd); cd "$REPO"
. tools/quest-giver-fixtures/lib/runner-guard.sh
FILES="packages/server/src/sim/projectiles.ts
packages/server/src/sim/combatant.ts
packages/server/src/sim/mobLife.ts"
BACKUP=$(mktemp -d); OUT=$(mktemp -d); MANIFEST="$BACKUP/manifest.sha256"
ARMED=0; CLEANED=0
# Runtime-output comparison: source-file hashes/provenance are deliberately excluded, so provenance-only changes are not kills.
runtime_equal() {
  python3 - "$1" "$2" <<'PY'
import json, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
raise SystemExit(0 if a.get("format") == b.get("format") and a.get("cases") == b.get("cases") else 1)
PY
}
cleanup(){
  local cleanup_status=$1
  if [ "$CLEANED" -eq 1 ]; then exit "$cleanup_status"; fi
  CLEANED=1
  trap - EXIT HUP INT TERM
  if [ "$ARMED" -eq 1 ]; then
    if qg_restore_manifest "$MANIFEST" "$BACKUP"; then rm -rf "$BACKUP" "$OUT"; else echo "RESTORATION FAILED; recovery bytes retained at $BACKUP" >&2; cleanup_status=1; fi
  else
    rm -rf "$BACKUP" "$OUT"
  fi
  exit "$cleanup_status"
}
on_exit(){ local exit_status=$?; cleanup "$exit_status"; }
on_signal(){ cleanup "$1"; }
# 1. Complete backups + manifest first; verify every backup nonempty and SHA-256-identical to source/manifest.
: >"$MANIFEST"
count=0
for f in $FILES; do
  b="$BACKUP/$(qg_name "$f")"
  if ! qg_copy_checked "$f" "$b"; then echo "BACKUP FAILED $f (fail closed; originals untouched; trap not armed)" >&2; exit 1; fi
  sha=$(qg_sha "$b") || { echo "BACKUP HASH FAILED $f (trap not armed)" >&2; exit 1; }
  printf '%s  %s\n' "$sha" "$f" >>"$MANIFEST"
  count=$((count+1))
done
if ! qg_verify_manifest "$MANIFEST" "$BACKUP" "$count"; then echo "BACKUP/MANIFEST VERIFY FAILED (originals untouched; trap not armed)" >&2; exit 1; fi
# 2. Only a complete, verified backup may arm the restoration trap.
ARMED=1
trap on_exit EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
killed=0; total=0
for patch in tools/quest-giver-fixtures/mutants/*.patch; do
  total=$((total+1)); pname=$(basename "$patch" .patch)
  LOG=$(mktemp /tmp/qg-patch-log.XXXXXX)
  if [ $? -ne 0 ] || [ -z "$LOG" ]; then echo "could not create log for $pname"; exit 1; fi
  if ! git apply --check "$patch"; then echo "FAIL $pname: patch does not apply"; exit 1; fi
  git apply "$patch"
  set +e; RH_QUEST_GIVER_OUTPUT=$OUT bash tools/quest-giver-fixtures/capture.sh >"$LOG" 2>&1; status=$?; set -e
  if ! qg_restore_manifest "$MANIFEST" "$BACKUP"; then echo "RESTORATION FAILED $pname (recovery bytes retained at $BACKUP; log $LOG)"; exit 1; fi
  if [ "$status" -ne 0 ]; then echo "NOT AN ACTUAL OUTPUT MISMATCH (capture failed): $pname"; tail -10 "$LOG"; exit 1; fi
  if ! runtime_equal "$OUT/source.json" "$REPO/parity/quest-giver/source.json"; then echo "killed by actual runtime-output mismatch: $pname (log $LOG)"; killed=$((killed+1)); else echo "SURVIVED $pname (runtime output unchanged; provenance-only changes are not kills) (log $LOG)"; exit 1; fi
  rm -f "$OUT/source.json"
done
if ! qg_restore_manifest "$MANIFEST" "$BACKUP"; then echo "FINAL RESTORATION FAILED (recovery bytes retained at $BACKUP)"; exit 1; fi
CONTROL_LOG=$(mktemp /tmp/qg-control-log.XXXXXX)
if ! RH_QUEST_GIVER_OUTPUT=$REPO/parity/quest-giver bash tools/quest-giver-fixtures/capture.sh --check >"$CONTROL_LOG" 2>&1; then echo "CONTROL_FAILED (log $CONTROL_LOG)"; exit 1; fi
ARMED=0
trap - EXIT HUP INT TERM
rm -rf "$BACKUP" "$OUT"
echo "$killed/$total source mutants killed by actual corpus mismatch; unchanged control passes"
