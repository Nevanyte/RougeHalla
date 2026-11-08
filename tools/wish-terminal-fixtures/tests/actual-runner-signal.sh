#!/usr/bin/env bash
# Disposable ACTUAL-RUNNER signal fixture for the Wish terminal mutant runner.
# Copies the real run-mutants.sh + real lib into a temp repo, stubs python3/cargo/git, never uses Docker or Rust.
# Verifies exact HUP/INT/TERM statuses after armed restoration, exact source bytes, one restoration attempt,
# and one restoration attempt under signal + restoration failure (recovery retained, nonzero).
set -m
REAL_REPO=$(cd "$(dirname "$0")/../../.." && pwd)
ROOT=$(mktemp -d /tmp/wt-actual-runner.XXXXXX) || exit 1
cleanup_root(){ rm -rf "$ROOT"; }
trap cleanup_root EXIT
REPO=$ROOT/repo
TOOLS=$REPO/tools/wish-terminal-fixtures
SRC=$REPO/crates/rh-sim/src/systems
mkdir -p "$TOOLS/lib" "$TOOLS/mutants" "$SRC/abilities" "$SRC/status" "$ROOT/bin"
cp "$REAL_REPO/tools/wish-terminal-fixtures/run-mutants.sh" "$TOOLS/run-mutants.sh"
cp "$REAL_REPO/tools/wish-terminal-fixtures/lib/runner-guard.sh" "$TOOLS/lib/runner-guard.sh"
chmod +x "$TOOLS/run-mutants.sh"
if ! cmp -s "$TOOLS/run-mutants.sh" "$REAL_REPO/tools/wish-terminal-fixtures/run-mutants.sh"; then echo "FAIL: fixture did not copy the real runner"; exit 1; fi
printf 'abilities fixture bytes\n' >"$SRC/abilities/mod.rs"
printf 'status fixture bytes\n' >"$SRC/status/mod.rs"
cp "$SRC/abilities/mod.rs" "$ROOT/abilities.original"
cp "$SRC/status/mod.rs" "$ROOT/status.original"
cat >"$TOOLS/mutants/mutate.py" <<'PY_EOF'
#!/usr/bin/env python3
import pathlib, sys
pathlib.Path('crates/rh-sim/src/systems/abilities/mod.rs').write_text('mutated abilities\n')
PY_EOF
chmod +x "$TOOLS/mutants/mutate.py"
cat >"$ROOT/bin/cargo" <<'CARGO_EOF'
#!/usr/bin/env bash
: >"$WT_READY_FILE"
if [ -n "$WT_RESTORE_FAIL_MARKER" ]; then : >"$WT_RESTORE_FAIL_MARKER"; fi
sleep 30
exit 0
CARGO_EOF
chmod +x "$ROOT/bin/cargo"
cat >"$ROOT/bin/cp-log" <<'CP_EOF'
#!/usr/bin/env bash
printf '%s -> %s\n' "$1" "$2" >>"$WT_CP_LOG"
case "$2" in
  *crates/rh-sim/src/systems/*)
    if [ -n "$WT_RESTORE_FAIL_MARKER" ] && [ -f "$WT_RESTORE_FAIL_MARKER" ]; then exit 1; fi
    ;;
esac
exec cp -- "$1" "$2"
CP_EOF
chmod +x "$ROOT/bin/cp-log"
FAILS=0
pass(){ echo "PASS: $1"; }
fail(){ echo "FAIL: $1"; FAILS=$((FAILS+1)); }
assert_restored(){
  if cmp -s "$SRC/abilities/mod.rs" "$ROOT/abilities.original" && cmp -s "$SRC/status/mod.rs" "$ROOT/status.original"; then
    pass "$1 exact source bytes restored"
  else
    fail "$1 source bytes not restored"
  fi
}
run_signal_case(){
  local sig=$1 expected=$2 restore_fail=$3 name=$1
  export PATH="$ROOT/bin:$PATH" CARGO="$ROOT/bin/cargo" CP_CMD="$ROOT/bin/cp-log"
  export CARGO_TARGET_DIR="$ROOT/target"
  export WT_READY_FILE="$ROOT/ready-$sig" WT_CP_LOG="$ROOT/cp-$sig.log"
  unset WT_RESTORE_FAIL_MARKER
  if [ "$restore_fail" = yes ]; then export WT_RESTORE_FAIL_MARKER="$ROOT/fail-$sig"; fi
  : >"$WT_CP_LOG"; rm -f "$WT_READY_FILE"
  if [ "$restore_fail" = yes ]; then rm -f "$WT_RESTORE_FAIL_MARKER"; fi
  bash "$TOOLS/run-mutants.sh" >"$ROOT/$sig.log" 2>&1 &
  local pid=$!
  local i=0
  while [ $i -lt 200 ]; do [ -f "$WT_READY_FILE" ] && break; sleep 0.05; i=$((i+1)); done
  if [ ! -f "$WT_READY_FILE" ]; then fail "$name did not reach the armed cargo window"; kill -TERM $pid 2>/dev/null; wait $pid; return; fi
  kill -$sig -$pid 2>/dev/null
  wait $pid
  local code=$?
  local attempts
  attempts=$(grep -c '^.* -> .*crates/rh-sim/src/systems/' "$WT_CP_LOG" 2>/dev/null || true)
  if [ "$restore_fail" = yes ]; then
    if [ "$code" -ne 0 ]; then pass "$name restore-failure exit is nonzero ($code)"; else fail "$name restore-failure exited zero"; fi
    if [ "$attempts" -eq 1 ]; then pass "$name restoration attempted exactly once"; else fail "$name restoration cp calls $attempts (expected 1)"; fi
    if grep -q "recovery bytes retained at" "$ROOT/$sig.log"; then pass "$name recovery bytes retained"; else fail "$name no retained-recovery message"; fi
    recovery_path=$(sed -n 's/.*recovery bytes retained at //p' "$ROOT/$sig.log" | tail -1)
    if [ -n "$recovery_path" ] && [ -f "$recovery_path" ]; then pass "$name retained recovery file exists"; else fail "$name retained recovery file missing ($recovery_path)"; fi
  else
    if [ "$code" -eq "$expected" ]; then pass "$name exact exit $expected"; else fail "$name exit $code (expected $expected)"; fi
    if [ "$attempts" -eq 1 ]; then pass "$name restoration attempted exactly once"; else fail "$name restoration cp calls $attempts (expected 1)"; fi
    assert_restored "$name"
  fi
  rm -f "$WT_READY_FILE"
}
run_signal_case HUP 129 no
run_signal_case INT 130 no
run_signal_case TERM 143 no
run_signal_case TERM 143 yes
if [ $FAILS -ne 0 ]; then echo "actual-runner signal fixture: $FAILS failure(s)"; exit 1; fi
echo "actual-runner signal fixture: all checks passed"
