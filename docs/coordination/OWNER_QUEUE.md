# Owner queue

Decisions waiting for the owner, one line each, with the default the coordinator applies until an answer arrives. The
coordinator edits this file in place: a row leaves when the owner answers (the answer is recorded in
[MIGRATION.md](../MIGRATION.md) and indexed in [OWNER_DECISIONS.md](../OWNER_DECISIONS.md)). To answer, name the row
number in chat: "Q18 yes".

Last updated 2026-11-14, after the owner's "Please go with your recommendations" closed Q18, Q19 and Q21; earlier the same day he answered Q1 to Q13 and Q15 to Q17 (MIGRATION "Owner answers 2026-11-14").
Q14 was closed by the standing instruction that emptied files stay as placeholders.

## Protected path, needs your word

| # | Question | Default in force | Record |
|---|---|---|---|
| Q20 | `.claude/hooks/guard-oracles.sh` (blocks hand edits to `packages/` and the golden vectors) recognises only the main checkout and `.claude/worktrees/*`; in a lane's sibling worktree (`../RH-<lane>`) such an edit is not blocked when made (the gate's path checks still catch it before a merge). Fix the hook to resolve the path against the worktree's own top level? The coordinator recommends yes. | Hook unchanged; the gate is the backstop. | reviewer-opus on P-AGENT-RETRO-1, 2026-11-14 |

## Deferred by the owner

| # | Item | Until then | Record |
|---|---|---|---|
| Q16 | `hosting/technical-demo/README.md:199` names the old content hash; the next deploy needs protocol 18 and a rebuilt client. Owner 2026-11-14: "we can work on this later when all changes are done". | Untouched; raised again at the deploy step. | MIGRATION "Owner answers 2026-11-14" |
