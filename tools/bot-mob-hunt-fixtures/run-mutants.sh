#!/usr/bin/env bash
# Applies each committed mob-hunt mutant, requires a semantic parity failure, restores, and checks the unchanged control.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO"
CARGO=${CARGO:-cargo}
FILES=(crates/rh-policy/src/bots/mob_hunt.rs crates/rh-policy/src/bots/build_route.rs)
BACKUP=$(mktemp -d); LOG=$(mktemp)
restore() { for f in "${FILES[@]}"; do cp "$BACKUP/$(basename "$f")" "$f"; done; }
trap 'restore; rm -rf "$BACKUP" "$LOG"' EXIT
for f in "${FILES[@]}"; do cp "$f" "$BACKUP/$(basename "$f")"; done
run_filters() { "$CARGO" test -q -p rh-policy --all-features --lib -- bots::mob_hunt_parity_tests >"$LOG" 2>&1; }
killed=0; total=0
for patch in tools/bot-mob-hunt-fixtures/mutants/*.patch; do
  total=$((total+1)); name=$(basename "$patch" .patch)
  git apply --check "$patch" || { echo "FAIL $name: patch does not apply"; exit 1; }
  git apply "$patch"
  set +e; run_filters; status=$?; set -e
  restore
  if [ "$status" -eq 0 ]; then echo "SURVIVED $name"; exit 1
  elif grep -q 'test result: FAILED' "$LOG"; then echo "killed $name"; killed=$((killed+1))
  else echo "NOT A SEMANTIC TEST FAILURE: $name"; tail -20 "$LOG"; exit 1; fi
done
run_filters >"$LOG" 2>&1 || { echo "CONTROL FAILED"; tail -20 "$LOG"; exit 1; }
echo "$killed/$total mutants killed; unchanged control passes"
