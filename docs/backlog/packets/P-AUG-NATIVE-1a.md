# P-AUG-NATIVE-1a: native augment ids, per-player native state and its caps (live world only)

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-CARDS-2/3), under the owner's 2026-11-18 approval of the elite
  and augment rework (`docs/OWNER_DECISIONS.md` row "Elite and augment rework", 2026-11-18: augments "Plus 13 new",
  "Add 'marked man'"; plan of record `docs/backlog/AUGMENT_ELITE_REWORK.md`: "Architecture: P-AUG-NATIVE-1a and 1b",
  packet row P-AUG-NATIVE-1a, decisions 3, 9 and 10, the P-AUG-NATIVE-3 Wish Engine note, Appendix A).
- **Implementer tier:** implementer-opus (state, save/restore, state hash, checkpoint format, content hash)
- **Reviewer:** reviewer-opus
- **Integration base:** `feature/unity-rework` @ 7673f8a02 (integrations 59-63; content hash `c890f52fd7ab4546`,
  checkpoint `rh-checkpoint/33`).
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10): the native numbers are the workbook's, checked
  once each; the Legacy world is pinned byte-identical by digests recorded on the base · D2 n/a · D5/D6/D9 none (no
  wire, no observation change: P-WIRE19-A carries native ids).

## 1. ID and outcome

