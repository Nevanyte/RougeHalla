#!/usr/bin/env bash
# Applies each committed Frost-NPC mutant, requires the targeted ACTUAL-CONSUMER test to fail semantically (a test
# failure, not a compile error or an unrelated panic), restores the file, and then requires the unchanged Frost test
# module control to pass. The working copy is disposable; every patch is re-applied from the committed file. CARGO may
# point at the pinned toolchain.
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
    01-*) echo "systems::frost::tests::actual_source_player_frost_chills_basic_npcs_with_strict_restore" ;;
    02-*) echo "systems::frost::tests::instant_attack_started_hook_is_player_only_and_npc_timing_corrects_in_after_weapons" ;;
    03-*) echo "systems::frost::tests::actual_source_player_frost_chills_basic_npcs_with_strict_restore" ;;
    *) echo "systems::frost::tests::" ;;
  esac
}
killed=0
total=0
for patch in tools/frost-npc-fixtures/mutants/*.patch; do
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
