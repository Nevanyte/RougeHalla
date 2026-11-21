# P-AUG-PLANT-1: Plant Your Feet's range bonus and ranged weapons (legacy port, every world)

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-CARDS runtime), under the owner's elite and augment rework
  approval of 2026-11-18 (`docs/backlog/AUGMENT_ELITE_REWORK.md`, decision 1's exception: this is legacy behaviour
  that was never ported, so it applies in all worlds, not behind `SimConfig::augments`).
- **Implementer tier:** implementer-opus (serialized state, checkpoint format, tick-time decision moves)
- **Reviewer:** reviewer-opus
- **Integration base:** `feature/unity-rework` @ `f5cb80e1d`
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10): the legacy numbers (+25% reach / flight range,
  +25% damage) within a few percent, read from `packages/`; no new capture. D2 n/a. D5/D6/D9: none (no wire, no
  client rule).

## 1. ID and outcome

Plant Your Feet (tier-2 augment, flag `plantFeet`): a player who has stood still for `PLANT_FEET_MS` (1000 ms) arms
their next attack, which then has `1 + PLANT_FEET_BONUS` (1.25x) range and damage. Rust today ports only the melee
damage, decided per target when the swing resolves. When this packet lands, the bonus is decided once, when the attack
STARTS (as legacy does), for EVERY weapon: swords, axes, shields and fists reach 1.25x as far and hit 1.25x as hard
(every body the swing meets, not just the first); bows and wands fly 1.25x as far and hit 1.25x as hard. The factor
rides on the pending action, the melee request, the spawn request and the projectile, is hashed and checkpointed
(`CHECKPOINT_FORMAT` `rh-checkpoint/33`), and the damage share counts against the outgoing row cap as legacy's baked
`packet.mult` does. No DEVIATIONS row: it matches legacy.

## 2. Dependencies

- Base: `feature/unity-rework` @ `f5cb80e1d`.
- P-AUG-RULES-1 is implemented in parallel (`packet/P-AUG-RULES-1`, `agent/opus/P-AUG-RULES-1`). It adds a `tuning`
  argument to `outgoing_damage`, `execute_share`, `maximum_packet` and `valid_ranged_packet`, and a `MatchStatic::cards`
  field; under `Rework` the plant number becomes 35% (`AUGMENT_ELITE_REWORK.md` Appendix A). This oracle calls none of
  those functions and builds no `MatchStatic` by hand, so it compiles on either side of that merge. Whichever lands
  second reconciles: the plant factor is then read through RULES-1's `Tuning` seam (`plant_feet_bonus`), the restore
  bounds below use the larger of the two rules' factors, and this oracle keeps running under `SimConfig::default()`
  (`Legacy`, 25%).
- Shared files with RULES-1 (merge one at a time, `CLAUDE.md` parallelism): `checkpoint.rs`, `state.rs`,
  `systems/melee.rs`, `modifiers/mod.rs`, `cards/mod.rs`.

## 3. Relevant legacy paths

All verified with `rg` at the base; the capture base revision `64052f09` (`parity/card-runtime-witness/source.json`
provenance) has the same code (`git show 64052f09:packages/server/src/sim/weapons.ts`, lines 333-346).

- `packages/shared/src/constants.ts:274-276`: `PLANT_FEET_MS = 1000`, `PLANT_FEET_BONUS = 0.25`.
- `packages/shared/src/cards.ts:395-397`: the card (`plantYourFeet`, tier 2, `{k:"flag", flag:"plantFeet"}`);
  `effectText.ts:84`: "After standing still, your next attack has more range and damage".
- `packages/server/src/sim/weapons.ts:325-355` `startAttack`: at the START of an attack (windup begins),
  `if (plantArmed(world, c))` the packet becomes `raw * 1.25, mult * 1.25`, `rangeMult = 1.25`, and `spendPlant`
  restarts the clock (`:333-340`). The same code runs for every weapon: `swing` (arc weapons), `draw` (bow) and `cast`
  (wand) all carry `rangeMult` (`:341-347`).
