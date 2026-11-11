#!/bin/bash
# PreToolUse guard (Edit/Write/MultiEdit/NotebookEdit): oracles and the legacy game are never edited by hand.
# Captured fixtures and golden vectors come only from their capture/fixture commands (run through Bash, not blocked);
# packages/ changes need the owner, who can start a session with RH_ALLOW_PROTECTED_EDIT=1 for an approved edit.
[[ "${RH_ALLOW_PROTECTED_EDIT:-0}" == 1 ]] && exit 0
input="$(cat)"
path="$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$input")"
[[ -n "$path" ]] || exit 0
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
rel="${path#"$root"/}"
# Inside a worktree (.claude/worktrees/<name>/...) the repo-relative path starts after the worktree name.
[[ "$rel" == .claude/worktrees/*/* ]] && rel="${rel#.claude/worktrees/*/}"
case "$rel" in
  packages/*)
    echo "Blocked: packages/ is the legacy game, the parity oracle. Edits need the owner's approval (AGENTS.md, Protected paths)." >&2
    exit 2 ;;
  protocol/fixtures/*|parity/*.json|parity/*/*.json|parity/*/*/*.json|parity/*/*/*/*.json)
    echo "Blocked: $rel is a captured fixture or golden vector. Regenerate it with its documented command (parity/README.md, cargo run -p rh-protocol --bin protocol-fixtures) inside a packet that says so; never hand-edit." >&2
    exit 2 ;;
esac
exit 0