The 14 new augments (the 13 the whitelist allows plus Marked Man) get card ids, a hand-written definition table, and
generic capped per-player state, with no behaviour yet (hooks, readouts and the exemplars are P-AUG-NATIVE-1b; each
card's mechanic is its batch packet). When this lands:

1. **Ids.** `CardId` gains 14 variants after `FinalVerdict`, in this order (index = discriminant):

   | index | variant | `as_str` / serde | title | batch |
   |---|---|---|---|---|
   | 80 | `MarksmansTally` | `marksmansTally` | Marksman's Tally | 1b |
   | 81 | `Bastion` | `bastion` | Bastion | 1b |
   | 82 | `Calluses` | `calluses` | Calluses | NATIVE-2 |
   | 83 | `ExecutionersLedger` | `executionersLedger` | Executioner's Ledger | NATIVE-2 |
   | 84 | `EighthStrike` | `eighthStrike` | Eighth Strike (decision 3) | NATIVE-2 |
   | 85 | `Pathfinder` | `pathfinder` | Pathfinder | NATIVE-3 |
   | 86 | `HazardWalker` | `hazardWalker` | Hazard Walker | NATIVE-3 |
   | 87 | `WishEngine` | `wishEngine` | Wish Engine | NATIVE-3 |
   | 88 | `Overflow` | `overflow` | Overflow | NATIVE-3 |
   | 89 | `CorpseHoarder` | `corpseHoarder` | Corpse Hoarder | NATIVE-4 |
   | 90 | `Stoked` | `stoked` | Stoked | NATIVE-4 |
   | 91 | `Glacier` | `glacier` | Glacier | NATIVE-4 |
   | 92 | `TrophyHunter` | `trophyHunter` | Trophy Hunter | NATIVE-4 |
   | 93 | `MarkedMan` | `markedMan` | Marked Man | NATIVE-5 |

   `CardId::ALL` stays the 80 catalog cards (`[Self; 80]`, unchanged: the Unity mirror test and the training-console
   generator read it by regex). A new `pub const NATIVE: [Self; 14]` lists the 14 in index order. `CardId::definition()`
   and `tier()` answer native ids from the native table (below), never by indexing `catalog_data::DEFINITIONS`.
2. **Definitions.** A hand-written table (new file `cards/native/table.rs`): one `CardDef` per native id, `kind:
   Augment`, `tier: 1`, `base: None`, `requires: None`, `unique: true`, `ready: true`, the title above, a one-line text
   from Augment_Tuning's "Suggested change", tags as the batch packet needs (may be `&[]`), `rows: &[]`,
   `selections: &[]`. Tier 1 is legacy's default augment tier (`packages/shared/src/cards.ts:248`, `tier: r.tier ?? 1`)
   and legacy's tier for an id it does not know (`cards.ts:585-587`); a batch packet may move one.
3. **State** (decision: inside `Build`, one new field `native: NativeCards`). Per native card a `NativeSlot { count: u8,
   counter: f64, meters: [f64; NATIVE_METERS], marks: u32 }` with `NATIVE_METERS = 3`; `NativeCards` holds
   `[NativeSlot; 14]` in native order (fixed size: no allocation). `counter` is the card's stacks in the card's own
   units (armor, AD, a damage share, hits), `meters` its working meters (stored damage, per-hazard seconds, a shield, a
   per-cast record), `marks` a bit set (Pathfinder's mob types, Hazard Walker's immune hazards). A slot whose `count`
   is 0 is all zero (the code keeps it so; it is not written, see 5).
4. **Caps.** Per native card a `NativeRule { counter_cap: f64, meter_caps: [f64; NATIVE_METERS], marks: u32 }`
   (`pub fn cards::native::rule(id) -> Option<&'static NativeRule>`, `None` for the 80). Every cap is a registered
   constant by name (section 4) or 0. **1a sets a cap only where the workbook gives one; every other slot's cap is 0
   (unused: its value must be 0) and the batch packet that uses it sets the cap and registers its number:**

   | card | `counter_cap` | `meter_caps` | `marks` |
   |---|---|---|---|
   | Marksman's Tally | `REWORK_MARKSMANS_TALLY_CAP` (0.30) | 0, 0, 0 | 0 |
   | Bastion | 0 | 0, 0, 0 (meter cap: 1b; the workbook says only "Meter cap") | 0 |
   | Calluses | `REWORK_CALLUSES_CAP` (30) | 0, 0, 0 | 0 |
   | Executioner's Ledger | `REWORK_EXECUTIONERS_LEDGER_CAP` (30) | 0, 0, 0 | 0 |
   | Eighth Strike | `REWORK_EIGHTH_STRIKE_EVERY - 1` (7: hits since the last doubled hit) | 0, 0, 0 | 0 |
   | Pathfinder | `REWORK_PATHFINDER_CAP` (0.24) | 0, 0, 0 | bit `1 << i`, i the position in `MobTypeId::ALL` of each normal (non-elite) mob type (`mob_catalog::normal_types_of`, 20 bits) |
   | Hazard Walker | `REWORK_HAZARD_WALKER_CAP` (15) | `REWORK_HAZARD_WALKER_IMMUNE_MS` ×3 (ember, bog, ice) | `0b111` |
   | Wish Engine | `REWORK_WISH_ENGINE_CAP` (0.25) | 0, 0, 0 (NATIVE-3, see 6) | 0 |
   | Overflow | 0 | 0, 0, 0 (shield cap: NATIVE-3; the workbook says only "Shield cap") | 0 |
   | Corpse Hoarder | `REWORK_CORPSE_HOARDER_CAP` (0.24) | 0, 0, 0 | 0 |
   | Stoked | `REWORK_STOKED_CAP` (30) | 0, 0, 0 | 0 |
   | Glacier | `REWORK_GLACIER_CAP` (30) | 0, 0, 0 | 0 |
   | Trophy Hunter | `REWORK_TROPHY_HUNTER_CAP` (0.15) | 0, 0, 0 | 0 |
   | Marked Man | 0 (NATIVE-5 sets the carry's bound, decision 9) | 0, 0, 0 | 0 |

5. **Save, restore and the state hash** (decision). `Build` serializes `native` FIRST and ONLY when some native card
   is held: `{"native":[rows],"counts":[80],"boosts":[8]}`; with none held it writes exactly today's
   `{"counts":[80],"boosts":[8]}`. Rows are the held cards only, in native order: `{"card":"<as_str>","count":n,
   "counter":f,"meters":[f,f,f],"marks":u}`. Deserialize: `native` absent = none held; refuse an empty list (second
   spelling of "none"), a row with `count` 0, a non-native `card`, a repeated or out-of-order card. Write it with a
   hand-written `Serialize` for `Build` (no `skip_serializing_if`: `Sim::check_layout` refuses a skipped field).
   Why this is sound for the state hash (`hash.rs` layout rules, the `MobRuntime::buffs` / `barriers` precedents at
   `hash.rs:36-49`): the hasher writes a sequence's length first and no struct field count, so a held-native `Build`
   starts with the row count n (1..=14) and a native-free one with `Counts`' length word 80. The two cannot run into
   each other, and a native-free `Build` hashes exactly as today. Add the paragraph to the `hash.rs` module doc as the
   fourth World exception.
   - Legacy worlds (and Rework worlds holding no native card) keep their state hashes and their checkpoint JSON byte
     for byte, except the format tag.
   - **Checkpoint format bump: yes** (`CHECKPOINT_FORMAT`, `checkpoint.rs:23`, the next number). A checkpoint holding a
     native row (or a native id anywhere a `CardId` serializes) is a layout the previous build refuses or misreads, and
     the plan names this bump (Risks, "Three checkpoint-format bumps"). The oracle reads the constant; it only asserts
     it is not `rh-checkpoint/33` and that a `/33` checkpoint is refused. P-ELITE-PICK-1 also bumps: the second to merge
     takes the next number, and the oracle needs no change.
6. **`check_world` rules** (new `cards::native::check(k, w)`, called from `checkpoint::check_world`; one refusal
   test each):
   - a native count is non-zero only when `k.config.augments == AugmentRule::Rework` (read through `k.cards.rule()`);
   - each native `count` ≤ 1 (every native card is unique);
   - each held slot: `counter`, every `meters[j]` finite and in `0..=cap`; `marks & !rule.marks == 0`;
   - no reward chest option (any chest, camp or not) is a native card: native ids are not on the wire until P-WIRE19-A
     (`WireRewardId::Card(id.index() as u8)`, `rh-policy` `delivery/collections.rs:379`; protocol refuses `Card(80)`,
     `rh-protocol/tests/v11_union.rs:127`). P-WIRE19-A lifts this rule.
   - **`card_tank_hp` cap (missing today):** every player's `card_tank_hp` is finite and in `0..=C`, where C is the
     largest `TriggerAction::Fortify` `cap` among the world table's card rows (`k.cards.def(id)` over `CardId::ALL`,
     every faction selection): 250 under Legacy (`TANK_ENGINE_CAP`, legacy `cardHooks.ts:190-197`,
     `shared/cards.ts:312`), 350 under Rework (`REWORK_TANK_ENGINE_CAP`). Not tied to holding Tank Engine: the
     `hash_coverage` perturbation of `card_tank_hp` (0 → 5e-324 on a player without the card) must keep restoring.
7. **Content.** The workbook numbers are registered `content!` rows in `constants.rs` (section 4, appended after
   `REWORK_WISHFUL_BUDGET_SHARE`), and the native ids, names and table fold into `visit_progression_content`
   (`content/fold.rs:156-163` folds `CardId::ALL` as index, name length, name bytes; fold `CardId::NATIVE` the same way
   after it, then each `NativeRule`'s words). The content hash moves once (plan decision 10, move 2) through
   `scripts/regolden-content.sh`.
8. **Nothing observable changes.** `Build::counts()` stays `[u8; 80]`, `BuildView` and the owner build summary carry no
   native id, no pool lists a native card (`Tuning::pool()`, `augment_pool`, `conditional_pool` and `offer_pool` stay
   over `CardId::ALL`), and no chest may offer one (rule above). A player holding a native card is observed exactly as
   one who does not. `Build::cards()` yields held native cards after the 80, and `Build::power()` counts their tier
   (legacy `cardPower` sums every held card's tier, `shared/cards.ts:593-603`); native rows are empty, so no fold,
   hook or mirror changes.

**Wish Engine (P-AUG-NATIVE-3) and its restore envelope.** Today's Wish restore check (`abilities/checkpoint.rs`:
`wish_cooldowns`, `prior_min`, the Rework Wishful budget bound) assumes a Wish cooldown only lengthens between casts;
Wish Engine shortens it. The per-cast budget record that envelope needs lives in this packet's state: Wish Engine's
slot keeps its earned share in `counter` (cap `REWORK_WISH_ENGINE_CAP`) and has three meters reserved for NATIVE-3
(for example `meters[0]` = the share in force at the last cast). NATIVE-3 sets those meter caps (no new field, no
format bump for the record itself); redoing the envelope is NATIVE-3's, at Opus. This packet builds none of it.

## 2. Dependencies
- P-AUG-CONTENT-1, P-AUG-TUNE-1, P-AUG-POOL-1, P-ELITE-SHARE-1 (merged at 7673f8a02).
- Content lane: this packet is move 2 of the content hash; P-ELITE-TUNE-1 (move 3) appends to `constants.rs` after it.
- Shares with P-AUG-POOL-1-fix: `content/fold.rs` and the regolden copies (the six content-hash copies). Shares with
  P-ELITE-TUNE-1: `constants.rs` appends and the regolden copies. Shares the checkpoint format with P-ELITE-PICK-1. The
  coordinator merges these one at a time; the second regolds again.

## 3. Relevant legacy paths
The 14 cards are new (no legacy implementation). Legacy rules this packet keeps:
- `packages/shared/src/cards.ts:248`: an augment row's tier defaults to 1; `:585-587` `cardTierOf`: an unknown id is
  tier 1; `:593-603` `cardPower`: the sum over held cards of tier × count; `:641` a unique card is held once;
  `:646-652` `INTERACTIVE_AUGMENT_IDS` (the 14 legacy interactive augments; no native card is offered).
- `packages/server/src/sim/cardHooks.ts:190-197` Tank Engine: `earned = min(cap, prevented × per)`, `tankHp` only
  rises (so `0 ≤ tankHp ≤ cap`); `packages/shared/src/cards.ts:312` the row; `packages/shared/src/constants.ts:292`
  `TANK_ENGINE_CAP = 250`. Rust: `crates/rh-sim/src/cards/mod.rs:490-499`.
- `packages/server/src/sim/cardState.ts:25` the per-player card runtime (`prevented`, `tankHp`, ...): legacy keeps card
  counters per player, beside the build.

Workbook (`docs/quests/FUTURE_ONLY_Quest_Design_Discussion.xlsx`): sheet Augment_Tuning rows "Marked Man",
"Pathfinder", "Marksman's Tally", "Tenth Strike", "Calluses", "Bastion", "Hazard Walker", "Glacier", "Stoked",
"Corpse Hoarder", "Overflow", "Wish Engine (percent)", "Executioner's Ledger", "Trophy Hunter" (column "Suggested
change"); sheet Augments rows 39-55 ("What it does") and rows 67-75 (Wish Engine per-faction table: cap, 5 minutes to
cap, floor 0.5).

## 4. New paths
- `crates/rh-sim/src/cards/native/mod.rs` (stub here; the implementer fills it): `NATIVE_METERS`, `NativeSlot`,
  `NativeCards` and its serde, `NativeRule`, `rule(id)`, `definition(id)`, `check(k, w)`.
- `crates/rh-sim/src/cards/native/table.rs`: the 14 hand-written `CardDef`s and `NativeRule`s.
- Registered constants (append to the `content!` registry, `constants.rs`, after `REWORK_WISHFUL_BUDGET_SHARE`; values
  from Augment_Tuning "Suggested change" unless noted):

  | name | value | unit | source |
  |---|---|---|---|
  | `REWORK_MARKSMANS_TALLY_PER` | 0.003 | share | 0.3% per long-range hit |
  | `REWORK_MARKSMANS_TALLY_CAP` | 0.30 | share | cap 30% |
  | `REWORK_MARKSMANS_TALLY_RANGE_SHARE` | 0.8 | share | sheet Augments, Marksman's Tally "What it does": "beyond 80% of max range" (unchanged by Augment_Tuning) |
  | `REWORK_BASTION_SHARE` | 0.35 | share | 35% of stored blocks |
  | `REWORK_CALLUSES_PER` | 0.07 | armor | 0.07 armor per fist hit |
  | `REWORK_CALLUSES_CAP` | 30. | armor | cap 30 |
  | `REWORK_EXECUTIONERS_LEDGER_PER` | 3. | ad | +3 AD per player or elite kill |
  | `REWORK_EXECUTIONERS_LEDGER_CAP` | 30. | ad | cap 30 |
  | `REWORK_EIGHTH_STRIKE_EVERY` (u32) | 8 | hits | every 8th hit (decision 3) |
  | `REWORK_EIGHTH_STRIKE_MULT` | 2. | x | "doubles" |
  | `REWORK_PATHFINDER_PER` | 0.012 | share | +1.2% move speed per type |
  | `REWORK_PATHFINDER_CAP` | 0.24 | share | cap 24% |
  | `REWORK_HAZARD_WALKER_CAP` | 15. | stacks | cap 15 |
  | `REWORK_HAZARD_WALKER_IMMUNE_MS` | 20000. | ms | immunity after 20 s on each hazard |
  | `REWORK_WISH_ENGINE_CAP` | 0.25 | share | cap −25% |
  | `REWORK_WISH_ENGINE_CAP_MS` | 300000. | ms | sheet Augments, Wish Engine table ("Minutes to cap 5"): every faction caps after 5 minutes of use |
  | `REWORK_OVERFLOW_FADE_MS` | 8000. | ms | fades over 8 s |
  | `REWORK_CORPSE_HOARDER_PER` | 0.03 | share | +3% max HP per corpse |
  | `REWORK_CORPSE_HOARDER_CAP` | 0.24 | share | cap 24% |
  | `REWORK_STOKED_PER` | 2. | ap | +2 AP per landed burst |
  | `REWORK_STOKED_CAP` | 30. | ap | cap 30 |
  | `REWORK_GLACIER_PER` | 0.15 | armor | 0.15 armor per chill second |
  | `REWORK_GLACIER_CAP` | 30. | armor | cap 30 |
  | `REWORK_TROPHY_HUNTER_PER` | 0.02 | share | 2% damage per hunt stack |
  | `REWORK_TROPHY_HUNTER_CAP` | 0.15 | share | cap 15% |
  | `REWORK_MARKED_MAN_STACK_MULT` | 1.5 | x | +50% stacks from kills (decision 9) |

  Not registered here (no number in the workbook): Hazard Walker's growth and what a stack pays, Bastion's meter cap,
  Overflow's shield cap, Marked Man's carry bound, Wish Engine's per-cast record. Their batch packets register them
  (one more content move each, through the script).

## 5. Exclusive write scope
- `crates/rh-sim/src/cards/catalog.rs` (the stub adds the variants, `NATIVE`, the `as_str` arms and the
  `definition()` branch; the implementer finishes `definition()`/`tier()`). Hand-edited: `emit_cards.py` writes only
  `catalog_data.rs` (`tools/card-catalog-fixtures/emit_cards.py:11-12, 168-169`), and it is pinned by the card
  provenance audit (`parity/card-catalog/source.json` `protectedSha256`, checked by
  `tools/provenance/check-card-chain.mjs` in every gate), so it is NOT edited. See "Plan deviations".
- `crates/rh-sim/src/cards/native/mod.rs` (stub), `crates/rh-sim/src/cards/native/table.rs` (new).
- `crates/rh-sim/src/cards/mod.rs`: `pub mod native;` (stub), `Build` (field, serde, `owns`/`count`/`set`/`add`/`valid`/
  `cards`/`power`/`from_counts` branch on native ids), re-exports.
- `crates/rh-sim/src/checkpoint.rs`: `CHECKPOINT_FORMAT`, the call to `cards::native::check` in `check_world`.
- `crates/rh-sim/src/hash.rs`: the module doc paragraph only.
- `crates/rh-sim/src/constants.rs`: the appended rows only.
- `crates/rh-sim/src/content/fold.rs`: the native fold after `CardId::ALL` (shared with P-AUG-POOL-1-fix).
- `crates/rh-sim/tests/content.rs`: `NON_GAMEPLAY` / `TABLES_FOLDED_BY_HASH` entries for the native table statics, and
  `GOLDEN_CONTENT_HASH` through the script only.
- The other content-hash copies, through `scripts/regolden-content.sh` only: `tools/unity-browser-reload-proof/check.mjs`,
  `tools/unity-browser-reload-proof/normal-companion.mjs`, `client-unity/UnityProject/Assets/Scripts/BakedContent.cs`
  (build artefact by name: `--allow-artefacts`), `parity/abilities/hash-tape.json` and
  `protocol/fixtures/archetypes_v1.json` (their documented commands, run by the script: `--regen-fixtures`).
- `docs/agent/AUGMENT_REWORK.md`: a short "Native cards" section (ids, state, caps, how a batch packet sets a cap).

Nothing in `rh-protocol`, `rh-server`, `rh-policy`, `observe.rs`, `reward_chests/`, `abilities/` or `client-unity/`.

## 6. Contracts and references
- C-DET (checkpoint restores hash-exact), C-PARITY (Legacy world unchanged), C-OBS (no native id observed), C-RNG
  (no draw added), C-TICK (no schedule row). ADR 0007 (determinism). `hash.rs` module doc layout rules.
- `docs/agent/AUGMENT_REWORK.md` (the rework seams), `crates/rh-sim/AGENTS.md`.

## 7. Behaviour to preserve
- Legacy world: state hashes, checkpoint JSON (except the format tag) and replays, byte for byte. Pinned by
  `legacy_worlds_keep_their_state_hash_and_checkpoint_bytes` and by `parity/abilities/hash-tape.json`: after the
  regolden, its diff shows only the `checkpoint` and `contentHash` lines, never a case fold.
- No reward draw, pool, chest option, observation, event or wire byte changes in any world.
- `CardId::ALL`, `Counts` (80 entries), `catalog_data.rs`, `emit_cards.py`, `BuildView` unchanged.
- Zero allocations per step (`tests/no_alloc.rs`, `tests/cards_no_alloc.rs`): `NativeCards` is fixed-size.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-AUG-NATIVE-1a --allow-artefacts --regen-fixtures` passes; the full gate
  is the coordinator's on the merge.
- `scripts/regolden-content.sh --check` exits 0.
- `git diff packet/P-AUG-NATIVE-1a..HEAD -- parity/abilities/hash-tape.json` changes only `"checkpoint"` and
  `"contentHash"`.
- `node tools/provenance/check-card-chain.mjs` reports `"failureCount": 0` (in every gate).

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/native_cards.rs`
- `docs/backlog/packets/P-AUG-NATIVE-1a.md` (this brief)

Stub (`stub:` commit, the implementer's to finish): `crates/rh-sim/src/cards/catalog.rs` (the 14 variants, `NATIVE`,
`as_str` arms, `definition()`/`tier()` branch), `crates/rh-sim/src/cards/native/mod.rs` (`NATIVE_METERS`, `NativeRule`,
`rule()` returning `None`, `definition()` returning a placeholder), `crates/rh-sim/src/cards/mod.rs` (`pub mod native;`),
`crates/rh-sim/tests/content.rs` (`NON_GAMEPLAY` rows for `NATIVE` and `NATIVE_METERS`; the implementer may move
`NATIVE` to `TABLES_FOLDED_BY_HASH` once it folds it).

The oracle's 12 tests and why each fails at the stub:

| Test | Pins | Fails at the stub on |
|---|---|---|
| `native_ids_are_80_to_93_outside_all_each_with_its_own_definition` | ids, names, serde, definitions (kind, tier 1, unique, title, no rows) | `def.id == id` (placeholder definition) |
| `a_build_holds_a_native_card_beside_the_catalog_and_counts_its_tier` | `Build` owns/count/cards/power with a native card; `counts()` stays the 80 | index out of bounds in `Build::from_counts` (`counts.0[82]`): a panic, not an assertion, because the branch is the implementation |
| `the_native_numbers_are_the_workbooks_registered_rows_and_the_caps_read_them` | the 26 registry rows = workbook numbers; each `NativeRule` | registry row missing |
| `native_ids_and_names_reach_the_content_hash` | native ids folded into `visit_progression_content` | words not found |
| `a_rework_checkpoint_with_native_cards_restores_hash_exact_and_plays_on` | restore, canonical JSON (native first), `check_layout`, hash sees every native leaf, 40 ticks equal | `rule()` is `None` |
| `legacy_refuses_a_native_card_that_rework_admits` | the Rework-only rule (positive control first) | Rework restore refused (`native` is an unknown field) |
| `a_player_holding_a_native_card_is_observed_as_one_who_does_not` | observations and events equal with and without native cards, 20 ticks | `rule()` is `None` |
| `check_world_refuses_native_state_outside_its_caps_and_shapes` | 4 admitted, 14 refused forgeries | `rule()` is `None` |
| `check_world_caps_card_tank_hp_at_the_worlds_tank_engine_cap` | `0..=250` Legacy, `0..=350` Rework, 5e-324 admitted | `next_up(250)` admitted |
| `no_pool_or_chest_holds_a_native_card` | pools hold no native id; a chest offering one is refused | a chest offering Marksman's Tally restores |
| `the_checkpoint_format_moved_past_33_and_a_33_checkpoint_is_refused` | the bump, read from the constant | format still `/33` |
| `legacy_worlds_keep_their_state_hash_and_checkpoint_bytes` | a Legacy match with cards: 3 state hashes, FNV of checkpoint `world` and `statics` JSON | passes (a guard: recorded at the stub, which serializes as the base) |

## Existing tests that pin what this packet touches
| Test | Asserts | Effect |
|---|---|---|
| `crates/rh-sim/tests/card_catalog.rs` | the 80 `CardId::ALL` definitions equal the captured legacy corpus | unchanged (`ALL`, `catalog_data.rs` untouched) |
| `crates/rh-sim/tests/hash_coverage.rs` `VALIDATED` (`:1657-1660`) | `build.counts` has exactly 80 entries; counts are refused when unique cards repeat | unchanged; its scenarios hold no native card, so `native` is absent and no new leaf appears. The `card_tank_hp` rule admits its perturbation (0 → 5e-324) by design (section 1.6) |
| `crates/rh-sim/src/abilities/source_tests/hash_tape.rs:48` `ability_hash_tape_matches_the_base` | the tape's `checkpoint` equals `CHECKPOINT_FORMAT`, its `contentHash` the content hash, and 63 case folds | re-recorded by `regolden-content.sh` (documented command); only the two header lines may change |
| `crates/rh-sim/tests/content.rs` (`GOLDEN_CONTENT_HASH`, `is_stray`) | the golden content hash; every static is registered, folded or `NON_GAMEPLAY` | regolden; new statics get entries (implementer) |
| `crates/rh-sim/tests/augment_rules.rs` | Legacy and an empty Rework play the same match; a Rework checkpoint with fold cards restores | unchanged (no native card granted there) |
| `crates/rh-sim/tests/checkpoint.rs`, `checkpoint.rs:1135-1140`, `tests/wish_event_time.rs:220`, `tests/frost_restore_actor_scratch.rs:57` | checkpoints carry `CHECKPOINT_FORMAT` | read the constant: unchanged |
| `crates/rh-protocol/tests/v11_union.rs:127` | the encoder refuses `WireRewardId::Card(80)` | unchanged; why the chest rule exists |
| `client-unity/.../BuildDrawerEditModeTests.cs:38-71` | `pub const ALL: [Self; 80]` in `catalog.rs` mirrors `CardDisplayCatalog` | unchanged (regex reads `ALL` only; `NATIVE` is a separate const) |
| `tools/training-console/training-console-source-pins.json:10` | sha256 of `catalog.rs` | goes stale; read only by the generator when regenerated (P-AUG-UI-2 refreshes it, as the plan already says for `CardDisplayCatalog.cs`) |

No conflict needs the coordinator: no existing expectation changes.

## 9. Validation commands
- `cargo test -p rh-sim --test native_cards`
- `cargo test -p rh-sim --test hash_coverage --test content --test augment_rules --test card_catalog`
- `cargo test -p rh-sim --lib ability_hash_tape_matches_the_base`
- `scripts/regolden-content.sh` then `scripts/regolden-content.sh --check`
- `scripts/gate.sh --quick --oracle packet/P-AUG-NATIVE-1a --allow-artefacts --regen-fixtures`

## 10. Risk and suggested model tier
implementer-opus: a serialized state field with a hand-written `Serialize` whose soundness rests on the hasher's
layout rules, a checkpoint format bump, `check_world` rules, and a content-hash move. The behaviour is small (no
hooks); the risk is a Legacy hash or checkpoint byte moving, which the oracle's recorded digests catch.

## 11. Known traps
- `CardId::index()` of a native id is 80..93: every `counts.0[id.index()]` and `DEFINITIONS[id.index()]` must branch
  first (`Build::owns`, `count`, `set`, `add`, `valid`, `tier`, `definition`). `Build::cards()` must keep the 80 first,
  in catalog order, then the natives (readers iterate it).
- A `#[serde(skip_serializing_if)]` on `Build::native` fails `Sim::check_layout`; write `Build`'s `Serialize` by hand.
  Field names must stay `counts` and `boosts`; `deny_unknown_fields` stays on.
- A held slot's zero values are written (`counter: 0.0` etc.); a non-held slot is never written, so code that clears a
  card (faction reset, training console `console.rs:105`, `cards/runtime.rs:42`) must zero its whole slot, or a
  restore loses state and the hash differs.
- The `card_tank_hp` cap reads the world's table (`k.cards`), not `TANK_ENGINE_CAP`: a Rework world holds up to 350.
- No `CardId` match elsewhere is exhaustive except `as_str` (checked: `rg 'FinalVerdict =>'`).
- `content/fold.rs` and the regolden copies are shared with P-AUG-POOL-1-fix; `constants.rs` with P-ELITE-TUNE-1;
  `CHECKPOINT_FORMAT` with P-ELITE-PICK-1. Merge serially; the later one re-runs the script.

## Plan deviations (for the coordinator)
- The plan says "branch `definition()` for native ids by extending `emit_cards.py` (`catalog.rs` is generated)". Found:
  `emit_cards.py` generates only `catalog_data.rs` (its `OUT`, line 12), `catalog.rs` is maintained by hand despite its
  header, and `emit_cards.py` is sha-pinned by the card provenance audit, which runs in every gate. This brief leaves
  the generator alone and hand-edits `catalog.rs` (the native definitions live in `cards/native/table.rs`).

## Notes from previous attempts
<!-- Coordinator appends on escalation: tier, branch, the gate's failure block. Nothing else. -->