- `packages/server/src/sim/weapons.ts:287-323` `land`: the crit roll (once per attack) multiplies the packet again;
  a swing pushes a melee request with `rangeMult` (`:303`); a shot pushes a spawn request with `rangeMult` (`:320`).
- `packages/server/src/sim/melee.ts:63-64`: `inArc(origin, req.a, shape.reach * (req.rangeMult ?? 1), shape.halfArc,
  at, PLAYER_RADIUS)`: the reach is scaled, the body radius is not. Every body in the arc is hit with the same packet
  (so every one gets the 1.25x).
- `packages/server/src/sim/projectiles.ts:110`: `range: shape.range * (req.rangeMult ?? 1)` (bow 520 -> 650, wand
  640 -> 800; "only explicit range augments extend it" for homing balls, `:109`).
- `packages/server/src/sim/projectiles.ts:318-325`: a reflected arrow flies the catalog bow range (or what is left on a
  second reflection), NOT the planted range, and keeps the packet's `mult` (`{...pr.packet, raw: ...}`).
- `packages/server/src/sim/ledger.ts:233, :246`: every entry passes `e.packet.mult` as `baked` to `outgoingMult` /
  `outgoingExecuteShare`; `packages/server/src/sim/mods.ts:656-690`: `baked` shares G1's `OUTGOING_ROW_CAP` (2.5) with
  the fighter's own `hit` mult ("Boom's x2.5 with ... Plant Your Feet's x1.25 already passes the cap on its own": a
  planted Boom hit deals the same as an unplanted one).
- `packages/server/src/sim/cardState.ts:84-94`: `plantArmed` (player, flag, `serverTime - stillSince >= PLANT_FEET_MS`)
  and `spendPlant` (`stillSince = serverTime`).
- `packages/server/src/sim/cardHooks.ts:331, :390-402`: `stillness` runs in the after-damage hook: a player whose
  position moved more than 0.01 since the last check, or who is not alive, was last seen moving now.
- `packages/server/src/sim/world.ts:94-98` (`PendingAction.rangeMult?`), `:464-465` (`MeleeRequest.rangeMult?`),
  `:477-478` (`SpawnRequest.rangeMult?`), `:293-296` (the stillness clock).

## Rust today

- `crates/rh-sim/src/constants.rs:114-115`: `PLANT_FEET_MS`, `PLANT_FEET_BONUS` (registry rows; the content hash
  covers them).
- `crates/rh-sim/src/cards/mod.rs:135-165`: `plant_armed`, `spend_plant`, `stillness` (ported faithfully; `stillness`
  is called from `cards/after_damage.rs:162`, the legacy hook position).
- `crates/rh-sim/src/systems/melee.rs:125-145`: the ONLY reader. Inside the per-target loop of `resolve_swings`, after
  `roll_attack_crit`, `plant_armed` -> `baked *= 1.25` and `spend_plant`. Three differences from legacy follow:
  (a) the decision is taken when the swing lands, not when it starts (an attack started at 0.9 s of stillness that
  lands after 1.0 s gets the bonus in Rust, not in legacy); (b) only the first body a swing meets gets it (the clock is
  spent on the first); (c) a swing that meets nobody does not spend it (legacy spends it at the start). The reach is
  never scaled.
- `crates/rh-sim/src/systems/weapons.rs:160-210` `start_attack` and `:212-254` `land`: no plant at all; bows and wands
  never get the range or the damage.
- `crates/rh-sim/src/systems/projectiles.rs:75-110` `spawn`: `range` straight from the catalog; `:355-375` `entry`:
  `critical_mult: None` (no baked multiplier reaches the ledger for a flight).
