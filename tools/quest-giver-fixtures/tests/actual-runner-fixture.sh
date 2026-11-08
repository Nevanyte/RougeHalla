#!/usr/bin/env bash
# Disposable ACTUAL-RUNNER fixture for the quest-giver mutant runner.
# Copies the real run-mutants.sh + real runner-guard.sh into a tiny temp repo, stubs git/capture, never uses Docker,
# and verifies exit statuses, exact restoration bytes and a single restoration attempt.
set -m
REAL_REPO=$(cd "$(dirname "$0")/../../.." && pwd)
ROOT=$(mktemp -d /tmp/qg-actual-runner.XXXXXX) || exit 1
cleanup_root(){ rm -rf "$ROOT"; }
trap cleanup_root EXIT
REPO=$ROOT/repo
TOOLS=$REPO/tools/quest-giver-fixtures
mkdir -p "$TOOLS/lib" "$TOOLS/mutants" "$REPO/packages/server/src/sim" "$ROOT/bin"
cp "$REAL_REPO/tools/quest-giver-fixtures/run-mutants.sh" "$TOOLS/run-mutants.sh"
cp "$REAL_REPO/tools/quest-giver-fixtures/lib/runner-guard.sh" "$TOOLS/lib/runner-guard.sh"
chmod +x "$TOOLS/run-mutants.sh"
if ! cmp -s "$TOOLS/run-mutants.sh" "$REAL_REPO/tools/quest-giver-fixtures/run-mutants.sh"; then echo "FAIL: fixture did not copy the real runner"; exit 1; fi
printf 'fixture patch\n' >"$TOOLS/mutants/01-fixture.patch"
for f in projectiles combatant mobLife; do printf 'real fixture bytes for %s\n' "$f" >"$REPO/packages/server/src/sim/$f.ts"; done
cp "$REPO/packages/server/src/sim/projectiles.ts" "$ROOT/projectiles.original"
cp "$REPO/packages/server/src/sim/combatant.ts" "$ROOT/combatant.original"
cp "$REPO/packages/server/src/sim/mobLife.ts" "$ROOT/mobLife.original"
cat >"$ROOT/bin/git" <<'GIT_EOF'
#!/usr/bin/env bash
if [ "$1" = apply ] && [ "$2" = --check ]; then exit 0; fi
if [ "$1" = apply ]; then printf 'actual fixture mutation\n' > packages/server/src/sim/projectiles.ts; exit 0; fi
echo "git stub unsupported: $*" >&2
exit 1
GIT_EOF
chmod +x "$ROOT/bin/git"
cat >"$TOOLS/capture.sh" <<'CAP_EOF'
#!/usr/bin/env bash
case "$QG_FIXTURE_MODE" in
  fail) exit 1 ;;
  wait) : >"$QG_READY_FILE"; sleep 30; exit 0 ;;
  *) exit 0 ;;
esac
CAP_EOF
chmod +x "$TOOLS/capture.sh"
cat >"$ROOT/bin/cp-log" <<'CP_EOF'
#!/usr/bin/env bash
printf '%s -> %s\n' "$1" "$2" >>"$QG_CP_LOG"
exec cp -- "$1" "$2"
CP_EOF
chmod +x "$ROOT/bin/cp-log"
FAILS=0
pass(){ echo "PASS: $1"; }
fail(){ echo "FAIL: $1"; FAILS=$((FAILS+1)); }
assert_restored(){
  if cmp -s "$REPO/packages/server/src/sim/projectiles.ts" "$ROOT/projectiles.original" && \
     cmp -s "$REPO/packages/server/src/sim/combatant.ts" "$ROOT/combatant.original" && \
     cmp -s "$REPO/packages/server/src/sim/mobLife.ts" "$ROOT/mobLife.original"; then
    pass "$1 exact source bytes restored"
  else
    fail "$1 source bytes not restored"
  fi
}
run_ordinary_failure(){
  export PATH="$ROOT/bin:$PATH" QG_CP="$ROOT/bin/cp-log" QG_CP_LOG="$ROOT/cp-ordinary.log"
  export QG_FIXTURE_MODE=fail
  : >"$QG_CP_LOG"
  bash "$TOOLS/run-mutants.sh" >"$ROOT/ordinary.log" 2>&1
  local code=$?
  if [ "$code" -eq 1 ]; then pass "ordinary failure exits 1"; else fail "ordinary failure exit $code (expected 1)"; fi
  assert_restored "ordinary failure"
}
run_signal_case(){
  local sig=$1 expected=$2
  export PATH="$ROOT/bin:$PATH" QG_CP="$ROOT/bin/cp-log" QG_CP_LOG="$ROOT/cp-$sig.log"
  export QG_FIXTURE_MODE=wait QG_READY_FILE="$ROOT/ready-$sig"
  : >"$QG_CP_LOG"; rm -f "$QG_READY_FILE"
  bash "$TOOLS/run-mutants.sh" >"$ROOT/$sig.log" 2>&1 &
  local pid=$!
  local i=0
  while [ $i -lt 200 ]; do [ -f "$QG_READY_FILE" ] && break; sleep 0.05; i=$((i+1)); done
  if [ ! -f "$QG_READY_FILE" ]; then fail "$sig did not reach the armed capture window"; kill -TERM $pid 2>/dev/null; wait $pid; return; fi
  kill -$sig -$pid 2>/dev/null
  wait $pid
  local code=$?
  if [ "$code" -eq "$expected" ]; then pass "$sig exact exit $expected"; else fail "$sig exit $code (expected $expected)"; fi
  assert_restored "$sig"
  local attempts
  attempts=$(grep -c '^.* -> .*packages/server/src/sim/' "$QG_CP_LOG" 2>/dev/null || true)
  if [ "$attempts" -eq 3 ]; then pass "$sig restoration attempted once (3 files, no double restore)"; else fail "$sig restoration cp calls $attempts (expected 3)"; fi
}
run_ordinary_failure
run_signal_case HUP 129
run_signal_case INT 130
run_signal_case TERM 143
if [ $FAILS -ne 0 ]; then echo "actual-runner fixture: $FAILS failure(s)"; exit 1; fi
echo "actual-runner fixture: all checks passed"
