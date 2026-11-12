# P-REGEN-COMBAT-1-fix: `regen_in_combat = Off` has its own place in the statics digest

- **Serves:** owner beta-follow-up decision 2 (MIGRATION, 2026-11-10); reviewer-opus notes on P-REGEN-COMBAT-1
  (2026-11-11, LAND WITH NOTES: one REAL, one MINOR)
- **Implementer tier:** implementer-opus (rh-sim config folded into the state hash, checkpoints and replays)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1: existing parity fixtures stay byte-identical (the default `Legacy` still folds nothing) · D2 n/a

## 1. ID and outcome
`RegenInCombat::Off` serializes as the string `"off"`, the same string `mob_spacing` uses for its own `Off`. The
hashing serializer folds values, not field names, and both fields fold nothing in their default state, so a config with
`mob_spacing = Off, regen_in_combat = Legacy` and one with `mob_spacing = Auto, regen_in_combat = Off` can produce the
same statics digest: two different rule sets, one identity, and a replay or checkpoint from one is accepted by the
other. When this lands `Off` folds a value no other config field can produce, a test proves that every pair of the
four `mob_spacing` x `regen_in_combat` combinations has a different digest, and the doc comment in
`crates/rh-sim/src/hash.rs` that lists what the statics digest covers names the new field. The two harness mirrors of
the live config also run the live rule.

## 2. Dependencies
none (P-REGEN-COMBAT-1 is merged)

## 3. Relevant legacy paths
- none (identity of a Rust-only switch)

## 4. New paths
- none

## 5. Exclusive write scope
- `crates/rh-sim/src/statics.rs` (the encoding of `RegenInCombat`), `crates/rh-sim/src/hash.rs` (doc comment only)
- `crates/rh-sim/tests/hash_coverage.rs` (new cases)
- `crates/rh-server/tests/source_arena_soak.rs` and the `live_config` helper of the hitbox comparison in `rh-headless`
  (make them build the live profile's `regen_in_combat`); name the exact files in the hand-off
- Checkpoint or replay version constants only if the encoding change makes an existing `Off` checkpoint unreadable
  (say which and why; nothing with `Off` has shipped)

## 6. Contracts and references
- C-RNG / save-hash rule in `AGENTS.md` "Determinism": every serialized field reaches save, restore and the state hash.
- `docs/backlog/packets/P-REGEN-COMBAT-1.md`: `Legacy` serializes as nothing so no existing hash, fixture, checkpoint
  or replay moves. That stays true.

## 7. Behaviour to preserve
- Every parity fixture, the hash tape and the determinism sweep byte-identical (default config).
- `Off` keeps round-tripping through JSON config, checkpoint and replay; an unknown value is still refused.

## 8. Acceptance checks
- Oracle (`hash_coverage.rs`): the four combinations of `mob_spacing` in {Auto, Off} and `regen_in_combat` in
  {Legacy, Off} give four different statics digests (today two collide); `Legacy` + default spacing equals the digest
  before this packet (pinned constant already in the file, or the existing equality test).
- A checkpoint taken under `regen_in_combat = Off` is refused by a sim built with `mob_spacing = Off` and `Legacy`.
- `cargo run -p rh-parity --bin parity-report` all MATCH; `scripts/gate.sh --oracle packet/P-REGEN-COMBAT-1-fix` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-REGEN-COMBAT-1-fix`

## 9. Validation commands
- `cargo test -p rh-sim --test hash_coverage`, `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Opus. Small diff; the risk is moving a default-config hash.

## 11. Known traps
- Fixing it by folding field names for every config field moves every hash: change only this field's encoding.
- The harness mirrors are test helpers: changing them may change what a soak or comparison measures; say so in the
  hand-off rather than re-pinning numbers silently.

## Notes from previous attempts