- `crates/rh-sim/src/checkpoint.rs:895-924`: pending-action validation (`valid_ranged_packet` for bow/wand packets);
  `:604-652` projectile validation, including `!(0. ..=range).contains(&st.range)` at `:636` (a planted flight's 650
  would be REFUSED today) and `valid_ranged_packet(pr.packet, weapon)` at `:644`.
- `crates/rh-sim/src/checkpoint.rs:273-279` `valid_ranged_packet` and `modifiers/mod.rs:805-843` `maximum_packet`: the
  all-supported-cards envelope, which has no plant factor.

## 4. New paths

- `crates/rh-sim/src/cards/plant_feet_tests.rs` (the oracle; `#[cfg(test)] mod plant_feet_tests;` in `cards/mod.rs`
  is a stub line).

## 5. Exclusive write scope

- `crates/rh-sim/src/systems/weapons.rs` (decide and spend the plant in `start_attack`; carry `range_mult` in `land`)
- `crates/rh-sim/src/systems/melee.rs` (scale the reach; one baked multiplier per swing; remove the per-target plant)
- `crates/rh-sim/src/systems/projectiles.rs` (planted flight range; the baked multiplier on the entry; reflection keeps
  `range_mult` for damage, flies the catalog range)
- `crates/rh-sim/src/state.rs` (`PendingAction::range_mult`, `Projectile::range_mult`: doc comments only; the layout is
  fixed by the stub)
- `crates/rh-sim/src/cards/mod.rs` (`plant_armed` / `spend_plant` callers and docs; nothing else)
- `crates/rh-sim/src/checkpoint.rs` (pending-action and projectile restore rules for `range_mult`; the widened flight
  range bound; the ranged packet bound). It is at its readability cap (`scripts/readability-allowlist.txt:76`, 1972
  lines): put new rules in a helper elsewhere (e.g. `cards/mod.rs` or `systems/projectiles.rs`) and call it in one line,
  or shorten nearby code; the file may not grow.
- `crates/rh-sim/src/systems/mob_checkpoint.rs` (mob pending actions: `range_mult` bound)
- `crates/rh-sim/src/modifiers/mod.rs` (`maximum_packet`, only if the envelope takes the plant factor: see section 11)
- `crates/rh-sim/src/systems/ledger.rs` (only if the baked multiplier needs a new path there)
- Not in scope: `Cargo.lock`, any `Cargo.toml`, `parity/**` (see section 8 for the hash tape), `protocol/**`,
  `packages/**`, `constants.rs`, `catalog*.rs`, `crates/rh-sim/tests/hash_coverage.rs` (it must stay green unedited).

## 6. Contracts and references

- C-DET (the new field is hashed and checkpointed; `hash_coverage` 0 unhashed leaves), C-TICK (no schedule row moves:
  the decision moves from the melee pass into the weapons pass, both existing systems), C-RNG (no draw: plant and
  crit use no RNG), C-OBS (nothing new is observed: the flight range is not on the wire; positions are), C-PARITY
  (every parity fixture byte-identical, see section 7).
- `crates/rh-sim/AGENTS.md`: `hash_coverage`, `no_alloc`, `check_world` refusals.

## 7. Behaviour to preserve

- Without Plant Your Feet (every mob, every player without the card) nothing changes: same events, hits, positions and
  state hashes except for the one new serialized word per pending action and per projectile (always 1.0 there).
