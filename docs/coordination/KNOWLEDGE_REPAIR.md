# Knowledge and fair-view repair packet

Status: Ready for mechanical implementation; lead review required before merge.
Owner: DeepSeek Rust lane. Integration and design owner: OPTimization_port coordinator.
Base: immutable `13d38a41` in a new isolated branch/worktree. Preserve the active observation-leaf work.

## Changes

1. `HumanBot::reset` must create Knowledge using a separate RNG seeded with the legacy `derive(cfg.seed, 3)`, as `packages/server/src/bots/brain/brain.ts` lines141–147 do. It must not consume the decision, motor or lapse streams. The current implementation advances `self.decide` by70 draws.
2. Knowledge diagnostic `why` text must use JavaScript-compatible `toFixed(2)`, including exact half ties. Reuse `rh_sim::kill_augments::js_to_fixed`; do not substitute Rust decimal formatting or multiply-then-round.
3. The fair-view helper must treat an explicit `MessageData::Null` player as missing, matching source `probe.player ?? firstPlayer(...)`.

The source `derive` is at `brain.ts` lines46–50. Confirm it from source; do not infer a new seed scheme. Tag3 examples: seed0→3971731199, seed1→197380189, seed7→2057029952, seed42→3268108958, seed4294967295→1587572149.

## Proof and limits

- Add a seat-level reset regression: after reset the next decision draw equals the original stream's first draw, and Knowledge equals the separately derived tag3 construction. The old decision-stream wiring must fail this test.
- Extend source provenance to cover the actual brain wiring or a read-only probe of that wiring; a fixture calling only `createKnowledge` does not certify its caller.
- Capture half-tie diagnostic and explicit-null player cases from the existing pinned legacy runtime. Preserve existing fixture payloads; any additive capture is separately identified. Do not hand-edit expected gameplay.
- Existing Knowledge, planning and fair-view fixtures must still pass. Run focused tests and a targeted restored-control mutation, with no broad repeated map campaigns.
- No observation/protocol/version/schema/Cargo.lock/shared-status changes. No new memory/strategy design or ML work.

Success: three source mismatches fixed, source and seat tests pass, wrong-stream mutant fails semantically, clean committed packet and compact report. Failure: any fixture weakening, compile-error-only mutant result, decision-stream drift, hidden-state access or unrelated interface change. Report blockers instead of widening scope.

Report: `~/.codex/tools/rougehalla-stage2/coordination/reports/deepseek-rust.md`, with exact SHA and commands. The lead owns acceptance and merge.
