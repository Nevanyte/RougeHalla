#!/usr/bin/env bash
# Hardened compiled semantic mutations against the actual Wish terminal consumer.
# Unique mktemp backups/logs; EXIT/HUP/INT/TERM restore the mutated production file; failure logs are preserved.
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
MUT_FILE=""
MUT_BACKUP=""
restore_current() {
  if [ -n "$MUT_FILE" ] && [ -n "$MUT_BACKUP" ] && [ -f "$MUT_BACKUP" ]; then
    cp "$MUT_BACKUP" "$MUT_FILE"
  fi
}
on_exit() {
  code=$?
  restore_current
  exit $code
}
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
for op in reason refund clock landing; do
  case "$op" in
    reason|refund|landing) file=crates/rh-sim/src/systems/abilities/mod.rs ;;
    clock) file=crates/rh-sim/src/systems/status/mod.rs ;;
  esac
  MUT_BACKUP=$(mktemp /tmp/wish-terminal-mut-backup.XXXXXX)
  MUT_LOG=$(mktemp /tmp/wish-terminal-mut-log.XXXXXX)
  MUT_FILE=$file
  cp "$file" "$MUT_BACKUP"
  if ! python3 tools/wish-terminal-fixtures/mutants/mutate.py "$op"; then
    echo "apply failed $op (log $MUT_LOG)"
    status=1
    break
  fi
  "$CARGO_BIN" test -p rh-sim --all-features --test wish_terminal_producers > "$MUT_LOG" 2>&1
  code=$?
  cp "$MUT_BACKUP" "$file"
  if ! git diff --quiet -- "$file"; then
    echo "RESTORE FAILED $op (log $MUT_LOG)"
    status=1
    break
  fi
  MUT_FILE=""
  rm -f "$MUT_BACKUP"
  MUT_BACKUP=""
  if [ $code -eq 0 ]; then
    echo "SURVIVED $op (log $MUT_LOG)"
    status=1
    break
  fi
  if grep -q "error\[E" "$MUT_LOG"; then
    echo "COMPILE_ERROR $op (log $MUT_LOG)"
    status=1
    break
  fi
  if ! grep -q "test result: FAILED" "$MUT_LOG"; then
    echo "NO_SEMANTIC_FAILURE $op (log $MUT_LOG)"
    status=1
    break
  fi
  echo "killed $op (actual consumer failure; log $MUT_LOG)"
done
if [ $status -eq 0 ]; then
  CONTROL_LOG=$(mktemp /tmp/wish-terminal-mut-control.XXXXXX)
  "$CARGO_BIN" test -p rh-sim --all-features --test wish_terminal_producers > "$CONTROL_LOG" 2>&1
  if [ $? -eq 0 ] && grep -q "1 passed" "$CONTROL_LOG"; then
    echo "control passes (log $CONTROL_LOG)"
  else
    echo "CONTROL FAILED (log $CONTROL_LOG)"
    status=1
  fi
fi
exit $status
