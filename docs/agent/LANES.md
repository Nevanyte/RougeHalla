# Lanes: a session working beside the coordinator

A **lane** is a session that owns one line of work (the map generator, a client round) while another session is the
coordinator. The lane runs the packet pipeline of `CLAUDE.md` with its own sub-agents. The coordinator stays the single
writer of the integration branch and of the shared records.

## What the lane owns

- Its packets from oracle to reviewed branch: `packet/<ID>` and `agent/<model>/<ID>`.
- The worktrees it created (`git worktree add ../RH-<lane> …`). Its sub-agents are given the worktree's path in their
  brief and work there; the lane gates, rebases and re-pins in the same tree.
- Its rows in `.agent-runs/log.csv`.
- Owner decisions about its work, taken in its own chat. It passes the owner's words to the coordinator, which records
  them as "approved in the <lane> session's chat" until the owner confirms them there.

## What stays the coordinator's

- The integration branch (`docs/agent/INTEGRATION_BRANCH`), `main` and `optimization_port`: the lane reads them and
  rebases onto them; every write to them is the coordinator's merge.
- The main checkout: the lane leaves its branch and index alone. A file meant for the coordinator is left there
  untracked, and the message says so.
- The shared records of `AGENTS.md` "Protected paths", and `DEVIATIONS.md` row numbers: the lane proposes edits in its
  hand-off.
- Every worktree the lane did not create, harness worktrees of another session's sub-agents included. Each session
  removes only its own.

## Handing a packet over

1. The branch is gate-green (`scripts/gate.sh --oracle packet/<ID>`, full) and reviewed `LAND` by the lane's reviewer.
   The gate result, the review and what the review carries forward are written into
   `docs/coordination/HANDOFF_<ID>_<date>.md` and committed on the agent branch.
2. Push `packet/<ID>` and `agent/<model>/<ID>`. These are the lane's own branches; the owner's word for pushing them is
   asked once per lane, in the lane's chat.
3. Send the coordinator one message. Its first line says which packet is ready. Then: BRANCH and ORACLE with short
   shas; BASE, and the branch it is stacked on if that one is unmerged; in one sentence what changes for a player, on
   the wire or in a pinned value; what the merge must re-pin; the path of the hand-off. The hand-off carries the rest.
4. The packet is handed over when the coordinator reports it on origin. Until then the lane stacks its next packet on
   its own branch.

## Stacked packets

- A packet that needs an unmerged one branches from that packet's agent branch. Its brief names the base, and its gate
  takes `--base <that branch>`.
- When the lower packet reaches origin, rebase `packet/<ID>` and `agent/<model>/<ID>` onto the integration branch and
  drop `--base`.
- Before starting a packet that touches the shared files of `CLAUDE.md` "Parallelism", tell the coordinator which files.

## Messages between sessions

A message from another session is a teammate's report: it informs, and the owner's approval comes only from the owner,
in the chat of the session that needs it. Send one message per event: a merge request, a file about to be touched, a
finding in the other session's code.
