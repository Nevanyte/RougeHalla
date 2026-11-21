# P-AUG-NATIVE-3c: Hazard Walker's ice effect, and Pathfinder's speed in the owner's speed mirror (walk prediction)

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-CARDS-2/3), under the owner's 2026-11-18 approval of the elite and
  augment rework (`docs/OWNER_DECISIONS.md:13`, row "Elite and augment rework"; plan of record
  `docs/backlog/AUGMENT_ELITE_REWORK.md:173`, row P-AUG-NATIVE-3c). The two gaps were left by P-AUG-NATIVE-3
  (`docs/backlog/packets/P-AUG-NATIVE-3.md` section 1, "Ice effect: pinned only as counting" and "Flag (client)").
- **Implementer tier:** implementer-opus (walk hot path in `rh-sim`, the owner block the client's mirrored walk
  prediction reads, a new golden vector shared with C#).
- **Reviewer:** reviewer-opus.
- **Integration base:** `coord/int-73` @ `be990828c` (protocol 20, observation 33, policy contract 29,
  `rh-checkpoint/36`). Gate runs take `--base coord/int-73`.
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) against the bog/ember rule NATIVE-3 already pins,
  plus a Rust golden vector replayed by the C# prediction (ADR 0008: prediction mirrored from Rust, checked with Rust
  vectors) · D2 n/a · D5/D6 none · D9: the client's prediction code is unchanged; it reads a value the server now
  computes correctly. Headless and policy runs never read it.
- **Parallel:** P-AUG-NATIVE-5 (Marked Man: `observe.rs`, minimap). This packet does not touch `observe.rs`.

## 1. ID and outcome

When this lands (all under `AugmentRule::Rework`; a Legacy world and a Rework world without these two cards play
byte-identically to the base):

