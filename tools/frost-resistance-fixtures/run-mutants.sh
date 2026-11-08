#!/usr/bin/env bash
# Applies each committed Frost-resistance mutant (P-FROST-RESISTANCE-1), requires the targeted ACTUAL-CONSUMER test to
# fail semantically (a test failure, not a compile error or an unrelated panic), restores the file, and then requires the
# unchanged frost test module control to pass. The working copy is disposable; every patch is re-applied from the
# committed file. CARGO may point at the pinned toolchain.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO"
CARGO=${CARGO:-cargo}
FILE=crates/rh-sim/src/systems/frost.rs
BACKUP=$(mktemp -d)
LOG=$(mktemp)
cp "$FILE" "$BACKUP/frost.rs"
restore() { cp "$BACKUP/frost.rs" "$FILE"; }
trap 'restore; rm -rf "$BACKUP" "$LOG"' EXIT
filter_for() {
  case "$1" in
    01-*) echo "systems::frost::tests::iron_will_weakens_attack_chill_and_near_movement" ;;
    02-*) echo "systems::frost::tests::iron_will_weakens_ranged_movement_and_overlap_and_source_card_is_neutral" ;;
    03-*) echo "systems::frost::tests::resisted_chill_state_restores_continues_and_replays" ;;
    *) echo "systems::frost::tests::" ;;
  esac
}
killed=0
total=0
for patch in tools/frost-resistance-fixtures/mutants/*.patch; do
  total=$((total+1))
  name=$(basename "$patch" .patch)
  filter=$(filter_for "$name")
  git apply --check "$patch" || { echo "FAIL $name: patch does not apply"; exit 1; }
  git apply "$patch"
  set +e
  "$CARGO" test -q -p rh-sim --all-features --lib -- "$filter" >"$LOG" 2>&1
  status=$?
  set -e
  restore
  if [ "$status" -eq 0 ]; then
    echo "SURVIVED $name"
    exit 1
  elif grep -q 'test result: FAILED' "$LOG"; then
    echo "killed $name ($filter)"
    killed=$((killed+1))
  else
    echo "NOT A SEMANTIC TEST FAILURE: $name"
    tail -20 "$LOG"
    exit 1
  fi
done
run_control() { "$CARGO" test -q -p rh-sim --all-features --lib -- systems::frost::tests:: >"$LOG" 2>&1; }
run_control || { echo "CONTROL FAILED"; tail -20 "$LOG"; exit 1; }
echo "$killed/$total mutants killed; unchanged control passes"
