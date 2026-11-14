#!/usr/bin/env bash
# Checks for .claude/hooks/no-pattern-kill.sh: feeds it PreToolUse JSON and asserts on exit code and message.
#   bash .claude/hooks/no-pattern-kill.test.sh
set -euo pipefail
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/no-pattern-kill.sh"
FAILS=0 PASSES=0
ok() { PASSES=$((PASSES + 1)); echo "ok   - $1"; }
bad() { FAILS=$((FAILS + 1)); echo "FAIL - $1"; [[ -z "${2:-}" ]] || sed 's/^/         | /' <<<"$2" | tail -n 8; }

runhook() { # <command> [env...]: prints "rc|stderr"
  local cmd="$1"; shift
  local rc=0 err
  err="$(jq -n --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' | env "$@" bash "$HOOK" 2>&1 >/dev/null)" || rc=$?
  printf '%s|%s' "$rc" "$err"
}
blocked() {
  local res; res="$(runhook "$1" X=1)"
  if [[ "${res%%|*}" == 2 && "$res" == *"kill <pid>"* ]]; then ok "blocks: $1"; else bad "should block: $1 (got ${res%%|*})" "$res"; fi
}
allowed() {
  local res; res="$(runhook "$1" X=1)"
  if [[ "${res%%|*}" == 0 ]]; then ok "allows: $1"; else bad "should allow: $1 (got ${res%%|*})" "$res"; fi
}

blocked 'pkill -f x'
blocked 'killall x'
blocked 'kill $(pgrep -f x)'
blocked 'kill -9 $(pidof foo)'
blocked 'ps aux | grep x | xargs kill'
blocked 'ps aux | grep x | awk "{print \$2}" | xargs kill -9'
blocked 'pgrep -f x | xargs kill'
blocked 'cargo test; pkill -f mapgen_'
blocked 'make && killall node'
blocked 'false || pkill foo'
blocked 'echo hi | pkill foo'
blocked '(pkill foo)'
blocked 'x=$(pkill foo)'
blocked $'echo hi\npkill foo'
blocked 'kill `pgrep -f x`'

allowed 'kill 1234'
allowed 'kill $PID'
allowed 'kill -9 "$pid"'
allowed 'kill %1'
allowed 'kill $!'
allowed 'grep -n "pkill" file'
allowed 'echo "do not use killall"'
allowed "echo 'kill \$(pgrep x) is banned'"
allowed 'cat docs/pkill-notes.md'
allowed 'ls /usr/bin/killall'
allowed 'git log --oneline'

res="$(runhook 'pkill -f x' RH_ALLOW_PATTERN_KILL=1)"
if [[ "${res%%|*}" == 0 ]]; then ok "RH_ALLOW_PATTERN_KILL=1 lets the owner through"; else bad "owner override (got ${res%%|*})" "$res"; fi

echo
echo "$PASSES passed, $FAILS failed"
[[ $FAILS -eq 0 ]]
