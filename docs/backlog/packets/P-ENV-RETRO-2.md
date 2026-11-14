# P-ENV-RETRO-2: the oracle-guard hook also guards a lane's sibling worktree

- **Serves:** owner answer 2026-11-14 (chat, Q20: "please go with your recommendation"), the recommendation being to fix
  the hook, with a test. That is the owner's approval for the protected path `.claude/hooks/`, for this scope only.
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** none (no game code) · no wire change

## 1. ID and outcome
`.claude/hooks/guard-oracles.sh` derives the repo-relative path by stripping `$CLAUDE_PROJECT_DIR/` and
`.claude/worktrees/*/`. A lane working in a sibling worktree (for example `~/Documents/Projects/RH-landgen`) matches
neither, so `.../RH-landgen/packages/x.ts` and `.../RH-landgen/protocol/fixtures/v9.json` pass (exit 0) while the same
files in the main checkout exit 2. The gate still catches such an edit before a merge; the hook is the at-the-moment guard.

When this lands the relative path is computed against the worktree containing the file
(`git -C <nearest existing directory> rev-parse --show-toplevel`, plus `--show-prefix` and the not-yet-existing tail), only
when that worktree belongs to the same repository as the project (same `--git-common-dir`). The existing rules then apply
unchanged. If git fails, or the path is in no worktree of this repository, today's prefix stripping applies.

## 5. Exclusive write scope
`.claude/hooks/guard-oracles.sh`, `.claude/hooks/guard-oracles.test.sh` (new), `docs/backlog/packets/P-ENV-RETRO-2.md`.
Not `.claude/settings.json`, not the gate, not any other hook.

## 7. Behaviour to preserve
- Main checkout and `.claude/worktrees/*`: same exit codes and messages.
- `RH_ALLOW_PROTECTED_EDIT=1` still lets everything through.
- A path outside any worktree of this repository (including another repository's `packages/`): as today, judged on its
  absolute path, so allowed (exit 0).
- The hook never fails open through its own error: a git failure falls back to prefix stripping.

## 8. Acceptance checks
- `bash .claude/hooks/guard-oracles.test.sh`: each protected class blocked, and unprotected paths allowed, in the main
  checkout, a sibling worktree and `.claude/worktrees/<name>/`; a not-yet-existing file in a not-yet-existing directory is
  judged by its would-be relative path; outside-repository paths exit 0. Committed red first.
- `bash .claude/hooks/no-pattern-kill.test.sh` and `bash scripts/gate.test.sh` stay green.
- `scripts/gate.sh --quick --allow-protected` passes.

## 10. Risk and suggested model tier
Sonnet. Risk: a hook that errors open. Every git call falls back to today's behaviour.
