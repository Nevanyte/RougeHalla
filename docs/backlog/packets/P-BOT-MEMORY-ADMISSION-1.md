# P-BOT-MEMORY-ADMISSION-1: admit the existing private Memory implementation

## Outcome and dependencies

Owner instruction, November 9, 2026 (America/Edmonton): resume remaining Rust gameplay, bots and quests in parallel
with Claude's Unity/networking work. DeepSeek implements Rust; Codex coordinates and reviews; Sol/Luna own most
non-Rust work. The old demo-only parking instruction is superseded for this backend lane.

Rebase and verify the existing DeepSeek private Memory implementation on current committed backend base
`4151b3af`, without rewriting completed work or activating incomplete public/live bot behaviour.
This is one prerequisite toward the complete bot, not a replacement for the full objective.

## Workspace and exclusive write scope

- Prepared branch: `codex/deepseek-bot-memory`.
- Prepared worktree: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-memory`.
- Code: `crates/rh-policy/src/bots/temporal_percept/memory.rs`, its `memory/` directory, and only the Memory module
  declaration in `crates/rh-policy/src/bots/temporal_percept.rs`.
- New evidence: `docs/evidence/backend-bot-memory-admission/`.
- No Unity, networking/protocol/decoders, rh-server, rh-sim, Cargo.lock, dependency, cloud, shared status, or existing
  fixture changes. Do not touch Claude's primary checkout or other worktrees/caches/processes.
- No merge or push. Commit only the scoped implementation and new evidence, then report the exact SHAs.

## Existing implementation to reuse

Original base `6a251045a05e3abd2ed63eb2df4d080930a22a64`; sealed original final `06c4115cea037b174a1ab1b5d91d934776232559`;
review repair final `3e3178b993ae88021f459b601ac20cb1717d22be`.
Code commits are `00972d3e`, `34128472`, `ed779463`. Inspect each before applying: preserve any newer upstream work
and apply only the exclusive scope. Historical evidence remains available in those immutable commits and in
`/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/coordination/reports/deepseek-rust.md`.
Read the independent report `full-memory-06c4115c-independent-review.md` in that same report directory and verify
the repaired code against its substantive findings. Do not treat old test receipts as checks on the new base.

## Contracts and behaviour

Read AGENTS.md and the current migration/requirements/contracts/backlog/ADR records. Preserve source fold order,
retained history, exact binary64 values, Undefined/Null distinctions and bounded legitimate perception inputs.
Existing captured source payloads and expected results are immutable. Preserve private inactivity: no new public
facts, protocol version, hidden reads, live Brain activation or claimed full-game parity.
No ML training, models, datasets, bindings or inference services.

## Acceptance and validation

1. Verify the five-file code diff from original base to repaired final; identify any conflicts with current base.
2. Run focused source-backed Memory tests, the existing memory_prefix and temporal protection controls on the new
   base. Preserve original 2,112 protection inputs and 773 NPC inputs and their exact comparison semantics.
3. Verify all four substantive review repairs and strict-reader repairs remain represented by tests; do not add
   blanket allowances or weaken assertions to pass.
4. Run scoped fmt and strict default/all-feature rh-policy library/test Clippy. Use pinned Rust 1.97.0,
   `--locked --offline`, `CARGO_INCREMENTAL=0`, debug info 0 and jobs 1. Use a new target owned by this packet at
   `/Users/nevinmckinnon/.codex/tools/roguehalla-backend-20261109/target-memory`; never clean shared targets.
5. Record commands, exit codes, code revision and remaining source-witness gaps in the new evidence README.
   Distinguish actual-source tests from synthetic controls. Retain a failing result before fixing implementation.
6. Return an exact scoped commit plus next concrete bot dependency. Coordinator obtains independent Sol review
   before integration. Full live strategy/reflex/hunting/loot/learning/tournament completion remains open.

## Failure line

Stop dependent work on a genuine source mismatch, required edit outside the lease, unexpected dirty prepared
worktree, or unavailable prerequisite. Report evidence; do not silently widen scope or mark the whole bot complete.
