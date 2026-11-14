#!/bin/bash
# PreToolUse guard (Bash): no pattern kills. `pkill -f <pattern>` and friends kill every matching process on the machine,
# including other sessions' test binaries in other worktrees (2026-11-14). Stop only the process ids you started:
# `kill <pid>`, or `kill $!` for the last background job. The owner can start a session with RH_ALLOW_PATTERN_KILL=1.
#
# Parsing is deliberately conservative: a false block on a normal command is worse than a miss. Heredoc bodies are
# dropped and quoted strings are emptied (a "$(...)" or backtick substitution inside double quotes is kept, since it
# runs); the contents of bash/sh/zsh -c '...' are kept, since they run. A command is then judged only where a command
# word can stand: the start, or after ; & | ( { ! ` $( then do else, behind wrappers such as sudo [-u user], timeout 5,
# nohup, env, VAR=x, eval, xargs. Rules 2 and 3 do not look past ; or &.
# Known miss: pids=$(pgrep x); kill $pids. A two-step pattern kill cannot be told from a legitimate kill of saved ids
# without tracking variables.
# Works from any directory (the hook runs with CLAUDE_PROJECT_DIR set to the main checkout): it reads only stdin.
[[ "${RH_ALLOW_PATTERN_KILL:-0}" == 1 ]] && exit 0
input="$(cat)"
cmd="$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null)"
[[ -n "$cmd" ]] || exit 0

if command -v perl >/dev/null 2>&1; then
  cmd="$(perl -e '
    local $/; $_ = <STDIN>;
    my (@out, $d);
    for my $l (split /\n/, $_, -1) {
      if (defined $d) { (my $t = $l) =~ s/^\s+|\s+$//g; $d = undef if $t eq $d; next }
      push @out, $l;
      $d = $1 if $l =~ /(?<!<)<<(?!<)-?\s*["\x27]?([A-Za-z_][A-Za-z0-9_]*)["\x27]?/;
    }
    $_ = join("\n", @out);
    s/\b(bash|sh|zsh)(\s+-[A-Za-z]*c\s+)["\x27]/$1$2; /g;
    s/"([^"]*)"/my $c = $1; $c =~ m{\$\(|`} ? " $c " : "\"\""/ge;
    s/\x27[^\x27]*\x27/\x27\x27/g;
    print;' <<<"$cmd" 2>/dev/null)" || cmd="$(jq -r '.tool_input.command // empty' <<<"$input")"
fi

START='(^|[;&|(`{!]|\$\(|(^|[[:space:]])(then|do|else|if|while|until)[[:space:]])[[:space:]]*'
WRAP='(sudo|nohup|time|exec|command|env|xargs|eval|timeout|nice|setsid)'
WARG='((-[ugnsk][[:space:]]+[^[:space:]]+|-[^[:space:]]+|[0-9.]+[smhd]?)[[:space:]]+)'
PREFIX="((${WRAP}[[:space:]]+${WARG}*)|([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+))*"
PATHPFX='([^[:space:]]*/)?'
END='([[:space:]]|$|[;&|)`}])'

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
if grep -qE "${START}${PREFIX}${PATHPFX}kill${END}[^;&]*(pgrep|pidof|ps[[:space:]][^;&]*\|[[:space:]]*grep)" <<<"$cmd"; then
  block "kill with its target taken from pgrep/pidof/ps | grep."
fi
# 3. pgrep / pidof / ps | grep piped into xargs kill.
if grep -qE "${START}${PREFIX}${PATHPFX}(pgrep|pidof|ps)${END}[^;&]*\|[[:space:]]*xargs[[:space:]][^;&]*kill" <<<"$cmd"; then
  block "pgrep/pidof/ps | grep piped into xargs kill."
fi
exit 0
