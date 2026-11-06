#!/usr/bin/env bash
# Applies each committed P-FACTION-4 mutant, requires a semantic test failure, and restores the tree.
set -euo pipefail
cd "$(dirname "$0")/../.."
export CARGO_HOME="${CARGO_HOME:-$HOME/.codex/tools/rougehalla-stage2/cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.codex/tools/rougehalla-stage2/rustup}"
export PATH="$CARGO_HOME/bin:$PATH"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
killed=0
for patch in tools/hunt-fixtures/mutants/*.patch; do
  name=$(basename "$patch")
  git apply --check "$patch"
  git apply "$patch"
  set +e
  CARGO_INCREMENTAL=0 cargo test -p rh-sim systems::sentenced_hunt --lib >"$tmp/$name.log" 2>&1
  sim_status=$?
  if [ $sim_status -eq 0 ]; then
    CARGO_INCREMENTAL=0 cargo test -p rh-parity --test hunt >>"$tmp/$name.log" 2>&1
  fi
  set -e
  git apply -R "$patch"
  if grep -q 'error\[E' "$tmp/$name.log"; then
    echo "MUTANT DID NOT COMPILE: $name" >&2
    tail -40 "$tmp/$name.log" >&2
    exit 1
  fi
  if ! grep -q 'test result: FAILED' "$tmp/$name.log"; then
    echo "MUTANT SURVIVED: $name" >&2
    tail -40 "$tmp/$name.log" >&2
    exit 1
  fi
  echo "mutant killed: $name"
  killed=$((killed + 1))
done
if [ "$killed" -ne 6 ]; then
  echo "expected 6 killed mutants, got $killed" >&2
  exit 1
fi
