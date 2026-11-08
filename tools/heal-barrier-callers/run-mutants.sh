#!/usr/bin/env bash
# Applies each committed P-G6-CALLER-REPAIR semantic mutant, requires an ACTUAL caller-consumer output mismatch (not a
# schedule-table assertion or compile error), restores the tree, then checks the unchanged control.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO"
CARGO=${CARGO:-cargo}
FILES=(crates/rh-sim/src/systems/heal.rs crates/rh-sim/src/schedule.rs)
BACKUP=$(mktemp -d)
LOG=$(mktemp)
backup_name() { printf '%s' "${1//\//__}"; }
restore() { for f in "${FILES[@]}"; do cp "$BACKUP/$(backup_name "$f")" "$f"; done; }
trap 'restore; rm -rf "$BACKUP" "$LOG"' EXIT
for f in "${FILES[@]}"; do cp "$f" "$BACKUP/$(backup_name "$f")"; done
run_filter() { "$CARGO" test -q -p rh-sim --lib --all-features systems::buffs::caller >"$LOG" 2>&1; }
killed=0
total=0
for patch in tools/heal-barrier-callers/mutants/*.patch; do
  total=$((total+1))
  name=$(basename "$patch" .patch)
  git apply --check "$patch" || { echo "FAIL $name: patch does not apply"; exit 1; }
  git apply "$patch"
  set +e
  run_filter
  status=$?
  set -e
  restore
  if [ "$status" -eq 0 ]; then
    echo "SURVIVED $name"
    exit 1
  elif grep -q 'frame .*caller\|panicked at.*caller_tests' "$LOG" && ! grep -q 'error\[E' "$LOG"; then
    echo "killed by actual caller output mismatch: $name"
    killed=$((killed+1))
  else
    echo "NOT AN ACTUAL CALLER OUTPUT MISMATCH: $name"
    tail -20 "$LOG"
    exit 1
  fi
done
run_filter >"$LOG" 2>&1 || { echo "CONTROL FAILED"; tail -20 "$LOG"; exit 1; }
echo "$killed/$total caller mutants killed by actual output mismatches; unchanged control passes"
