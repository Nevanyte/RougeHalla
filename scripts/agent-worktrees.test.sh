#!/usr/bin/env bash
# Checks for scripts/agent-worktrees.sh on a temporary repository.
#   bash scripts/agent-worktrees.test.sh
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOL="$SRC/scripts/agent-worktrees.sh"
TMP="$(mktemp -d)"; TMP="$(cd "$TMP" && pwd -P)"; trap 'rm -rf "$TMP"' EXIT
FAILS=0 PASSES=0
ok() { PASSES=$((PASSES + 1)); echo "ok   - $1"; }
bad() { FAILS=$((FAILS + 1)); echo "FAIL - $1"; [[ -z "${2:-}" ]] || sed 's/^/         | /' <<<"$2" | tail -n 15; }

R="$TMP/repo"; mkdir -p "$R"; cd "$R"
git init -q -b main .; git config user.email t@example.com; git config user.name t
printf '.agent-runs/\n' >.gitignore; echo 0 >f; git add -A; git commit -q -m base
W="$R/.claude/worktrees"; mkdir -p "$W"
for id in aaa bbb ccc ddd eee fff; do git worktree add -q -b "agent/$id" "$W/agent-$id" main; done
git worktree lock "$W/agent-aaa"   # a locked worktree must still be removable by clean

t() { local rc=0; OUT="$(bash "$TOOL" "$@" 2>&1)" || rc=$?; RC=$rc; }
t claim aaa P-1 s1; r1=$RC
t claim bbb P-1 s2; t claim ccc P-1 s1; t claim ddd P-1 s1; t claim eee P-1 s1
CSV="$R/.agent-runs/worktrees.csv"
if [[ $r1 -eq 0 && -f "$CSV" && "$(grep -c . "$CSV")" -eq 5 ]] && grep -q 'aaa,P-1,s1,open' "$CSV"; then ok "claim appends a row (date,agent,packet,session,open)"
else bad "claim (rc=$r1)" "$(cat "$CSV" 2>/dev/null || true)"; fi

t done aaa; ra=$RC; t done bbb; t done ccc; t done ddd
if [[ $ra -eq 0 ]] && grep -q 'aaa,P-1,s1,done' "$CSV" 2>/dev/null && grep -q 'eee,P-1,s1,open' "$CSV"; then ok "done marks the row"
else bad "done (rc=$ra)" "$(cat "$CSV" 2>/dev/null || true)"; fi

echo dirty >"$W/agent-ccc/untracked.txt"       # ccc: done but dirty
mkdir -p "$W/agent-ddd/.agent-runs"; echo log >"$W/agent-ddd/.agent-runs/x.log"   # ddd: only .agent-runs: still clean
# fff has no row; bbb belongs to s2; eee is open.

t list
if [[ $RC -eq 0 && "$OUT" == *aaa* && "$OUT" == *agent/aaa* ]]; then ok "list shows rows with branch"; else bad "list (rc=$RC)" "$OUT"; fi

t clean --session s1; rc=$RC; out="$OUT"
gone() { [[ ! -d "$W/agent-$1" ]]; }
if [[ $rc -eq 0 ]] && gone aaa && gone ddd; then ok "clean removes done, clean worktrees of its session (locked one too)"; else bad "removed (rc=$rc)" "$out"; fi
if [[ -d "$W/agent-bbb" && "$out" == *bbb*session* ]]; then ok "clean leaves another session's worktree and says why"; else bad "other session" "$out"; fi
if [[ -d "$W/agent-ccc" && "$out" == *ccc*uncommitted* ]]; then ok "clean leaves a dirty worktree and says why"; else bad "dirty" "$out"; fi
if [[ -d "$W/agent-eee" && "$out" == *eee*"not done"* ]]; then ok "clean leaves an open worktree and says why"; else bad "open" "$out"; fi
if [[ -d "$W/agent-fff" && "$out" == *fff*"no row"* ]]; then ok "clean leaves an unclaimed worktree and says why"; else bad "unclaimed" "$out"; fi
if git rev-parse -q --verify agent/aaa >/dev/null && git rev-parse -q --verify agent/ddd >/dev/null; then ok "clean never deletes a branch"; else bad "branches"; fi

# Run from inside a worktree: the table is still the main checkout's.
cd "$W/agent-bbb"
t done bbb; rc=$RC
if [[ $rc -eq 0 ]] && grep -q 'bbb,P-1,s2,done' "$CSV" && [[ ! -e "$W/agent-bbb/.agent-runs/worktrees.csv" ]]; then ok "from a worktree the main checkout's table is used"
else bad "from worktree (rc=$rc)" "$OUT"; fi

echo
echo "$PASSES passed, $FAILS failed"
[[ $FAILS -eq 0 ]]
