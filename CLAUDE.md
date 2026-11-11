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

## Routing

| Work | Agent | Model / effort |
|---|---|---|
| Where is X, what does Y look like, which tests cover Z, where is the legacy code | `scout` | Haiku / low |
| Packet brief plus one failing oracle test (loose proof; see AGENTS.md) | `oracle-author` | Sonnet / medium; Opus / high (model override) for `rh-sim` state, tick, RNG, hash and wire packets |
| Mechanical work with a clear oracle: renames, fixture refresh by documented command, docs, small tests outside `rh-sim` | `implementer` | Haiku / medium |
| **Default implementer**: any single-area task with an oracle; C#/Unity; CI, `hosting/`, scripts; L1 escalation | `implementer-sonnet` | Sonnet / medium |
| `rh-sim` tick order, state, RNG or save/hash; wire format; migrations; security; cross-crate; L2 escalation | `implementer-opus` | Opus / high |
| Determinism, replay, state-hash or parity divergence that Opus failed twice (L3) | `debugger` | Fable 5.2 / high |
| Review of a gate-green branch | `reviewer` | Sonnet / medium |
| Review of anything in the Opus implementer row, every integration merge, and the final combined-tree review | `reviewer-opus` | Opus / high |

Rules:
1. **No oracle, no implementer.** A packet without a failing test, capture or golden vector goes to `oracle-author` first.
   For security packets `implementer-opus` writes its own failing tests first.
2. A packet whose write scope touches two crates, or the wire, is cross-crate: Opus implements, `reviewer-opus` reviews.
3. Owner instruction stands: most sub-agents are Sonnet, Haiku takes simple work, Opus is for the Rust that matters and for
   merges. Fable runs only as `debugger`, or when the owner names it.

## Escalation

`implementer` → `implementer-sonnet` → `implementer-opus` → `debugger` (determinism or parity divergence only).

- Each tier gets two full-gate attempts; the second attempt runs one effort level higher than the agent's default.
- Escalate with the packet, the previous branch name (a reference, not a base) and the gate's failure block.
- After Opus fails twice on anything that is not a divergence, stop: the packet goes back to the coordinator to split it or
  fix the oracle, and the owner hears about it.
- An attempt ends at once if it edits an oracle file, works outside the write scope, or touches a protected path.

## Pipeline per packet

1. The packet exists in `docs/backlog/packets/<ID>.md` and names its phase/item, write scope and oracle files.
2. `oracle-author` commits the brief and failing oracle on `packet/<ID>`, branched from the integration branch
   (`docs/agent/INTEGRATION_BRANCH`). The oracle fails for the right reason: an assertion, not a compile error.
3. The implementer works on `agent/<model>/<ID>` from `packet/<ID>` in its own worktree, iterating with
   `scripts/gate.sh --quick`, finishing with `scripts/gate.sh --oracle packet/<ID>`.
4. Only gate-green branches are reviewed. Verdict: `LAND`, `LAND WITH NOTES` (at most three notes, each becoming a
   `<ID>-fix` packet at the same tier) or `REJECT` (with the tier that retries).
5. The coordinator merges `LAND` branches into the integration branch, re-runs the full gate on the merge, records the
   result in the MIGRATION checkpoint, and removes the worktree.

## Parallelism

- At most three Rust implementers at once (each worktree builds its own `target/`), and never two whose write scopes
  overlap. The backlog's shared-file rule applies: packets touching `schedule.rs`, `content.rs`, `observe.rs`, the
  protocol and decoders, `wire.rs`, `Cargo.toml` or the capture tool merge one at a time.
- Give sub-agents paths and the packet, never pasted files. Worktree agents start from the coordinator's `HEAD`
  (`worktree.baseRef` in `.claude/settings.json`), so their first command checks out their own branch.
- Reviewer notes are scoped to one packet. They never become new rules in this file or `AGENTS.md`.
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
