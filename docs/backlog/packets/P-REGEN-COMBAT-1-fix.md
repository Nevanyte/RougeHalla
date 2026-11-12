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
- The two harness mirrors of the live config (make them build the live profile's `regen_in_combat = Off`; the brief
  first said the soak sits under `rh-server/tests/`, it does not):
  - `crates/rh-headless/tests/source_arena_soak.rs` (`fn live_config`, :13)
  - `crates/rh-headless/examples/hitbox_compare.rs` (`pub fn live_config`, :38)
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
  before this packet (no pinned constant exists in the file: the guard is an equality with a config that has neither
  field, the way the config read before either existed).
- A replay recorded under `regen_in_combat = Off` does not verify (diverges at step 0) when its config is swapped to
  `mob_spacing = Off, regen_in_combat = Legacy`, and the same checkpoint restored under that config has another state
  hash. (`Sim::restore` takes the config from the checkpoint itself and compares it with nothing, `checkpoint.rs:66`;
  the replay's per-step hashes, `replay.rs:225-250`, are the artifact that checks the statics identity.)
- `cargo run -p rh-parity --bin parity-report` all MATCH; `scripts/gate.sh --oracle packet/P-REGEN-COMBAT-1-fix` passes.

### Collision observed by the oracle (2026-11-11, on `feature/unity-rework` @ 980229ed)
`mob_spacing = Auto, regen_in_combat = Off` and `mob_spacing = Off, regen_in_combat = Legacy` give the same state hash
`0xf68448868dd62ffe` for the same World (seed 75, one Holy fighter, one step). Cause: `SimConfig` serializes
`mob_spacing` then `regen_in_combat` as its last two fields (`statics.rs:252-257`); each default is a unit, which
`HashSer::serialize_unit` folds as nothing (`hash.rs:190`), each `Off` is the string `"off"` (`statics.rs:270-277`,
`archetype.rs:91-98`), and struct fields fold no name (`hash.rs:302`). The digest (`statics.rs:76`) therefore sees the
same word sequence `[.., hitboxes, len 3, "off"]` for both. The replay recorded under `regen_in_combat = Off` verified
in full under the other config (final hash `10054959343917700989`).

### Constraint the implementer must respect
The existing case `regen_in_combat_off_state` (`hash_coverage.rs:686`) asserts that the JSON checkpoint carries
`regen_in_combat: "off"`, and it is not to be edited. So the JSON encoding stays `"off"` (and `null` for `Legacy`); only
what the hashing serializer folds for `Off` may change. `HashSer::is_human_readable` returns `false` (`hash.rs:133`) and
`serde_json` returns `true`, so `Serialize for RegenInCombat` can fold a value distinct from any `mob_spacing` encoding
when not human-readable while still writing `"off"` to JSON; then `Deserialize` must keep reading JSON `"off"` (and any
non-human-readable form it writes, if a binary checkpoint format is in use). If the implementer finds this impossible,
changing the existing assertion needs owner approval: stop and say so. Do not touch `MobSpacing`'s encoding (moves
`Off` A/B hashes; out of scope).

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/hash_coverage.rs`: the new items after `native29_produced_hints_and_all_three_config_tags_roundtrip`
  (`spacing_regen_base`, `with_spacing_regen`, `mob_spacing_and_regen_in_combat_are_four_separate_statics_identities`
  (fails today), `a_regen_off_replay_does_not_verify_under_spacing_off` (fails today),
  `the_default_spacing_and_regen_still_fold_nothing` (guard, passes today)). Commit `oracle: P-REGEN-COMBAT-1-fix`.
- `docs/backlog/packets/P-REGEN-COMBAT-1-fix.md` (this brief)

## 9. Validation commands
- `cargo test -p rh-sim --test hash_coverage`, `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Opus. Small diff; the risk is moving a default-config hash.

## 11. Known traps
- Fixing it by folding field names for every config field moves every hash: change only this field's encoding.
- The harness mirrors are test helpers: changing them may change what a soak or comparison measures; say so in the
  hand-off rather than re-pinning numbers silently.

## Notes from previous attempts