- `SimConfig::default()` worlds keep the legacy 25%.
- Crits stay as they are (decided per target in `melee.rs`, never for flights: a pre-existing difference from legacy,
  flagged in section 11 and NOT this packet's to fix). The plant must not change any crit outcome.
- Parity fixtures and captures: none contains the range behaviour, and none moves (survey below). The ability hash
  tape (`parity/abilities/hash-tape.json`) moves with the layout; it is re-recorded on this branch by its recorder
  with the stub layout (every ability case has `range_mult` 1.0 everywhere), and must stay byte-identical after the
  implementation.

### Survey: existing tests and fixtures that pin Plant Your Feet or pending actions

| Test or fixture | What it asserts | After this packet |
|---|---|---|
| `crates/rh-sim/src/cards/mod.rs:847-864` `plant_your_feet_arms_after_a_second_still` | `plant_armed` false at 999 ms, true at 1000 ms, false after `spend_plant` | unchanged, green |
| `crates/rh-sim/src/systems/melee/contact_controls.rs:122-155` `allied_zombie_is_transparent_before_per_target_card_mutation` | a swing pushed straight into the melee queue at an allied zombie records nothing, leaves `card_runtime` alone and leaves the plant ARMED | green: once the plant is decided at attack start, the melee pass never touches it (the request bypasses `start_attack`). The stub adds `range_mult: 1.0` to its `MeleeReq` literal |
| `crates/rh-sim/tests/hash_coverage.rs` (`every_serialized_leaf_of_a_match_changes_the_state_hash`, `in_flight_projectile_leaves_are_hashed_or_validated`, the `world.players.*.core.weapon.action` seed at `:1746`) | every serialized leaf changes the hash or is refused by a documented rule | stays green UNEDITED: with the stub the new leaves exist (1.0) and a one-ulp neighbour must be ACCEPTED by restore (a range bound, not an exact-value check), or `VALIDATED` would need a row. The seed has no `range_mult` key: the serde default (1.0) keeps it valid |
| `crates/rh-sim/tests/checkpoint.rs:103, :154-155, :190, :207, :273, :339, :354` | the format string `rh-checkpoint/32` and the refused older formats | amended (`oracle-amend`) to `rh-checkpoint/33`, with 32 refused |
| `crates/rh-sim/src/abilities/source_tests/hash_tape.rs:41-60` `ability_hash_tape_matches_the_base` with `parity/abilities/hash-tape.json` | the tape's `checkpoint` equals `CHECKPOINT_FORMAT`; each of 63 ability cases' folded state hashes | re-recorded (`oracle-amend`) by `record_ability_hash_tape` on the stub layout; the implementation must keep it |
| `crates/rh-sim/tests/wish_event_time.rs:220`, `frost_restore_actor_scratch.rs:57`, `hash_tape.rs:48` | `checkpoint["format"] == CHECKPOINT_FORMAT` (the constant, not a literal) | green |
| `crates/rh-sim/tests/no_alloc.rs`, `cards_no_alloc.rs` | zero allocations per step | must stay green (the new field is a plain `f64`) |
| `crates/rh-sim/src/card_witness_tests.rs` with `parity/card-runtime-witness/source.json` | landed amounts of the witness cases | no Plant Your Feet case (checked: no `plant` in the file); unchanged |
| `parity/card-runtime/source.json` (53 MB; cases `plant-feet-wait-spend-move`, `interactive-choice-and-runtime-plantYourFeet`) | legacy timelines; its assertions (`tools/card-runtime-fixtures/assertions.mts:11, :24`) check only `stillSince > 50` | no Rust test replays it (only the provenance audit hashes it); it holds no `rangeMult` (0 occurrences). It does not move |
| `parity/policy/bot-public-facts/source.json` | bot facts; mentions "catalog rangeMult=1" as an assumption | unchanged |
| `crates/rh-sim/tests/stat_fold.rs:192, :1049, :1201`, `card_catalog.rs:130`, `reward_pools.rs:52, :182` | the card's flag name, fold key and pool membership | unchanged |
| `crates/rh-sim/src/systems/walk_hint/helper_tests.rs:248, :994`, `systems/frost.rs:538, :920, :1263`, `systems/projectiles.rs:909` (tests), `systems/tests.rs:715`, `systems/fire.rs:400, :408, :458` | build `PendingAction` / `MeleeReq` / `Spawn` literals | compile-only `range_mult: 1.0` lines in the stub commits |
| `crates/rh-sim/tests/step_event_window.rs:229-231` `pinned_fold` (`a_caller_that_clears_its_buffer_sees_the_pinned_hashes`) | the fold of a scripted mob scenario's state hashes | moved by the layout word only: amended (`oracle-amend`) to `0x1f79_d826_12e3_db9d`, measured on the stub; the implementation must keep it |
| `crates/rh-sim/src/systems/mob_spacing_tests.rs:384` `LEGACY_FOLD` (`the_legacy_circle_trajectory_is_the_pre_spacing_one`) | the fold of a training world's state hashes | moved by the layout word only: amended (`oracle-amend`) to `0x36a3_76d1_5e70_1f44` on the stub; must be kept |
| `crates/rh-sim/src/systems/sentenced/npc_tests.rs:463, :501-506` | the checkpoint format literal and the refused older formats | amended (`oracle-amend`) to `rh-checkpoint/33`, with 32 refused |
| `crates/rh-sim/tests/content.rs` `every_const_in_the_source_tree_is_registered_or_explained` | no unregistered `const` under `src/` | green: the oracle uses functions, not consts. An implementer's new `const` must be a registry row or a `NON_GAMEPLAY` row (prefer reading `PLANT_FEET_BONUS`) |

The stub layout was run through the whole `rh-sim` suite (`cargo test -p rh-sim --features trusted-status-probes`):
the only red tests were the oracle, the format pins (`tests/checkpoint.rs` twice, `npc_tests`), two hash folds
(`step_event_window`, `mob_spacing_tests`), the hash tape (all amended), and `content.rs`'s const audit (the oracle's
first draft used consts; fixed). `hash_coverage` stayed green unedited.

