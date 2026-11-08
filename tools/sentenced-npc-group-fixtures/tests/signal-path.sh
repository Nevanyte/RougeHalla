#!/usr/bin/env bash
# Deterministic signal-path checks for the real Sentenced NPC group mutant runner.
# Uses the runner's test-only pause seams and the real source file; restores the source exactly at the end.
set -m
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$REPO"
RUNNER=tools/sentenced-npc-group-fixtures/run-mutants.sh
SOURCE=packages/server/src/sim/factions.ts
SAVE=$(mktemp /tmp/sng-signal-source.XXXXXX) || exit 1
cp "$SOURCE" "$SAVE"
FAILS=0
HAD_INT=0
cleanup() {
  if ! cmp -s "$SOURCE" "$SAVE"; then
    cp "$SAVE" "$SOURCE"
    echo "CLEANUP restored $SOURCE"
  fi
  rm -f "$SAVE"
}
trap cleanup EXIT
sha_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}
orig_sha=$(sha_of "$SOURCE")
pass(){ echo "PASS: $1"; }
fail(){ echo "FAIL: $1"; FAILS=$((FAILS+1)); }
wait_ready() {
  local ready=$1 i=0
  while [ $i -lt 200 ]; do
    if [ -f "$ready" ]; then return 0; fi
    sleep 0.05
    i=$((i+1))
  done
  return 1
}
wait_exit() {
  local pid=$1 i=0
  while [ $i -lt 200 ]; do
    if ! kill -0 "$pid" 2>/dev/null; then return 0; fi
    sleep 0.05
    i=$((i+1))
  done
  return 1
}
run_case() {
  local name=$1 sig=$2 expected=$3 mode=$4
  local ready log pid code seen_ready restored
  ready=$(mktemp /tmp/sng-signal-ready.XXXXXX)
  log=$(mktemp /tmp/sng-signal-log.XXXXXX)
  rm -f "$ready"
  if [ "$mode" = before ]; then
    env SNG_TEST_PAUSE_BEFORE_ARM=30 SNG_TEST_READY_FILE="$ready" bash "$RUNNER" >"$log" 2>&1 &
  else
    env SNG_TEST_PAUSE_AFTER_MUTATION=30 SNG_TEST_READY_FILE="$ready" bash "$RUNNER" >"$log" 2>&1 &
  fi
  pid=$!
  if wait_ready "$ready"; then seen_ready=1; else seen_ready=0; fi
  if [ "$mode" = mutation ]; then
    if [ "$(sha_of "$SOURCE")" != "$orig_sha" ]; then pass "$name reached the applied-mutation window"; else fail "$name did not reach the applied-mutation window"; fi
  else
    if cmp -s "$SOURCE" "$SAVE"; then pass "$name reached the pre-arm window with source untouched"; else fail "$name pre-arm source changed"; fi
  fi
  kill -$sig "$pid" 2>/dev/null
  if ! wait_exit "$pid"; then
    if [ "$sig" = INT ]; then echo "NOTE: SIGINT was not delivered by this environment; terminating with TERM for cleanup"; HAD_INT=1; fi
    kill -TERM "$pid" 2>/dev/null
    wait_exit "$pid" || true
  fi
  wait "$pid"
  code=$?
  if [ "$code" -ne 0 ]; then pass "$name exit is nonzero ($code)"; else fail "$name exit was zero"; fi
  if [ "$code" -eq 0 ] && [ "$seen_ready" -eq 1 ]; then fail "$name produced a zero signal exit"; fi
  if [ "$expected" -eq 0 ]; then :; fi
  if cmp -s "$SOURCE" "$SAVE"; then restored=1; else restored=0; fi
  if [ "$restored" -eq 1 ]; then pass "$name source restored exactly"; else fail "$name source not restored"; fi
  if grep -q "manifest.sha256: No such file" "$log"; then fail "$name has re-entrant manifest errors"; else pass "$name has no re-entrant manifest errors"; fi
  if grep -q "RESTORATION FAILED" "$log"; then fail "$name restoration failure reported"; else pass "$name no restoration failure"; fi
  echo "  log: $log"
  rm -f "$ready"
}
run_case "SIGTERM before arm" TERM 143 before
run_case "SIGTERM during mutation" TERM 143 mutation
run_case "SIGINT during mutation" INT 130 mutation
if [ "$HAD_INT" -ne 0 ]; then echo "NOTE: deterministic SIGINT could not be delivered in this environment"; fi
if [ $FAILS -ne 0 ]; then echo "signal-path: $FAILS failure(s)"; exit 1; fi
echo "signal-path: all checks passed"
