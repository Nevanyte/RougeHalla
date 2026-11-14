#!/bin/bash
# PreToolUse guard (Bash): a process is stopped by the id it was started with, never by name or pattern. Several
# sessions and their sub-agents run the same test binaries on this machine: `pkill -f target/debug/deps/mapgen_` in one
# sub-agent ended another session's gate and a sibling's suite (2026-11-14).
input="$(cat)"
cmd="$(jq -r '.tool_input.command // empty' <<<"$input")"
[[ -n "$cmd" ]] || exit 0
# pkill or killall in command position (start, or after ; & | ( ` $( or a newline), a pgrep piped into kill, and
# kill $(pgrep ...).
at_start='(^|[;&|(`]|\$\()[[:space:]]*(sudo[[:space:]]+)?(pkill|killall)([[:space:]]|$)'
piped='pgrep[^|;&]*\|[[:space:]]*(xargs[[:space:]]+(-[^[:space:]]+[[:space:]]+)*)?kill([[:space:]]|$)'
subst='kill[^;&|]*(\$\(|`)[[:space:]]*pgrep'
if grep -qE "$at_start" <<<"$cmd" || grep -qE "$piped" <<<"$cmd" || grep -qE "$subst" <<<"$cmd"; then
  echo "Blocked: stop a process by its id (kill <pid>; take the id from \$! when you start it in the background). pkill, killall and a pgrep piped into kill also match other sessions' processes on this machine." >&2
  exit 2
fi
exit 0
