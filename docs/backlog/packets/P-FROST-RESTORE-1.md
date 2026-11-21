# P-FROST-RESTORE-1: a Frost Wall Wish checkpointed in flight restores

- **Serves:** C-DET (checkpoints reproduce every step hash) for the live worlds since P-FROST-WALL-3; a defect fix, no
  phase item of its own (the restore half of P-FROST-WALL-3's "the live profiles select Frost Wall").
- **Implementer tier:** implementer-opus (restore validation: a save/restore and security surface of `rh-sim`)
- **Reviewer:** reviewer-opus
- **Integration base:** `coord/int-63` (`289fb9424`, the P-AUG-TUNE-1 merge, which last changed
  `abilities/checkpoint.rs`). `feature/unity-rework` did not yet hold that merge when this packet was cut.
- **D-rules touched:** D1 n/a (no legacy mechanic: legacy has no checkpoints) · D2 n/a · D5/D6/D9 none. Parity fixtures
  run the default config (`Freeze`), which this packet does not change.

## 1. ID and outcome
P-FROST-RESTORE-1. Since P-FROST-WALL-3 every live world (`SimConfig::live_content()`, `crates/rh-sim/src/statics.rs:549`)
plays `frost_wish: FrostWish::Wall`: Frost's Wish, staged under Freeze's id, is the Frost Wall row
(`abilities::definition_for`, `crates/rh-sim/src/abilities/mod.rs:390-398`), a placed cast
(`Target::Placed { range: 450, min_range: 64 }`) whose producer records no unit target
(`crates/rh-sim/src/systems/abilities/mod.rs:113-141`). The Wish restore validator
(`crates/rh-sim/src/abilities/checkpoint.rs::validate`) reads the catalog row instead: `definition(wish(faction))` at
`:173` and `definition(c.ability)` at `:291`, which is Freeze (`Target::Unit(450.)`). At `:311-315` it then requires a unit
target on the in-flight producer and returns `Err("invalid Wish target provenance")`. **Every checkpoint taken during a
Frost Wall's 250 ms cast window on a live server is refused on restore** (measured: the oracle below, red on the base
with exactly that message, on the first tick of the flight, under both the bare switch and the live rules).

The fix: the restore validator judges every Wish and ability row by the world's own definition
(`definition_for(&k.config, …)`), including the Wish cooldown envelope it builds from `cooldown()` (`:60-65`), which
reads the catalog row too. The cast producer's spend cooldown (`systems/abilities/mod.rs:157`) reads the same
world-selected cooldown, so the producer and the validator cannot diverge for any config-selected row. Today Frost Wall
and Freeze share `cast_ms` 250, `cooldown_ms` 45000 and `charges` 1, so only the target kind differs and no clock
changes.

## 2. Dependencies
`coord/int-63`. Serial with any packet that edits `crates/rh-sim/src/abilities/checkpoint.rs` (the Wish restore envelope;
P-AUG-NATIVE-3 is planned against it).

## 3. Relevant legacy paths
None: checkpoint restore is a Rust-only surface (legacy `packages/` keeps no checkpoints). The Frost Wall row's legacy
source (unreleased `78dd8bd4` `frostWall`) is cited in P-FROST-WALL-1.

## 4. New paths
- `crates/rh-sim/src/abilities/frost_restore_tests.rs` (oracle).

## 5. Exclusive write scope
- `crates/rh-sim/src/abilities/checkpoint.rs`
- `crates/rh-sim/src/abilities/mod.rs` (a world-selected cooldown beside `cooldown()`; the test module declaration is a
  `stub:` commit)
- `crates/rh-sim/src/systems/abilities/mod.rs` (the producer's cooldown read only)

Not in scope: `observe.rs` (shared file; `OwnerView::of` reads the catalog's cooldown and charges for the HUD, an
observation, not a restore rule), `rh-policy` (bots read `abilities::cooldown`), `effect_checkpoint.rs`.

## 6. Contracts and references
C-DET (checkpoints reproduce every step hash), C-INPUT (the producer is the one cast path). `check_world` in
`crates/rh-sim/src/checkpoint.rs` calls `abilities::checkpoint::validate`. P-FROST-WALL-1 (the row behind the switch),
P-FROST-WALL-3 (live worlds select it), P-AUG-TUNE-1 (last change to the Wish restore envelope).

## 7. Behaviour to preserve
- No state hash, step, event or content hash changes in any world: the producer's cooldown number is unchanged for
  every row today.
- Freeze worlds: an in-flight Freeze with a unit target restores; a Freeze producer without one is refused.
- Frost Wall worlds: an in-flight wall with no unit target restores; one with a unit target is refused.
- Every existing Wish restore test stays green: `abilities::checkpoint::wishful_in_flight_tests`,
  `abilities::source_tests` (including `wishful_rework_restore_tests`), the forged-clock tests, `tests/wish_*`.

## 8. Acceptance checks
`crates/rh-sim/src/abilities/frost_restore_tests.rs`:
1. `a_frost_wall_checkpointed_in_flight_restores_and_plays_on`: under `frost_wish = Wall` and under the live rules,
   every tick of the wall's flight checkpoints and restores to the same hash; the first tick's checkpoint plays on equal
   for 12 ticks through the landing, and the wall stands in both. **Red on the base** (`invalid Wish target
   provenance`, flight tick 0).
2. `a_freeze_checkpointed_in_flight_still_restores_and_plays_on`: the Freeze world, unchanged. Green on the base.
3. `each_frost_world_refuses_the_other_world_s_target_kind`: the played in-flight state passes the validator, and a unit
   target forged onto a Wall cast (bare and live rules), or the target removed from a Freeze cast, is refused with
   `invalid Wish target provenance` and by `Sim::restore`. **Red on the base** (the played Wall state is refused).

### Oracle files (read-only for implementers)
- `crates/rh-sim/src/abilities/frost_restore_tests.rs`
- this brief

## 9. Validation commands
- `cargo test -p rh-sim --lib frost_restore_tests`
- `cargo test -p rh-sim --lib abilities::`
- `scripts/gate.sh --quick --base coord/int-63 --oracle packet/P-FROST-RESTORE-1`

## 10. Risk and suggested model tier
Opus. Restore validation is where a forged or corrupted checkpoint is refused; the fix must widen nothing beyond the
world's own row (a Freeze world must not start admitting placed producers, nor a Wall world unit ones). Low blast
radius: the numbers are equal today, so the hash and every step are untouched.

## 11. Known traps
- `definition()` is the catalog (content hash, `visit_content`); it stays. Only reads that judge a world's state switch
  to `definition_for`.
- `abilities::cooldown()` is public and read by `rh-policy`; keep its signature (a cross-crate change otherwise) and add
  the world-selected form beside it.
- The full live world cannot start through `Sim::reset_active` (source planning, PvE content needs the source map); the
  oracle takes `live_content()`'s Wish-relevant fields on the default world, as `tests/frost_wall_held_key.rs` does.
- `effect_checkpoint::validate` admits a Freeze stun status in a Wall world, which no Wall world can produce (an
  over-admission, not a `definition()` read). Out of scope here; reported in the hand-off.