No legacy capture already contains the range behaviour: the only `rangeMult` under `parity/` is the bot-facts
assumption string. **No fixture is expected to move** besides the ability hash tape, which is re-recorded on this
branch (layout only: the `checkpoint` string and 15 of 63 folds; no tick count).

## 8. Acceptance checks

- `scripts/gate.sh --quick --oracle packet/P-AUG-PLANT-1` passes.
- Every test in `crates/rh-sim/src/cards/plant_feet_tests.rs` passes.
- `ability_hash_tape_matches_the_base` passes with the tape exactly as recorded on this branch (run with
  `--features trusted-status-probes`), `tests/hash_coverage.rs` passes unedited, `tests/checkpoint.rs` passes as
  amended, `no_alloc` passes.
- The parity report is unchanged.

## Oracle files (read-only for implementers)

- `crates/rh-sim/src/cards/plant_feet_tests.rs` (new, `oracle:`). Red on the stub, each on an assertion:
  - `a_planted_swing_reaches_a_quarter_further`: sword, axe, shield, fists; a body at 0.95 / 1.05 / 1.20 / 1.30 x
    reach (+ the 12 body radius): unplanted hits only 0.95, planted hits up to 1.20 and not 1.30. RED (1.05 missed).
  - `a_planted_swing_hits_every_body_it_meets_a_quarter_harder`: two bodies in the arc, both x1.25 (2%). RED (the
    second body gets x1.0 today).
  - `a_planted_bow_or_wand_shot_flies_a_quarter_further_and_hits_a_quarter_harder`: launch range 650 / 800 (1e-9),
    damage x1.25 (2%), a body at 1.15 x catalog range is hit only when planted. RED (range 520).
  - `the_plant_is_decided_at_the_start_on_the_legacy_second`: started at 950 ms still: unplanted (sword misses at 1.05
    x reach; wand range 640 although its cast lands after the mark); at 1000 ms: planted. RED (sword at 1000 ms).
  - `the_plant_is_spent_when_the_attack_starts_even_on_a_miss`: a planted swing at empty air restarts the clock at its
    start (`card_still_since`), and the next swing, under a second later, deals the unplanted amount (1%). RED.
  - `a_planted_cast_and_its_flight_checkpoint_restore_and_play_on`: a planted pending wand cast (`range_mult` 1.25 in
    the checkpoint), then its ball in flight (`range_mult` 1.25, range 800), each restore and play on with the same
    events and state hash every step; setting `range_mult` back to 1 is refused or changes the hash; the restored ball
    hits the far body. RED (no planted action in the checkpoint).
  - `unplanted_the_card_changes_nothing` (GREEN guard): an unplanted attack by the holder equals the same attack by a
    Siphon holder (sword, bow, wand), same flight range.
  - `under_boom_a_planted_hit_is_capped_like_legacy` (GREEN guard): with Here Comes the Boom, planted = unplanted (2%)
    for sword, bow and wand. Measured to have teeth: a trial that scales a flight's packet without passing its baked
    multiplier to the ledger fails it (bow 1.25).
