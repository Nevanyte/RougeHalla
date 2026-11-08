#!/usr/bin/env bash
# Applies each committed P-TROPHY-WITNESS-1 source mutant in this worktree, runs the pinned actual-source capture into a
# disposable directory and requires a real captured-output mismatch against the canonical corpus (compile/import errors
# or setup failures do not count). Restores every file and finally requires the unchanged control --check to pass.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO"
FILES=(
  packages/server/src/sim/killAugments.ts
  packages/server/src/sim/chests.ts
  packages/shared/src/combatReadability.ts
  packages/shared/src/killAugments.ts
)
CANON=$REPO/parity/trophy-witness
BACKUP=$(mktemp -d)
OUT=$(mktemp -d)
backup_name() { printf '%s' "${1//\//__}"; }
restore() { for f in "${FILES[@]}"; do cp "$BACKUP/$(backup_name "$f")" "$f"; done; }
trap 'restore; rm -rf "$BACKUP" "$OUT"' EXIT
for f in "${FILES[@]}"; do cp "$f" "$BACKUP/$(backup_name "$f")"; done
killed=0
total=0
for patch in tools/trophy-witness-fixtures/mutants/*.patch; do
  total=$((total+1))
  name=$(basename "$patch" .patch)
  git apply --check "$patch" || { echo "FAIL $name: patch does not apply"; exit 1; }
  git apply "$patch"
  set +e
  RH_TROPHY_WITNESS_OUTPUT=$OUT bash tools/trophy-witness-fixtures/capture.sh >"$OUT/run.log" 2>&1
  status=$?
  set -e
  restore
  if [ "$status" -ne 0 ]; then
    echo "NOT AN ACTUAL OUTPUT MISMATCH (capture failed): $name"
    tail -20 "$OUT/run.log"
    exit 1
  fi
  if cmp -s "$OUT/lifecycle.json" "$CANON/lifecycle.json" && cmp -s "$OUT/helpers.json" "$CANON/helpers.json"; then
    echo "SURVIVED $name"
    exit 1
  fi
  echo "killed by actual captured-output mismatch: $name"
  killed=$((killed+1))
  rm -f "$OUT/lifecycle.json" "$OUT/helpers.json" "$OUT/run.log"
done
RH_TROPHY_WITNESS_OUTPUT=$CANON bash tools/trophy-witness-fixtures/capture.sh --check >/dev/null || { echo "CONTROL FAILED"; exit 1; }
echo "$killed/$total source mutants killed by actual output mismatches; unchanged control passes"
