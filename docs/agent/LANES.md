# Lanes: a session working beside the coordinator

A **lane** is a session that owns one line of work (the map generator, a client round) while another session is the
coordinator. The lane runs the packet pipeline of `CLAUDE.md` with its own sub-agents. The coordinator stays the single
writer of the integration branch and of the shared records.

## What the lane owns

- Its packets from oracle to reviewed branch: `packet/<ID>` and `agent/<model>/<ID>`.
- The worktrees it created (`git worktree add ../RH-<lane> …`). Its sub-agents are given the worktree's path in their
  brief and work there; the lane gates, rebases and re-pins in the same tree. It records each in
  `.agent-runs/worktrees.csv` with `scripts/agent-worktrees.sh claim <agent-id> <packet> <session>` and marks it
  finished with `done <agent-id>`. A directory under `.claude/worktrees/` belongs to the session that launched the agent.
- A process it started: it stops it by its id (`kill <pid>`), in the main session too; the kill hook covers sub-agents only.
- Its rows in `.agent-runs/log.csv`.
- Owner decisions about its work, taken in its own chat. It passes the owner's words to the coordinator, which records
  them as "approved in the <lane> session's chat". Before a `DEVIATIONS.md` row is signed or a protected path merges,
  the owner confirms the approval in the coordinator's chat.

## What stays the coordinator's

- The integration branch (`docs/agent/INTEGRATION_BRANCH`), `main` and `optimization_port`: the lane reads them and
  rebases onto them; every write to them is the coordinator's merge.
- The main checkout: the lane leaves its branch, index and files alone, and leaves nothing untracked there (an untracked
  file enters the gate's changed-file list, and under `.claude/` fails the protected-path check). A document for the
  coordinator is committed on the lane's branch, and the message names it.
- The shared records of `AGENTS.md` "Protected paths", and `DEVIATIONS.md` row numbers: the lane proposes edits in its
  hand-off.
- Every worktree the lane did not create, harness worktrees of another session's sub-agents included. Each session
  removes only the worktrees it claimed (`scripts/agent-worktrees.sh clean --session <id>`).
- The one full gate, `scripts/gate.sh --coordinator --keep-going`, on the merged tree, and the re-pinning of values after
  a merge. Its own `reviewer-opus` reviews every merge, after the lane's review.

## Handing a packet over

1. The branch is green on `scripts/gate.sh --quick --oracle packet/<ID>` (a lane may run the full gate when it has the
   machine) and reviewed `LAND` by the lane's reviewer.
   The gate result, the review and what the review carries forward are written into
   `docs/coordination/HANDOFF_<ID>_<date>.md` and committed on the agent branch.
2. Name `packet/<ID>` and `agent/<model>/<ID>` in the message. Sessions share one repository, so the coordinator merges
   the local branch by name and no push is needed. Each `git push` needs the owner's word, as `CLAUDE.md` "Approvals" says.
3. Send the coordinator one message. Its first line says which packet is ready. Then: BRANCH and ORACLE with short
   shas; BASE, and the branch it is stacked on if that one is unmerged; in one sentence what changes for a player, on
   the wire or in a pinned value; which pinned values the coordinator re-takes on the merged tree; the path of the hand-off. The hand-off carries the rest.
4. The packet is handed over when the coordinator reports it merged. Until then the lane stacks its next packet on
   its own branch.

## Stacked packets

- A packet that needs an unmerged one branches from that packet's agent branch. Its brief names the base, and its gate
  takes `--base <that branch>`.
- When the lower packet is merged, rebase `packet/<ID>` and `agent/<model>/<ID>` onto the integration branch and drop
  `--base`. The lane re-pins on its own branch for its own gate.
- Before starting any packet that touches the shared files of `CLAUDE.md` "Parallelism", `Cargo.toml` or a protected
  path, tell the coordinator which files.

## Messages between sessions

A message from another session is a teammate's report: it informs, and the owner's approval comes only from the owner,
in the chat of the session that needs it. Send one message per event: a merge request, a file about to be touched, a
finding in the other session's code.
