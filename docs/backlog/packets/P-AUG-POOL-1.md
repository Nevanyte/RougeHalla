# P-AUG-POOL-1: the Rework chest pool and its offer rules (live world only)

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-CARDS-2/3), under the owner's 2026-11-18 approval of the elite
  and augment rework (`docs/OWNER_DECISIONS.md` row "Elite and augment rework", 2026-11-18; plan of record
  `docs/backlog/AUGMENT_ELITE_REWORK.md`: packet row P-AUG-POOL-1, "Packet details", decision 5, Appendix A row
  "Eye for an Eye").
- **Implementer tier:** implementer-opus (chest offer draws: reward RNG draw order is behaviour; `check_world` rule)
- **Reviewer:** reviewer-opus
- **Integration base:** coord/int-61 (3c530434f: CONTENT-1 + UI-1 + PLANT-1 on 8f330dd01; content hash 10dfa3b399dc43a1, checkpoint rh-checkpoint/33). Written on ec6d2c2a9, replayed onto int-61. Run the gate with `--base coord/int-61` until int-61 is the integration branch.
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10): one rough test per claim; the Legacy world's offers
  and draw sequence are pinned byte-identical by a seeded golden captured on the integration head · D2 n/a · D5/D6/D9
  none

## 1. ID and outcome
Under `SimConfig::augments = Rework` (the live world, `SimConfig::live_content()`), the augment chest offers a wider
pool and follows two offer rules; the `Legacy` world (parity, headless, most tests) offers exactly what it offers today,
with the same reward-RNG draws.
1. **The pool.** `REWORK_POOL` = `INTERACTIVE` (the 14 legacy interactive augments) plus Committed, Fists of Fury,
   Machine Gun, Here Comes the Boom and A Race to 0 (`CardId::RaceToZero`): 19 ids, all existing card ids (< 80).
   `INTERACTIVE` and the `Legacy` table's pool stay byte-for-byte the same.
2. **Per-card offer rule (decision 5).** Each pool entry is `Offer::Any` or `Offer::Faction(f)`. A `Faction(f)` card is
   offered only when every eligible picker at the chest is faction `f`. **With no eligible picker (a campless elite's
   chest, legacy `chests.ts:222-226`), a `Faction` card is not offered** (approved by the coordinator 2026-11-19; "every picker" is vacuously true
   for every faction at once, which would put faction-only cards in every campless chest). No real faction card exists
   until P-AUG-NATIVE-4; both real tables hold only `Any` entries, and the rule is proved through a test-only table.
3. **Eye for an Eye weighting** (Appendix A: "offered more often to players who own a returned-damage source";
   workbook sheet Augment_Tuning / sheet 6: "Offer more often to owners of Spiked Shell"). Neither gives a number.
   Proposed: **weight 2** (Eye for an Eye counts twice in its tier's index draw) when any eligible picker owns a
   returned-damage source, registered as `REWORK_EYE_FOR_AN_EYE_WEIGHT: f64 = 2., "weight"` in `constants.rs`. A
   returned-damage source is a card whose rows under the world's table (`k.cards.def(id)` / `rows`) hold a
   `TriggerAction::Return` (today: Spiked Shell only, `catalog_data.rs:1186`). The oracle pins the direction only.
4. **Training console** offers and grants the world's pool (`console.rs:69-71` already reads `tuning.pool()`; its
   random chest at `console.rs:413` must use the same offer path as the drop, with the player as the one picker).
5. **Restore.** A `Rework` checkpoint holding a pending camp chest with new pool cards restores and plays on. New
   `check_world` rule: **a camp chest's (`camp: Some`) card options are members of the world's pool**
   (`k.cards.pool()`); `Legacy` refuses a camp chest offering Committed, `Rework` refuses one offering Glass Cannon. A
   chest with `camp: None` is not checked (see "Existing tests" below: many tests declare such chests to grant
   arbitrary cards).

## 2. Dependencies
- P-AUG-RULES-1 (merged: `cards::Tuning`, `k.cards`).
- P-AUG-CONTENT-1 (in review): owns `constants.rs` appends, `cards/rework_overrides.rs` and the `cards/tuning.rs`
  numbers. This packet touches `cards/tuning.rs` (the `pool` field, `REWORK.pool`, new pool methods; no number) and
  appends one constant to `constants.rs`. **The implementer merges after CONTENT-1 lands; the coordinator orders the
  merges.** Both touch the content hash (see trap 5).
- Chest file lane: this packet → P-ELITE-PICK-1 (serial).

