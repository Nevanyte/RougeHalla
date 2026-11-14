#!/bin/bash
# PreToolUse guard (Bash): no pattern kills. `pkill -f <pattern>` and friends kill every matching process on the machine,
# including other sessions' test binaries in other worktrees (2026-11-14). Stop only the process ids you started:
# `kill <pid>`, or `kill $!` for the last background job. The owner can start a session with RH_ALLOW_PATTERN_KILL=1.
#
# Parsing is deliberately conservative: a command is judged only where a command word can stand (the start, or after
# ; & | ( ` $( or a newline, optionally behind sudo/nohup/env/VAR=x/xargs, or inside bash -c '...'). A word mentioned
# inside a quoted string passed to another program (grep -n "pkill" f, echo "do not use killall") or in a path is allowed.
[[ "${RH_ALLOW_PATTERN_KILL:-0}" == 1 ]] && exit 0
input="$(cat)"
cmd="$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null)"
[[ -n "$cmd" ]] || exit 0

START='(^|[;&|(`]|\$\(|(bash|sh|zsh)[[:space:]]+-c[[:space:]]+["'"'"'])[[:space:]]*'
PREFIX='(((sudo|nohup|time|exec|command|env|xargs)[[:space:]]+(-[^[:space:]]+[[:space:]]+)*)|([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+))*'
PATHPFX='([^[:space:]]*/)?'
END='([[:space:]]|$|[;&|)`])'

block() {
  {
    echo "Blocked: $1"
    echo "A pattern kill stops every matching process on the machine, including other sessions' work in other worktrees."
    echo "Instead, stop only the processes you started, by process id: kill <pid>, or kill \$! for the last background job"
    echo "(record the pid when you start it: cargo test ... & pid=\$!; ...; kill \"\$pid\")."
    echo "The owner can allow it for a session with RH_ALLOW_PATTERN_KILL=1."
  } >&2
  exit 2
}

# 1. pkill / killall as a command word.
if grep -qE "${START}${PREFIX}${PATHPFX}(pkill|killall)${END}" <<<"$cmd"; then
  block "pkill/killall found in this command."
fi
# 2. kill whose target comes from pgrep, pidof or a ps | grep pipeline (substitution, backticks).
if grep -qE "${START}${PREFIX}${PATHPFX}kill${END}.*(pgrep|pidof|ps[[:space:]].*\|[[:space:]]*grep)" <<<"$cmd"; then
  block "kill with its target taken from pgrep/pidof/ps | grep."
fi
# 3. pgrep / pidof / ps | grep piped into xargs kill.
if grep -qE "${START}${PREFIX}${PATHPFX}(pgrep|pidof|ps)${END}.*\|[[:space:]]*xargs[[:space:]].*kill" <<<"$cmd"; then
  block "pgrep/pidof/ps | grep piped into xargs kill."
fi
exit 0