1. **Hazard Walker on ice.** Ice is a slip surface: `terrain::surface` gives tile kind 6 an acceleration
   `slip_accel(TERRAIN_SLIP_MS) = PLAYER_SPEED x 1000 / 400 = 425 u/s^2` (`crates/rh-sim/src/terrain.rs:61,270`), the
   walk then changes velocity at most that fast (`systems/terrain/walk.rs:200-260` `step`, `:390` `walk`), so a fighter
   needs 400 ms to reach (or lose) full speed. The slip quantity is that time. **Decision (consistent with ember and
   bog: each stack takes `REWORK_HAZARD_WALKER_RESIST_PER` = 4% of the hazard's effect, immune after 20 s on it):**
   - resisted: the holder's slip time is `TERRAIN_SLIP_MS x (1 - resist)`, i.e. the ice acceleration it meets is
     `accel / (1 - resist)`, `resist = RESIST_PER x counter` (15 stacks: 60%, a 160 ms slip). As bog's slow `1 - m` and
     ember's burn share are scaled by `1 - resist`, the ice's slip is. `1 - resist >= 0.4` (the cap is 15), so no
     division by zero is reachable; `check_world` already bounds the counter.
   - immune (mark bit 2): the acceleration is 0 everywhere for this holder, so the walk is the ordinary
     `advance_along_path` walk (`movement.rs:83-89`), a held slip state is dropped and regripped the next walk
     (`movement.rs:84-87`, existing code), and the walk hint treats the ice as ground (no `slip` suppression).
   - **Reads (one guard each, holder-only):** `systems/movement.rs:71` (the accel that chooses slip or walk) and `:102`
     (the per-substep `slip_at` closure), and `systems/walk_hint.rs:173-186` `traction_at` (used at `:51` and by
     `ice_along` `:192`). A thin `cards::native` pass-through (like `hazard_guard`, `cards/native/mod.rs:115`) maps a raw
     accel to the holder's: `0 -> 0`; immune `-> 0`; else `accel / (1 - resist)`; a build with no native card returns
     the raw value untouched (one `build.native.is_empty()` branch). Mobs have no build: unchanged.
   - **Exposure and hook:** `movement.rs:76-78` counts `w.terrain.seconds[2]` only while the accel it read is `> 0`: an
     immune holder stops counting ice exposure, as an immune holder stops counting bog (`bog_read` returns
     `counts = false`) and ember (`burn_dt` `continue`s before `seconds[0]`). The native ice `HazardTick`
     (`systems/terrain/mod.rs:53`, raw `effect(..).accel`) is left as it is: the meter is capped at
     `REWORK_HAZARD_WALKER_IMMUNE_MS`, so an immune holder's ticks change nothing.
   - **Same tick:** the ice `HazardTick` fires in the move-modifier read (`movement::multipliers`, before `walk`), so
     the walk of the tick that fills the ice meter already reads the new mark and stacks. This differs from ember and
     bog (whose filling tick is still resisted) only by schedule position; no snapshot is added. Not pinned tick-exact.
2. **Pathfinder in the speed mirror.** `native::move_speed_share` (`cards/native/mod.rs:107`) is read live only in
   `modifiers::movement` (`modifiers/mod.rs:591-606`). The owner block the client predicts with
   (`OwnerCombat.speed_milli`, projected from the cached wire mirror `Runtime::owner_combat_mirrors`,
   `modifiers/mod.rs:137`, `owner_combat.rs:78`) and the owner readout (`build_summary.rs:68` `move_speed`) miss it, so
   `LocalMotion` (`client-unity/RoguehallaNet/Net/LocalMotion.cs:402-427`, `LocalMotion.Walk.cs:16,78`) walks a
   holder up to 24% slow and the server corrects it. **Decision: one read, not one cache.**
   - A single accessor beside `modifiers::movement`, `pub(crate) fn speed_mult(p: &Player) -> f64` (name is the
     implementer's), returns `mirrors().speed_mult x (1 + share)`, and **exactly** `mirrors().speed_mult` when the share
     is 0. `modifiers::movement` calls it (its value is unchanged: the walk of a holder is the one NATIVE-3 pinned).
   - The owner block's speed lane (`owner_combat::project_where`): share 0 -> the cached wire value, bit for bit, as
     today; share > 0 -> `stat_fold::encode_mult(speed_mult(owner))` (the wire's own milli rounding, the rounding every
     mirror already carries: at most 0.0005 x 170 u/s x 50 ms = 0.004 u per tick, under the C# `WalkTol` 0.01).
   - Readers that read the walk speed use the accessor: `build_summary.rs:68` (the owner's readout) and
     `plague_zombies.rs:482` (a zombie keeps pace with its owner: a Plague holder must not outrun its zombie).
   - **Why not fold the share into the cached wire mirror** (`modifiers.wire[2]`): the cache is refolded only by
     `recompute`, which the kill hook does not run and which reruns `while` rows and tax sources mid-tick (a wider
     behaviour change); `Runtime::valid` (`modifiers/mod.rs:183-256`) checks `wire[2]` equal to the fold's product, so
     a folded share would refuse every `rh-checkpoint/36` checkpoint holding a Pathfinder counter (a format break). The
     accessor keeps the cache, its validator and the checkpoint unchanged, and makes every walk-speed reader agree.
   - **Readers deliberately left on the folded mirror:** `kill_augments.rs:301,455` (the Speed investment score: kill
     trophies and the overhead build marks every viewer sees, `build_marks`; the share is an earned native counter,
     not an investment, and putting it in build marks would show a native card's progress to other players, C-OBS, and
     change observations P-AUG-NATIVE-5 is working on); `traders/mod.rs:230` (a trade costs a share of the folded
     stat; Pathfinder's share is not tradeable); `modifiers::view` `buff_move` (`modifiers/mod.rs:267`, legacy haste's
     input, `status::haste_multiplier`) and `walk_hint.rs:73` (the same haste bound; the hint's `multiplier` already
     folds the registered chain, which includes the share).
3. **No C# change, no wire change.** The C# prediction already walks at `speed_milli / 1000` (floored); it needs no
   code change once the server publishes the right value. No wire shape or `PROTOCOL_VERSION` change (protocol 21 is
   promised to P-COLISEUM-HEALS-2), no `OBSERVATION_VERSION` change (a value, not a field), no new serialized field
   (`CHECKPOINT_FORMAT` stays `rh-checkpoint/36`), no new content row (the ice reuses `REWORK_HAZARD_WALKER_RESIST_PER`
   and `_IMMUNE_MS`), so no content-hash move and no regold.
4. **New golden vector** `protocol/fixtures/pathfinder_walk_v1.json` (`rh-pathfinder-walk/1`): the three corner walks
   of `server_walk_v2.json` (same map `parity/fixtures/pathfinding_seed1.json`, Archetypes, Fire hero walker, seed 11,
   one Move order, 240 steps), replayed in a Rework world with Pathfinder at counter 0.24 (and corner-a at 0.12), each
   row carrying the owner block's `speedMilli` as `observe` delivers it. Written only by its generator, the oracle test
   `cards::native::walk_mirror_tests::pathfinder_walk_v1_is_the_current_server` with `RH_WRITE_FIXTURES=1` (the
   `ranged_pause_golden` convention); the C# test replays it.

## 2. Dependencies
- P-AUG-NATIVE-3 (zone batch) and P-AUG-NATIVE-3b, both in `coord/int-73`.

## 3. Relevant legacy paths
The two cards are new (no legacy implementation). The legacy reads they sit beside:
- `packages/server/src/sim/movement.ts:55` (`slipAccelOf(world, c) === 0` chooses the plain walk), `:70` (the slip walk
  asks `slipAccelAt` per substep); `packages/server/src/sim/terrainEffects.ts:7,67,72` (ice: the slide is the walk's).
- `packages/server/src/sim/walkHint.ts:74,151` (no hint while slipping or on ice, or with ice along the leg).
- Rust ports: `crates/rh-sim/src/systems/movement.rs:52-120`, `systems/walk_hint.rs:36-60,173-197`,
  `terrain.rs:56-67,270-276` (`TERRAIN_SLIP_MS` = 400, `constants.rs:357`).
- Client mirror: `client-unity/RoguehallaNet/Net/LocalMotion.cs:139-140,402-427,505-510`, `LocalMotion.Walk.cs:16,78-85`.

## 4. New paths
- `crates/rh-sim/src/cards/native/walk_mirror_tests.rs` (oracle).
- `client-unity/RoguehallaNet.Tests/PathfinderWalkPredictionTests.cs` (oracle).
- `protocol/fixtures/pathfinder_walk_v1.json`: written by the implementer, only by the generator command in section 9
  (gate flag `--regen-fixtures`). Not an oracle file: its checks are in the two oracle tests.

## 5. Exclusive write scope
- `crates/rh-sim/src/modifiers/mod.rs`: the speed accessor and `movement` calling it.
- `crates/rh-sim/src/owner_combat.rs`: `project_where`'s speed lane only.
- `crates/rh-sim/src/build_summary.rs`: line 68 (`move_speed`) only.
- `crates/rh-sim/src/systems/plague_zombies.rs`: `movement` (`:482`) only.
- `crates/rh-sim/src/systems/movement.rs`: `walk_one`'s two accel reads (`:68-72`, `:102`).
- `crates/rh-sim/src/systems/walk_hint.rs`: `traction_at` and its two callers.
- `crates/rh-sim/src/cards/native/mod.rs` (a thin ice pass-through beside `hazard_guard`; not the
  `mod walk_mirror_tests;` line, which is the stub) and `crates/rh-sim/src/cards/native/zone.rs` (its body).
- `protocol/fixtures/pathfinder_walk_v1.json` (new, by the generator only).
- `docs/agent/AUGMENT_REWORK.md`: the zone batch paragraph (`:293`, "ice slip untouched: P-AUG-NATIVE-3c") updated.

Nothing in `observe.rs`, `rh-protocol`, `rh-server`, `rh-policy`, `client-unity/` (no product C# change),
`kill_augments.rs`, `traders/`, `schedule.rs`, `constants.rs`, `checkpoint.rs`, `stat_fold/`.

## 6. Contracts and references
- R-AUTH, ADR 0008 (prediction mirrored from Rust, checked with Rust vectors, corrected by the server), D9; C-TICK (no
  schedule row), C-RNG (no draw), C-OBS (the owner block is the owner's; build marks unchanged), C-DET, C-PARITY,
  C-INPUT. `docs/agent/AUGMENT_REWORK.md` "Zone batch", `crates/rh-sim/AGENTS.md`.

## 7. Behaviour to preserve
- Legacy world and native-free Rework world: positions, events, state hashes, checkpoints (`hooks_tests::a_rework_
  world_without_native_cards_plays_as_on_the_base`, `zone_tests::a_world_without_zone_cards_is_unchanged_by_the_new_reads`,
  and the new ice-walk comparison in the oracle).
- A non-holder's owner block is the cached wire value bit for bit (`owner_combat/tests.rs:340-347`).
- `server_walk_v2.json`, `pathfinding_v2.json`, `ranged_pause_v2.json` unchanged (no holder in them).
- Zero allocations per step (`tests/no_alloc.rs`, `tests/native_no_alloc.rs`).

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-AUG-NATIVE-3c --base coord/int-73 --regen-fixtures` passes (the
  `check-vectors.mjs` provenance pin is red on the base and waived by the coordinator).
- `cargo test -p rh-parity --test pnet2_goldens --test ranged_pause_golden` green (the existing vectors did not move).
- `dotnet test client-unity/RoguehallaNet.Tests --filter "FullyQualifiedName~PathfinderWalkPrediction|FullyQualifiedName~HitboxPrediction|FullyQualifiedName~PredictionLatency"` green.

## Existing tests that pin what this packet touches (none changes)
| Test | Asserts | Compatible because |
|---|---|---|
| `zone_tests::pathfinder_speeds_the_holders_walk_by_its_counter` | holder walks `1 + counter` x the baseline (0.02) | `movement` keeps its value |
| `zone_tests::hazard_walker_counts_each_hazard_second_into_its_meter_and_whole_stacks` | 40 idle ticks on ice: meter == `terrain.seconds[2]`, 2 stacks, no mark | not immune: a resisted accel is still `> 0`, so exposure and meter still count every tick |
| `zone_tests::a_world_without_zone_cards_is_unchanged_by_the_new_reads` | Legacy == native-free Rework on ember | non-holders take the raw path |
| `zone_tests::readouts_show_pathfinder_and_hazard_walker_to_their_owner_only` | readout rows | unaffected |
| `owner_combat/tests.rs:340-347` | `[as, windup, speed]_milli` equal the legacy capture's mirrors | no holder in the capture: exact wire value |
| `owner_combat/bridge_tests.rs`, `continuation_tests.rs`, `farm_source_tests.rs` | projection of non-holders | share 0 path is the old path |
| `walk_hint/tests.rs:187-190`, `helper_tests.rs:527` | `mirrors().speed_mult` from captures; hint dirs | Legacy worlds |
| `kill_augments/tests.rs:289` | Speed score from the mirror | kill_augments not changed |
| `systems/terrain/native_tests.rs:104-180` | born mobs slip on ice and restore | mobs have no build |
| `rh-parity` `pnet2_goldens`, `ranged_pause_golden` | committed vectors equal the generators | no holder |
| C# `HitboxPredictionTests.CornerWalksWithTheBoxFootMatchTheServerPerTickFixture`, `PredictionLatencyTests.TheOwnerSpeedMultiplierDrivesThePredictedWalk` | prediction within `WalkTol` at speed_milli 1000 / given values | C# unchanged |

## Oracle files (read-only for implementers)
- `docs/backlog/packets/P-AUG-NATIVE-3c.md` (this brief)
- `crates/rh-sim/src/cards/native/walk_mirror_tests.rs`
- `client-unity/RoguehallaNet.Tests/PathfinderWalkPredictionTests.cs`

Stub (`stub:` commit): the `#[cfg(test)] mod walk_mirror_tests;` line in `crates/rh-sim/src/cards/native/mod.rs`.

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --lib cards::native`
- `RH_WRITE_FIXTURES=1 cargo test -p rh-sim --features trusted-status-probes --lib cards::native::walk_mirror_tests::pathfinder_walk_v1_is_the_current_server`
  (writes `protocol/fixtures/pathfinder_walk_v1.json`; without the variable the test checks it byte for byte)
- `cargo test -p rh-sim --test no_alloc --test native_no_alloc --test native_cards --test hash_coverage`
- `cargo test -p rh-parity --test pnet2_goldens --test ranged_pause_golden`
- `dotnet test client-unity/RoguehallaNet.Tests --filter FullyQualifiedName~PathfinderWalkPrediction`

## 10. Risk and suggested model tier
implementer-opus. The ice reads sit in the walk hot path every standing fighter takes each tick (a read that changes a
non-holder's float changes parity); the owner block is what the client predicts with; the vector is shared with C#.

## 11. Known traps
- `x / 1.0` is exact in IEEE, but keep the non-holder on the untouched raw value anyway (branch, not arithmetic), and
  the owner block's non-holder lane on the cached wire value (no decode/encode round trip).
- `walk_hint::traction_at(k, &FighterCore, at)` keeps its signature and raw value: `walk_hint/helper_tests.rs:507`
  calls it with a core and compares to a legacy capture. Apply the holder mapping at its two callers (`:51`, `ice_along`
  `:192`), e.g. through a small wrapper taking the `Player`.
- `walk_one` is called for mobs too (`movement.rs:48`): guard by `w.is_player(ix)`.
- The slip closure at `:102` runs per substep at the substep's position: the immune/resist mapping applies there too,
  not only to the first read at `:71` (otherwise a resisted holder slides at the raw accel after the first substep).
- An immune holder still holding a `motion.slip` from before the mark regrips through the existing `accel == 0` branch;
  the walk hint stays suppressed while `motion.slip` is `Some` (`walk_hint.rs:50`), which clears on that walk.
- `encode_mult` floors at `mod_mult_min`; a share only raises the product.
- Same tick: see 1.1; do not add scratch state to make the filling tick resisted.

## Oracle calibration (author's check, not committed)
The oracle was run against a throwaway implementation of exactly section 1 (then reverted): every Rust test passed, the
lag ratios were 0.800 / 0.600 / 0.400 of a non-holder's 34 u (the tests allow 0.03), the immune lag 0, and the C# replay
of the generated vector drew within 3.3e-4 u of the server (tolerance 0.01; a base-speed replay misses by more than 0.1).
Red on the packet branch, each on an assertion: see the hand-off.

## Proposed DEVIATIONS (for the owner)
None new: the ice resistance and immunity are the NATIVE-3 rows (4% per stack, 20 s) applied to the slip time.

## Legacy doubts / flags
- `w.terrain.seconds[2]` (ice exposure) stops counting for an ice-immune holder, as bog and ember already do for theirs.
- The ice filling tick walks immune (1.1, same tick), unlike ember/bog's filling tick: a schedule-position consequence.

## Notes from previous attempts
<!-- Coordinator appends on escalation: tier, branch, the gate's failure block. Nothing else. -->