## 3. Relevant legacy paths
- `packages/shared/src/rewards.ts:41` `heldByAll` (no picker: nothing is held by all); `:51-53` `rewardAugmentPool`
  (live interactive augments not held by every picker, catalog order); `:32-34` `pickIn` (one draw,
  `floor(rng * len)`); `:66-74` `pickTiered` (one tier draw, one index draw in the nearest non-empty tier, lower first
  on a tie); `:76-93` `rollChestOptions` (first slot from the zone theme when it meets the pool, then up to three
  distinct picks).
- `packages/shared/src/cards.ts:646-652` `INTERACTIVE_AUGMENT_IDS` / `isInteractiveAugment` (the 14).
- `packages/server/src/sim/chests.ts:87-98` `rollChest` (pickers are the eligible contributors' builds);
  `:222-226` campless elite drop: `rollChestOptions` with no pickers.
- `packages/server/src/sim/campHeal.ts:66-77` `eligibleContributors` (standing players near the camp).
- `packages/server/src/sim/training.ts:156` `trainCard` admits `cardLive && isInteractiveAugment`; `:315-316`
  `trainChest`: chosen options filtered the same way, else `rollChestOptions(rewardRandom, { pickers: [c.s.build] })`.
- Returned damage: `packages/server/src/sim/cardHooks.ts:128-146` (Spiked Shell's `hitTaken` return, `passive: true`);
  `mods.ts:636-641` (`passive` / backlash entries are the `returned` kind Eye for an Eye reads).
- Legacy has no faction-only offer rule and no weighting: both are Rework-only (decision 5; Appendix A).

Rust today:
- `crates/rh-sim/src/reward_chests/pools.rs:10-25` `INTERACTIVE`; `:38-48` the legacy-table pool forms; `:96-152`
  `pick_tiered` / `roll_with` (exact legacy draws).
- `crates/rh-sim/src/cards/tuning.rs:47-54` `Tuning::pool` field; `:84`, `:103` both tables point at `INTERACTIVE`;
  `:149-177` `pool` / `augment_pool` / `conditional_pool`; `:190-200` `for_test`.
- `crates/rh-sim/src/reward_chests/mod.rs:113-139` `drop_augment_in` (pickers' builds, `tuning.augment_pool`, then
  `roll_with` on the reward RNG); `:394-452` `validate_world` (checks no card option against any pool today).
- `crates/rh-sim/src/systems/training/console.rs:69-71` `live_interactive`; `:398-418` the console chest.

## 4. New paths
- `crates/rh-sim/src/reward_chests/pool_tests.rs` (oracle).

## 5. Exclusive write scope
- `crates/rh-sim/src/reward_chests/pools.rs` (`REWORK_POOL`, `Offer`, `Picker`, weighting helper if placed here)
- `crates/rh-sim/src/reward_chests/mod.rs` (`drop_augment_in` builds `Picker`s and calls the offer path;
  `validate_world` gains the pool, e.g. a `pool: &[CardId]` parameter or `k`)
- `crates/rh-sim/src/cards/tuning.rs` (the pool field(s), `REWORK.pool`, `offer`, `offer_pool`, `for_test_pool`; no
  number field)
- `crates/rh-sim/src/checkpoint.rs` (only the one `reward_chests::validate_world` call line, to pass the pool)
- `crates/rh-sim/src/systems/training/console.rs` (the random chest's pool call)
- `crates/rh-sim/src/constants.rs` (append `REWORK_EYE_FOR_AN_EYE_WEIGHT` only)
- `crates/rh-sim/tests/content.rs` (the `NON_GAMEPLAY` row for `REWORK_POOL`, already added by the stub, may be
  reworded; `GOLDEN_CONTENT_HASH` only through `scripts/regolden-content.sh`)
- The regolden script's other copies, only through `scripts/regolden-content.sh` (trap 5)
- `docs/agent/AUGMENT_REWORK.md` (a short "The chest pool" section)

## 6. Contracts and references
- C-RNG / determinism: reward RNG draw order is behaviour; outcome-bearing iteration ordered (`CardId::ALL` order).
- C-PARITY: every parity fixture and `tests/reward_pools.rs` stay green; the Legacy golden in the oracle stays green.
- `check_world` rule per new invariant, one refusal test each (`crates/rh-sim/AGENTS.md`).
- `docs/agent/AUGMENT_REWORK.md`: never branch on `config.augments` in game code; read the table (`k.cards`).

## 7. Behaviour to preserve
- `Legacy`: `Tuning::legacy().pool() == INTERACTIVE`; `augment_pool` / `conditional_pool` public forms unchanged; every
  Legacy chest's options and the reward RNG words after it are the integration head's
  (`pool_tests::legacy_offers_and_draws_are_the_integration_heads`).
- No new card id: `CardId::ALL.len() == 80`, `Counts` stays 80 entries, every pool id's index < 80 (wire
  `WireRewardId::Card(<80)`, C# and JS decoders unchanged). No protocol, checkpoint-format or observation bump.
- A Rework chest whose pickers own no returned-damage source draws exactly `roll_with` over the offer pool (one tier
  draw and one index draw per pick; weighting adds no draw).

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-AUG-POOL-1` passes.
- `cargo test -p rh-sim --lib reward_chests::pool_tests` green; `cargo test -p rh-sim --test augment_rules --test
  reward_pools --test content` green.

## Existing tests that pin what this packet changes
- `crates/rh-sim/tests/augment_rules.rs` `the_card_table_is_the_legacy_catalog_under_legacy_and_for_unchanged_cards_under_rework` (was `..._under_both_rules`): asserts
  `t.pool() == INTERACTIVE` and `t.augment_pool(p) == augment_pool(p)` (the legacy form) for **both** rules, including
  `Rework` and `live_content()`. **Conflict**: this packet makes the Rework pool differ by design. Amended in the
  `oracle-amend:` commit (for the owner/coordinator): the two pool assertions apply to `Legacy` only; under `Rework`,
  `t.pool() == REWORK_POOL`. Everything else in the test (defs, numbers) is unchanged.
- `crates/rh-sim/tests/augment_rules.rs` `legacy_and_equal_elite_rework_play_the_same_match` (renamed by CONTENT-1's
  amendment; augments `Legacy` in both worlds). On ec6d2c2a9 this test compared Legacy and Rework augments and failed with
  a throwaway version of this packet: the elite died on seed 11 and its camp chest rolled from the rule's own pool.
  CONTENT-1 now runs both worlds on `Legacy` augments, so the camp chests are equal and this packet no longer amends it.
- `crates/rh-sim/tests/reward_pools.rs:59, 93-98, 137` and `crates/rh-sim/src/reward_chests/tests.rs:235-279`
  (`source_restricted_pool_and_rng_continuation`): the legacy pool, its pickers filter, and the exact draws and RNG
  continuation against the legacy capture. Unchanged; must stay green.
- `crates/rh-sim/tests/content.rs:73` lists `INTERACTIVE` in `NON_GAMEPLAY`; the stub adds the `REWORK_POOL` row.
- Tests that declare a `camp: null` chest with any card and restore it to grant that card (`augment_rules.rs:323-366`
  `grant_by_chests` with Committed / Arcane Overload in a Legacy world; `hash_coverage.rs:1011-1025` with Slow Starter;
  `cards_no_alloc.rs:46`, `hash_coverage.rs:2492`, `rh-headless/tests/cards.rs:34`, `rh-headless/tests/mob_dot.rs:70`).
  They are why the new `check_world` rule covers camp chests only; `pool_tests` pins that a `camp: None` chest is not
  pool-checked.
- `crates/rh-sim/src/systems/training/tests.rs:319-329` `the_console_ignores_unsupported_cards` (Ad1, a base card):
  unchanged under both rules.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/reward_chests/pool_tests.rs`
- `crates/rh-sim/tests/augment_rules.rs` (the `oracle-amend:` commit: the Rework pool assertions in
  `the_card_table_is_the_legacy_catalog_under_legacy_and_for_unchanged_cards_under_rework`; approved by the
  coordinator 2026-11-19)

What each oracle test pins (`pool_tests.rs`):
- `the_rework_pool_is_interactive_plus_five_built_augments_and_legacy_is_unchanged`: `INTERACTIVE` exact; Legacy pool
  = `INTERACTIVE`; `REWORK_POOL` = the 19 as a set; `Tuning::of(Rework | live_content()).pool() == REWORK_POOL`; 80 ids,
  every pool id a live augment below 80; the five reach `offer_pool` under Rework only; real tables are all `Any`;
  Glass Cannon outside.
- `legacy_offers_and_draws_are_the_integration_heads`: 240 Legacy camp-chest drops (zones, elite and normal, 0-3
  pickers, a Spiked Shell holder) fold to a golden captured at the integration head (green at the stub; must stay green; unchanged after replaying onto int-61, so CONTENT-1 and PLANT-1 moved no Legacy draw).
- `a_faction_card_is_offered_only_when_every_eligible_picker_is_that_faction`: test-only table (Glass Cannon as
  Frost-only): `offer`, `offer_pool` over six picker sets (no picker: not offered), and 400 real drops each for a Fire,
  a Frost and a mixed chest (Fire and mixed never; Frost at least 20 times).
- `eye_for_an_eye_is_offered_more_often_to_a_returned_damage_source_owner_under_rework_only`: 6000 drops per arm, Spiked
  Shell holder vs Siphon holder (same tier): Rework ratio in 1.2..=3.0; Legacy ratio in 0.85..=1.15.
- `a_rework_chest_without_a_source_is_the_plain_roll_over_the_offer_pool`: 200 Rework drops with no source equal
  `roll_with` over `offer_pool` with the same draws; all five new cards appear within 300 drops.
- `the_training_console_grants_and_rolls_the_worlds_pool`: the console grants Committed under Rework only, Glass Cannon
  never; 60 rolled Rework console chests offer only Rework pool cards, a new one among them.
- `a_rework_camp_chest_with_new_pool_cards_restores_and_plays_on`: restore, equal hashes and steps, the pick grants.
- `check_world_refuses_a_camp_chest_card_outside_the_rules_pool`: Legacy refuses Committed in a camp chest and accepts
  INTERACTIVE cards; Rework refuses Glass Cannon; a `camp: None` chest is not pool-checked.

A throwaway prototype (not committed) passed all eight and the amended `augment_rules.rs`, so the oracle is
satisfiable; the faction rule, weighting by duplicating Eye for an Eye in the pool when a picker holds a `Return` row,
and the camp-chest `check_world` rule were enough.

## 9. Validation commands
- `cargo test -p rh-sim --lib reward_chests::pool_tests`
- `cargo test -p rh-sim --test augment_rules --test reward_pools --test content`
- `scripts/regolden-content.sh` then `scripts/regolden-content.sh --check` (after registering the weight constant)
- `scripts/gate.sh --quick --oracle packet/P-AUG-POOL-1`

## 10. Risk and suggested model tier
Opus implementer, `reviewer-opus`: the change sits on the reward RNG (any extra, missing or reordered draw in a Legacy
chest breaks parity and the golden), adds a `check_world` rule, and changes a public seam (`Tuning`) that P-ELITE-PICK-1,
P-AUG-NATIVE-1b/4 and P-AUG-BOTS-1 build on.

## 11. Known traps
1. **Draw order.** Legacy must take the exact path it takes today (`roll_with` over `augment_pool`). Weighting must not
   add a draw: e.g. list Eye for an Eye twice in the pool handed to `roll_with` (its distinct-pick filter removes both
   copies once picked) or a weighted index walk that uses the same single index draw. Weighting applies only when a
   source is present, so a no-source Rework chest is the plain roll (pinned).
2. **Pool order.** `augment_pool` walks `CardId::ALL` (catalog order), not the pool array's order; keep it so.
   `INTERACTIVE` held no tier-3 card; the Rework pool has three (Committed, Here Comes the Boom, A Race to 0), so a
   tier-3 draw now lands in tier 3 instead of falling back to tier 2: intended.
3. **Ids.** `Counts` stays 80 entries; every pool id stays below 80 on the wire. No new `CardId`.
4. **`Picker` needs the faction.** `Build` has no faction: `drop_augment_in` reads `p.faction()` beside `p.build` for
   each eligible id, in the eligible list's order.
5. **Content hash.** Registering `REWORK_EYE_FOR_AN_EYE_WEIGHT` moves `content_hash`. The coordinator accepted this as
   move 5 (2026-11-19; TUNE-1 is move 4). Regold only through `scripts/regolden-content.sh` (it rewrites `BakedContent.cs`,
   a build artefact by name: `scripts/gate.sh --allow-artefacts`).
6. **`REWORK_POOL` and `tests/content.rs`.** A new `const`/`static` in `src` must be registered or listed in
   `NON_GAMEPLAY`; the stub lists it. If the implementer inlines the pool or renames it, update that row.
7. **Restore rule scope.** Check camp chests only (`camp: Some`); refusing `camp: None` chests breaks a dozen existing
   tests that declare such chests to grant cards.

## Notes from previous attempts

Known unrelated red: `crates/rh-sim/tests/pack_leader_warm.rs`
`camps_snapshot_warm_original_clone_restore_allocates_nothing` fails in a plain `cargo test -p rh-sim` on coord/int-61
itself, with this packet's stub files reverted to int-61 (clone and restore each allocate 32 bytes once, at tick 116).
Under `--features trusted-status-probes`, which the gate uses, the test is compiled out. Not caused by this packet.
