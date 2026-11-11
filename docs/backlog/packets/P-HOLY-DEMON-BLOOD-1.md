# P-HOLY-DEMON-BLOOD-1: Holy gains lifesteal per camp cleared, as legacy

- **Serves:** ORDER_OF_OPERATIONS phase 2, items 13-14 (mechanic port under C-PARITY); closes DEV-012
- **Implementer tier:** implementer-sonnet (one term in a combat formula, no new state; escalates to implementer-opus per the ladder)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 byte-exact capture (it feeds combat healing) · D2 n/a (legacy behaviour, not a deviation) ·
  D5/D6/D9 none

## 1. ID and outcome
Legacy adds `holyCampLifestealOf(campClears)` (0.005 per eligible camp clear) to a Holy player's lifesteal. The Rust sim
counts camp clears (`Player.camps_cleared`, `crates/rh-sim/src/state.rs:593`) but never applies them, so a Holy player
who farms heals less than in the live game, and the server's build marks omit the term (DEV-012). When this lands Rust
applies the passive where legacy does, the build marks include it, and DEV-012's exception is gone.

## 2. Dependencies
none

## 3. Relevant legacy paths
- `packages/shared/src/constants.ts:81`: `HOLY_CAMP_LIFESTEAL_PER_CLEAR = 0.005`
- `packages/shared/src/championPassives.ts:6-9`: `holyCampLifestealOf(campClears)` (check how the count is bounded)
- `packages/server/src/sim/factions.ts:896`: the term added to the combat lifesteal for a Holy player
- `packages/shared/src/combatReadability.ts:133`: the same term in the build-mark leech score

## 4. New paths
- a parity scenario capturing Holy lifesteal after camp clears (name chosen by the oracle author, under `parity/`)
- its Rust test under `crates/rh-parity/`

## 5. Exclusive write scope
- `crates/rh-sim/src/systems/signatures.rs` (the lifesteal assembly near `:427-437`)
- `crates/rh-sim/src/constants.rs` (the constant)
- `crates/rh-sim/src/kill_augments.rs` (`invested_stats`, `build_marks`, the comment at `:211-215`) and its
  `build_marks_tests`
- `crates/rh-sim/src/content.rs` only if the constant must enter `content_hash` (shared file: say so in the hand-off)

## 6. Contracts and references
- C-PARITY: captured legacy fixture plus parity test. C-NUM: f64, legacy operation order.
- C-TICK: no schedule row moves. C-RNG: no draw is added.
- `docs/DEVIATIONS.md` DEV-012 (resolution: fold the term in and drop the `holy_camp_clears` exception in
  `parity/build-marks/legacy.json:544`'s Rust comparison).
- `crates/rh-sim/AGENTS.md`: no_alloc, hash_coverage and `check_world` stay green.

## 7. Behaviour to preserve
- Every existing Holy fixture (`parity/fixtures/holy_*`, `signature_holy`) still MATCH: with zero camp clears the term
  is 0.
- No new serialized field (`camps_cleared` exists): checkpoint 31 and replay 25 unchanged. If the content hash changes,
  the hand-off states the new value for the coordinator.
- Lifesteal caps (`LS_CAP`, `LIFESTEAL_MAX`) apply as in legacy: check whether the camp term is inside or outside each.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-HOLY-DEMON-BLOOD-1` passes (full).
- `cargo run -p rh-parity --bin parity-report`: the new scenario MATCH; all others unchanged.
- `build_marks` equals legacy for the `holy_camp_clears` case with no exception.
- A non-Holy player with camp clears gains nothing.

## Oracle files (read-only for implementers)
- the new capture and its parity test (listed by the oracle author in this section on `packet/P-HOLY-DEMON-BLOOD-1`)
- `crates/rh-sim/src/kill_augments.rs` test `build_marks_tests` case for `holy_camp_clears`

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes`
- `cargo test -p rh-parity`
- `cargo run -p rh-parity --bin parity-report`
- the capture command for the new scenario (documented in `parity/README.md`; exact fixtures need Linux x64 and
  Node 22.23.4)

## 10. Risk and suggested model tier
Opus: `rh-sim` combat path and a parity capture. Small diff, high cost if the term lands at the wrong point of the
lifesteal sum.

## 11. Known traps
- Legacy counts "eligible" clears: read `championPassives.ts` for the bound and for which clears count.
- The term is added per hit to the lifesteal fraction, not to a stored stat: order against the leech-card multiplier
  and the caps matters.
- This raises Holy sustain. The owner reported Holy as too strong in the beta; it is still legacy behaviour and is
  ported as is. The hand-off says so under RISKS.
- If no Linux x64 / Node 22.23.4 container is available for an exact capture, stop and report: do not hand-write a
  fixture.

## Notes from previous attempts
