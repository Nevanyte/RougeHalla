@AGENTS.md

# Claude Code on RogueHalla

These rules are mandatory for every Claude session and sub-agent in this repository (owner direction 2026-11-10). The
full process, with the reasons behind it, is [docs/agent/README.md](docs/agent/README.md); model facts and costs are in
[docs/agent/MODELS.md](docs/agent/MODELS.md).

## The coordinator

The main session is the **coordinator**. It reads the MIGRATION checkpoint, picks packets, writes or dispatches their
oracles, routes implementation, reads gate results and reviews, and integrates. It is the only writer of shared status
records and `Cargo.lock`. It sends lookups to `scout` and code to the implementer tiers, keeping its own context for
decisions; a fix of a few lines it may make itself, through the same gate.

A session that owns one line of work beside the coordinator is a **lane**. Before a lane dispatches, pushes or asks for
a merge: [docs/agent/LANES.md](docs/agent/LANES.md).

## Routing

| Work | Agent | Model / effort |
|---|---|---|
| Where is X, what does Y look like, which tests cover Z, where is the legacy code | `scout` | Haiku / low |
| Packet brief plus one failing oracle test (loose proof; see AGENTS.md) | `oracle-author` | Sonnet / medium; Opus / high (model override) for `rh-sim` state, tick, RNG, hash and wire packets |
| Mechanical work with a clear oracle: renames, fixture refresh by documented command, docs, small tests outside `rh-sim` | `implementer` | Haiku / medium |
| **Default implementer**: any single-area task with an oracle; C#/Unity; CI, `hosting/`, scripts; L1 escalation | `implementer-sonnet` | Sonnet / medium |
| Map-generator refactor inside `rh-sim` alone (single crate) that changes no generated map and no draw, proven by a digest guard in its oracle | `implementer-sonnet` | Sonnet / medium; `reviewer-opus` reviews |
| `rh-sim` tick order, state, RNG or save/hash; wire format; migrations; security; cross-crate; L2 escalation | `implementer-opus` | Opus / high |
| A **dial** change: a named constant listed in a dials index (`docs/unity/DIALS.md`), moved inside its pinned range; looks, layout or feel only ([docs/agent/TUNING_LANE.md](docs/agent/TUNING_LANE.md)) | `implementer-sonnet`, no packet, no reviewer | Sonnet / medium |
| Determinism, replay, state-hash or parity divergence that Opus failed twice (L3) | `debugger` | Fable 5.2 / high |
| Review of a gate-green branch | `reviewer` | Sonnet / medium |
| Review of anything in the Opus implementer row, every integration merge, and the final combined-tree review | `reviewer-opus` | Opus / high |

Rules:
1. **No oracle, no implementer.** A packet without a failing test, capture or golden vector goes to `oracle-author` first.
   For security packets `implementer-opus` writes its own failing tests first.
   The one exception is the tuning lane: a dial's range test is its oracle, the quick gate and a look check are its
   proof, and the coordinator dispatches it and reads the report without shepherding it. A new dial, a behaviour
   change or anything under `crates/` is a packet.
2. A packet whose write scope touches two crates, or the wire, is cross-crate: Opus implements, `reviewer-opus` reviews.
3. Owner instruction stands: most sub-agents are Sonnet, Haiku takes simple work, Opus is for the Rust that matters and for
   merges. Fable runs only as `debugger`, or when the owner names it.

## Escalation

`implementer` → `implementer-sonnet` → `implementer-opus` → `debugger` (determinism or parity divergence only).

- Each tier gets two gate attempts; the second attempt runs one effort level higher than the agent's default.
- Escalate with the packet, the previous branch name (a reference, not a base) and the gate's failure block.
- After Opus fails twice on anything that is not a divergence, stop: the packet goes back to the coordinator to split it or
  fix the oracle, and the owner hears about it.
- An attempt ends at once if it edits an oracle file, works outside the write scope, or touches a protected path.

## Pipeline per packet

1. The packet exists in `docs/backlog/packets/<ID>.md` and names its phase/item, write scope and oracle files.
2. `oracle-author` commits the brief and failing oracle on `packet/<ID>`, branched from the integration branch
   (`docs/agent/INTEGRATION_BRANCH`). The oracle fails for the right reason: an assertion, not a compile error
   (`scripts/gate.sh --oracle-check` passes on `packet/<ID>` before an implementer starts).
3. The implementer works on `agent/<model>/<ID>` from `packet/<ID>` in its own worktree or the one its brief names,
   iterating with `scripts/gate.sh --quick`, finishing with `scripts/gate.sh --quick --oracle packet/<ID>`. The full gate
   is the coordinator's, on the merged tree.
4. Only gate-green branches are reviewed. Verdict: `LAND`, `LAND WITH NOTES` (at most three notes, each a defect in
   behaviour, a broken guarantee or a structural problem, each becoming a `<ID>-fix` packet at the same tier) or `REJECT`
   (with the tier that retries). The reviewer's `Minor, not notes` list goes into the hand-off and gets no packet (owner
   direction 2026-11-13).
5. The coordinator merges `LAND` branches into the integration branch, runs the full gate on the merge
   (`scripts/gate.sh --coordinator --keep-going`), records the result in the MIGRATION checkpoint, and removes the
   worktrees it claimed (`scripts/agent-worktrees.sh clean --session <id>`). A worktree without a row in
   `.agent-runs/worktrees.csv` belongs to another session: leave it.

## Parallelism

- At most three Rust implementers at once (each worktree builds its own `target/`), and never two whose write scopes
  overlap. The backlog's shared-file rule applies: packets touching `schedule.rs`, `content.rs`, `observe.rs`, the
  protocol and decoders, `wire.rs`, `Cargo.toml` or the capture tool merge one at a time.
- Give sub-agents paths and the packet, never pasted files. Worktree agents start from the coordinator's `HEAD`
  (`worktree.baseRef` in `.claude/settings.json`), so their first command checks out their own branch, unless the brief
  names the worktree to work in.
- Reviewer notes are scoped to one packet. They never become new rules in this file or `AGENTS.md`.
- After each launch, `scripts/agent-worktrees.sh claim <agent-id> <packet> <session>`; when the agent has reported,
  `done <agent-id>`.
- Open owner decisions live in `docs/coordination/OWNER_QUEUE.md` (each with the default in force); recorded ones are
  indexed in `docs/OWNER_DECISIONS.md`. Search the index before writing a brief; status notes go to the owner on a push
  or a decision, not on every agent report.
- Log every attempt to `.agent-runs/log.csv`: `date,packet,agent,model,attempt,gate,minutes,notes`. ORDER_OF_OPERATIONS
  asks for coordinator throughput; this is that measurement.

## Approvals

Without asking: reads, cargo and the gate, local commits on `packet/*` and `agent/*` branches, worktrees, merging a
reviewed `LAND` branch into the integration branch named in `docs/agent/INTEGRATION_BRANCH`.

Ask the owner in chat first, per action: `git push`; merging into `main` or `optimization_port`, or promoting the
integration branch anywhere;
any deploy or `aws` command that changes resources; edits under `packages/`, `hosting/`, `.github/`, `.claude/`, any
`AGENTS.md`/`CLAUDE.md`; new migrations; deleting files or branches; signing `DEVIATIONS.md` rows (owner only). An
approval recorded in the MIGRATION checkpoint covers exactly the scope it names.
