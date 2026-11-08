#!/usr/bin/env bash
# Compiled semantic mutations against the actual Wish terminal consumer; restore the control after each.
REPO=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO"
CARGO_HOME_SET="$CARGO_HOME"
[ -n "$CARGO_HOME_SET" ] || export CARGO_HOME="$HOME/.codex/tools/rougehalla-stage2/cargo"
RUSTUP_HOME_SET="$RUSTUP_HOME"
[ -n "$RUSTUP_HOME_SET" ] || export RUSTUP_HOME="$HOME/.codex/tools/rougehalla-stage2/rustup"
TARGET_SET="$CARGO_TARGET_DIR"
[ -n "$TARGET_SET" ] || export CARGO_TARGET_DIR=/tmp/wish-terminal-mutants
CARGO_BIN="$CARGO"
[ -n "$CARGO_BIN" ] || CARGO_BIN="$HOME/.codex/tools/rougehalla-stage2/cargo/bin/cargo"
export CARGO_INCREMENTAL=0
status=0
for op in reason refund clock landing; do
  case "$op" in
    reason|refund|landing) file=crates/rh-sim/src/systems/abilities/mod.rs ;;
    clock) file=crates/rh-sim/src/systems/status/mod.rs ;;
  esac
  cp "$file" /tmp/wish-terminal-mut-backup
  python3 tools/wish-terminal-fixtures/mutants/mutate.py "$op" || { echo "apply failed $op"; status=1; break; }
  "$CARGO_BIN" test -p rh-sim --all-features --test wish_terminal_producers > "/tmp/wish-terminal-mut-$op.log" 2>&1
  code=$?
  cp /tmp/wish-terminal-mut-backup "$file"
  if git diff --quiet -- "$file"; then echo "restored $op"; else echo "RESTORE FAILED $op"; status=1; break; fi
  if [ $code -eq 0 ]; then echo "SURVIVED $op"; status=1; break; fi
  if grep -q "error\[E" "/tmp/wish-terminal-mut-$op.log"; then echo "COMPILE_ERROR $op"; status=1; break; fi
  if ! grep -q "test result: FAILED" "/tmp/wish-terminal-mut-$op.log"; then echo "NO_SEMANTIC_FAILURE $op"; status=1; break; fi
  echo "killed $op (actual consumer failure)"
done
if [ $status -eq 0 ]; then
  "$CARGO_BIN" test -p rh-sim --all-features --test wish_terminal_producers > /tmp/wish-terminal-mut-control.log 2>&1
  if [ $? -eq 0 ] && grep -q "1 passed" /tmp/wish-terminal-mut-control.log; then echo "control passes"; else echo "CONTROL FAILED"; status=1; fi
fi
exit $status