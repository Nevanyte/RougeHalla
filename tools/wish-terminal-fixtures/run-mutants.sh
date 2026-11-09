#!/usr/bin/env bash
# Compiled semantic mutations against the actual Wish terminal consumer.
# Backup bytes are checked complete before MUT_FILE is armed; a failed backup never overwrites the original.
# Unique mktemp backups/logs; EXIT/HUP/INT/TERM restore the mutated source; SIGKILL is untrappable and is not claimed.
REPO=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO"
. tools/wish-terminal-fixtures/lib/runner-guard.sh
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
CLEANED=0
cleanup() {
  local cleanup_status=$1
  if [ "$CLEANED" -eq 1 ]; then exit "$cleanup_status"; fi
  CLEANED=1
  trap - EXIT HUP INT TERM
  if [ -n "$MUT_FILE" ]; then
    if ! mut_restore_source; then
      echo "restore failed; recovery bytes retained at $MUT_BACKUP"
      cleanup_status=1
    else
      mut_finalize_restore
    fi
  fi
  exit "$cleanup_status"
}
on_signal() { cleanup "$1"; }
on_exit() { local exit_status=$?; cleanup "$exit_status"; }
trap on_exit EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
for op in reason refund clock landing; do
  case "$op" in
    reason|refund|landing) file=crates/rh-sim/src/systems/abilities/mod.rs ;;
    clock) file=crates/rh-sim/src/systems/status/mod.rs ;;
  esac
  MUT_LOG=$(mktemp /tmp/wish-terminal-mut-log.XXXXXX)
  if [ $? -ne 0 ] || [ -z "$MUT_LOG" ]; then
    echo "could not create log for $op; refusing to mutate"
    status=1
    break
  fi
  if ! mut_backup_source "$file"; then
    echo "BACKUP FAILED $op (fail closed; original untouched; log $MUT_LOG)"
    status=1
    break
  fi
  if ! python3 tools/wish-terminal-fixtures/mutants/mutate.py "$op"; then
    echo "apply failed $op (log $MUT_LOG)"
    status=1
    break
  fi
  "$CARGO_BIN" test -p rh-sim --all-features --test wish_terminal_producers > "$MUT_LOG" 2>&1
  code=$?
  if ! mut_restore_source; then
    echo "RESTORE FAILED $op (recovery bytes retained at $MUT_BACKUP; log $MUT_LOG)"
    status=1
    break
  fi
  if ! git diff --quiet -- "$file"; then
    echo "RESTORE VERIFY FAILED $op (recovery bytes retained at $MUT_BACKUP; log $MUT_LOG)"
    status=1
    break
  fi
  mut_finalize_restore
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
  if [ $? -ne 0 ] || [ -z "$CONTROL_LOG" ]; then
    echo "could not create control log"
    status=1
  else
    "$CARGO_BIN" test -p rh-sim --all-features --test wish_terminal_producers > "$CONTROL_LOG" 2>&1
    if [ $? -eq 0 ] && grep -q "1 passed" "$CONTROL_LOG"; then
      echo "control passes (log $CONTROL_LOG)"
    else
      echo "CONTROL FAILED (log $CONTROL_LOG)"
      status=1
    fi
  fi
fi
exit $status