- `crates/rh-sim/tests/checkpoint.rs` (`oracle-amend`, for the owner): format 33, predecessor 32 refused.
- `crates/rh-sim/src/systems/sentenced/npc_tests.rs` (`oracle-amend`): format 33, 32 refused.
- `crates/rh-sim/src/systems/mob_spacing_tests.rs` (`oracle-amend`): `LEGACY_FOLD` for the new layout word.
- `crates/rh-sim/tests/step_event_window.rs` (`oracle-amend`): `pinned_fold` for the new layout word.
- `parity/abilities/hash-tape.json` (`oracle-amend`, regenerated by its recorder
  `cargo test --locked -p rh-sim --features trusted-status-probes --lib record_ability_hash_tape -- --ignored`).
- `docs/backlog/packets/P-AUG-PLANT-1.md` (this brief).

Stub files (the implementer's): `state.rs` (the two fields and `unit_range_mult`), `systems/melee.rs`
(`MeleeReq::range_mult`), `systems/projectiles.rs` (`Spawn::range_mult`, the `launch` literal), `systems/weapons.rs`
(`range_mult: 1.0` in `start_attack`, `land`), `checkpoint.rs` (`rh-checkpoint/33`), `cards/mod.rs` (the oracle's
`mod` line), `fighter.rs` and `README.md` (the format in prose), and the compile-only test literals listed in the
survey.

## 9. Validation commands

- `cargo test --locked -p rh-sim --features trusted-status-probes --lib plant_feet_tests`
- `cargo test --locked -p rh-sim --features trusted-status-probes --lib ability_hash_tape`
- `cargo test --locked -p rh-sim --test hash_coverage --test checkpoint --test no_alloc`
- `scripts/gate.sh --quick --oracle packet/P-AUG-PLANT-1`

## 10. Risk and suggested model tier

Opus: the decision moves from the melee pass (per target, at land) to the weapons pass (per attack, at start); new
serialized state in two structs; checkpoint validation in a file at its size cap; the G1 cap path for flights; and a
merge with P-AUG-RULES-1 in five shared files.

## 11. Known traps

- **When the plant is decided.** At attack start, in `start_attack` (the `weapons` pass), once per attack, and spent
  there even if the swing later meets nobody, is staggered or the weapon is swapped. A windup that started before the
  1000 ms mark is unplanted even if it lands after it. Tick boundary: `now - card_still_since >= PLANT_FEET_MS`
  (inclusive), and `start` may be up to one tick before `now` (`start_attack`'s buffered start): legacy tests
  `plantArmed` against `world.state.serverTime`, i.e. `now`, not `start`.
- **One multiplier per attack, every body.** A planted swing that meets two bodies hits both 1.25x. Remove the
  per-target `plant_armed` / `spend_plant` from `melee.rs`; the crit roll stays where it is.
- **Reach, not radius.** `in_arc(origin, a, reach * range_mult, half_arc, at, PLAYER_RADIUS)` (legacy `melee.ts:64`);
  under hitbox archetypes the same scaled reach goes to `arc_hits_box`.
- **Baked multiplier and the row cap (G1).** Legacy passes `packet.mult` (crit x plant) as `baked` for every entry.
  Rust passes `critical_mult` (`ledger.rs:504, :774`): a planted melee entry must carry `crit x range_mult`, a planted
  flight `range_mult` (today `None`). With Here Comes the Boom (`hit` x2.5) a planted hit deals what an unplanted one
  does (the oracle checks this for the bow).
- **Reflection.** A reflected planted arrow flies the catalog bow range (first reflection) but keeps `range_mult` for
  its damage cap (legacy `projectiles.ts:318-325`); its `launch.range` is then not `catalog x range_mult`.
- **Restore rules.** `range_mult` is finite and within `[1, 1 + PLANT_FEET_BONUS]` (after RULES-1: the larger rule's
  bonus) for players; for mobs exactly the bound too, or tighter only if `hash_coverage` stays green unedited (a
  one-ulp neighbour of 1.0 must restore, so use a range bound). The flight bound at `checkpoint.rs:636` becomes
  `range x range_mult`. A non-1 `range_mult` on a player without the card may be refused or accepted; say which.
- **The ranged packet envelope.** `valid_ranged_packet` bounds a pending bow/wand packet and a flight's packet by
  `maximum_packet`, which has no plant factor: a planted packet from a build at the envelope would be refused at
  restore. Scale the bound by the action's / flight's `range_mult` (or fold the factor into the envelope). The
  RULES-1 merge then passes its `tuning` through.
- **Crit is a pre-existing difference** (`LEGACY DOUBTS`): legacy rolls one crit per attack at land, for every
  weapon (`weapons.ts:291-293`); Rust rolls per target in `melee.rs:132` and never for flights. Not this packet.
- **Hash tape.** The 63 ability cases hold no Plant Your Feet, so every `range_mult` there stays 1.0 and the tape
  recorded on this branch must not move. If it does, the implementation set a non-1 factor without the card.
- **checkpoint.rs is at 1972 lines** (its allowlist cap): it may not grow.
- **no_alloc.** No `Vec` or `String` in the new paths.
- **The layout is fixed by the stub.** `range_mult: f64` on `PendingAction` and `Projectile`, appended last, serde
  default 1.0. Changing a type, the order or adding another serialized field moves the re-recorded hash tape and the
  two amended folds, which the gate then refuses. Remove the stub's `#[allow(dead_code)]` on `Spawn::range_mult`.
- **Borrows.** `FighterCore` has no build: decide the plant in `step_weapon` from `cx.w.players[ix.slot()]` (players
  only; `npc` is already computed there) before `core_mut`, scale `packet.raw` there (legacy scales the packet before
  the action exists), then hand `range_mult` to `start_attack`. In `melee.rs` the crit still multiplies `raw`; only
  the baked multiplier (`critical_mult`) takes `crit x range_mult`.

### Trial implementation (discarded, not committed)

About 40 lines over `weapons.rs` (the decision above), `melee.rs` (`reach * req.range_mult`; `raw *= crit`;
`critical_mult = crit x range_mult` when above 1; the per-target plant removed), `projectiles.rs` (`Spawn` and
`launch` carry `range_mult`; `range * range_mult`; reflection keeps it; `entry` sets `critical_mult`) and
`checkpoint.rs` (flight bound `range * pr.range_mult`, `range_mult` in `[1, 1.25]`). With it all 8 oracle tests
passed, and the whole `rh-sim` suite with `trusted-status-probes` was green (the re-recorded hash tape, both amended
folds, `hash_coverage` unedited, `contact_controls`, `no_alloc`). The trial did not touch the pending-action restore
rule or the ranged envelope (no oracle test reaches the envelope; the reviewer checks those two by reading).

## Notes from previous attempts
<!-- Coordinator appends on escalation: tier, branch, the gate's failure block. Nothing else. -->
