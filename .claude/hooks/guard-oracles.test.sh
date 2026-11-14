#!/usr/bin/env bash
# Checks for .claude/hooks/guard-oracles.sh: feeds it PreToolUse JSON and asserts on the exit code.
#   bash .claude/hooks/guard-oracles.test.sh
# The protected classes are pinned here with examples (the script's case patterns: packages/*, protocol/fixtures/*,
# parity JSON at depth 1 to 4); extend the list when the script's patterns change.
set -euo pipefail
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/guard-oracles.sh"
FAILS=0 PASSES=0
ok() { PASSES=$((PASSES + 1)); echo "ok   - $1"; }
bad() { FAILS=$((FAILS + 1)); echo "FAIL - $1"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
MAIN="$TMP/main"; LANE="$TMP/lane"; WT="$MAIN/.claude/worktrees/wt"
OTHER="$TMP/other"; PLAIN="$TMP/plain"
git init -q "$MAIN"
git -C "$MAIN" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$MAIN" worktree add -q "$LANE" -b lane
git -C "$MAIN" worktree add -q "$WT" -b wt
git init -q "$OTHER"
mkdir -p "$PLAIN"

hookrc() { # <file_path> [env...]: prints the exit code
  local p="$1"; shift
  local rc=0
  (cd "$MAIN" && jq -n --arg p "$p" '{tool_name:"Edit",tool_input:{file_path:$p}}' \
    | env CLAUDE_PROJECT_DIR="$MAIN" "$@" bash "$HOOK" >/dev/null 2>&1) || rc=$?
  echo "$rc"
}
expect() { # <want> <label> <path>
  local got; got="$(hookrc "$3")"
  if [[ "$got" == "$1" ]]; then ok "$2 -> $1: $3"; else bad "$2 should exit $1, got $got: $3"; fi
}

PROTECTED=(packages/x.ts packages/a/b/c.ts protocol/fixtures/v9.json protocol/fixtures/sub/v9.bin
           parity/a.json parity/a/b.json parity/a/b/c.json parity/a/b/c/d.json)
FREE=(crates/rh-sim/src/lib.rs docs/x.md parity/README.md protocol/other.json packagesx/y.ts client-unity/a.cs)

for root in "$MAIN" "$LANE" "$WT"; do
  for rel in "${PROTECTED[@]}"; do expect 2 "protected in $(basename "$root")" "$root/$rel"; done
  for rel in "${FREE[@]}"; do expect 0 "free in $(basename "$root")" "$root/$rel"; done
done

# Files and directories that do not exist yet are judged by their would-be relative path.
expect 2 "new file, new directory (sibling)" "$LANE/packages/new/deep/dir/file.ts"
expect 2 "new file, new directory (sibling fixtures)" "$LANE/protocol/fixtures/new/v10.json"
expect 0 "new file, new directory, free (sibling)" "$LANE/crates/new/deep/lib.rs"
expect 2 "new file, new directory (main)" "$MAIN/packages/new/deep/dir/file.ts"
expect 2 "new file, new directory (worktree)" "$WT/packages/new/deep/dir/file.ts"

# Outside any worktree of this repository: judged on the absolute path as before, so allowed (exit 0).
expect 0 "other repository" "$OTHER/packages/x.ts"
expect 0 "no repository" "$PLAIN/packages/x.ts"
expect 0 "no repository, fixtures" "$PLAIN/protocol/fixtures/v9.json"
expect 0 "nonexistent absolute path" "/nonexistent-dir-xyz/packages/x.ts"

# The owner override still lets everything through.
got="$(hookrc "$LANE/packages/x.ts" RH_ALLOW_PROTECTED_EDIT=1)"
if [[ "$got" == 0 ]]; then ok "RH_ALLOW_PROTECTED_EDIT=1 lets the owner through"; else bad "owner override (got $got)"; fi

echo
echo "$PASSES passed, $FAILS failed"
[[ $FAILS -eq 0 ]]
