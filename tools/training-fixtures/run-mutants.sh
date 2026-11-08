#!/usr/bin/env bash
# Applies each committed training-room mutant, requires a semantic training-suite test failure (not a compile error or a
# setup panic), restores the tree, and then checks the unchanged control. CARGO may point at the pinned toolchain.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO"
CARGO=${CARGO:-cargo}
FILES=(crates/rh-sim/src/systems/mob_life.rs crates/rh-sim/src/systems/training.rs crates/rh-sim/src/systems/training/console.rs crates/rh-sim/src/systems/mob_ai.rs crates/rh-sim/src/input.rs crates/rh-sim/src/systems/ledger.rs)
BACKUP=$(mktemp -d)
LOG=$(mktemp)
backup_name() { printf '%s' "${1//\//__}"; }
restore() { for f in "${FILES[@]}"; do cp "$BACKUP/$(backup_name "$f")" "$f"; done; }
trap 'restore; rm -rf "$BACKUP" "$LOG"' EXIT
for f in "${FILES[@]}"; do cp "$f" "$BACKUP/$(backup_name "$f")"; done
run_filters() {
  "$CARGO" test -q -p rh-sim --all-features --lib -- systems::training >"$LOG" 2>&1
}
killed=0
total=0
for patch in tools/training-fixtures/mutants/*.patch; do
  total=$((total+1))
  name=$(basename "$patch" .patch)
  git apply --check "$patch" || { echo "FAIL $name: patch does not apply"; exit 1; }
  git apply "$patch"
  set +e
  run_filters
  status=$?
  set -e
  restore
  if [ "$status" -eq 0 ]; then
    echo "SURVIVED $name"
    exit 1
  elif grep -q 'test result: FAILED' "$LOG"; then
    echo "killed $name"
    killed=$((killed+1))
  else
    echo "NOT A SEMANTIC TEST FAILURE: $name"
    tail -20 "$LOG"
    exit 1
  fi
done
run_filters >"$LOG" 2>&1 || { echo "CONTROL FAILED"; tail -20 "$LOG"; exit 1; }
echo "$killed/$total mutants killed; unchanged control passes"
