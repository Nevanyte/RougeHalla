# P-AUG-POOL-1-fix: fold both realized card tables (named numbers, override rows, chest pool) into the content hash

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-CARDS-2/3), under the owner's 2026-11-18 approval of the elite
  and augment rework (`docs/OWNER_DECISIONS.md` row "Elite and augment rework", 2026-11-18). Follow-up of P-AUG-POOL-1
  (reviewer-opus, integration 62 review): a broken guarantee, the rules identity (`content_hash`) does not cover the
  card tables a world plays. Widened by the coordinator on 2026-11-19 (after the first oracle) from the chest pool to the
  whole realized table, the same class of hole.
- **Implementer tier:** implementer-opus (`content/fold.rs` is a shared content-identity file; the content hash moves)
- **Reviewer:** reviewer-opus
- **Integration base:** `feature/unity-rework` @ 7673f8a02 (content hash `c890f52fd7ab4546`)
- **D-rules touched:** D1 n/a (no gameplay change: identity only) · D2 n/a · D5/D6/D9 none. Moves `content_hash`
  (Welcome, `/info`, replays: older replays are refused with ContentMismatch, as every regold).

## 1. ID and outcome
`cards::Tuning` is the card table a world plays (`k.cards`: `LEGACY` under `SimConfig::augments = Legacy`, `REWORK`
under `Rework`, the live world). The content registry folds every constant's **value by name**, but not which table
slot reads it, and the table's own identifiers not at all. So each of these changes gameplay and leaves `content_hash`
where it was:
- **Named card numbers.** Each `CardNumbers` field is filled with a registered constant by name. Pointing a field at
  another constant, or swapping two fields, changes the numbers without changing the registry.
- **Override rows.** Each `REWORK_OVERRIDES` row number is a registered `REWORK_*` constant by name (enforced by
  P-AUG-CONTENT-1-fix's guard) or a copied catalog literal. Pointing a row at a different constant, swapping two rows'
  numbers, or removing a row (the card plays its catalog row again) is invisible to the hash.
- **Chest inputs** (P-AUG-POOL-1):
  - the pool ids (`Tuning::pool()`: `REWORK_POOL`; under Legacy `INTERACTIVE`);
  - the `faction_only` `(CardId, FactionId)` pairs (`Offer::Faction`; P-AUG-NATIVE-4 will add some);
  - the `weight_eye_for_an_eye` flag.
  Changing any of them changes chest offers and reward draws.

When this packet lands, `content_hash` folds the **realized** table of both rules: the `CardNumbers` field values in a
fixed field order, each override row's id and numbers (the `cards::map_numbers` walk, rows then selections), and the
chest inputs. Each perturbation of those moves the hash, with the registry identical. The hash is regolded through
`scripts/regolden-content.sh`. The stale `NON_GAMEPLAY` reasons ("identifiers only", "no number of its own", "EMPTY
here") are corrected, and the rows of the folded tables move to `TABLES_FOLDED_BY_HASH`.

No gameplay changes: no draw, no offer, no number, no checkpoint or wire byte.

**Card text is not folded (decision, this brief).** `CardDef::title`/`text` (and a selection's `text`) are display,
not rules:
- No sim outcome reads them.
- `check_override` (`cards/tuning.rs`) forces `title` equal to the catalog's, and lets only `text` and row numbers
  differ.
- The client's copy of the override text is pinned by the Unity mirror test
  (`client-unity/UnityProject/Assets/Tests/Editor/BuildDrawerEditModeTests.cs:40-53`, which reads `rework_overrides.rs`).

Folding text would make every wording fix a regold and refuse older replays for a change no replay can observe. The
override rows' shape (variant, keys, flags, `tier`, `unique`, ...) is forced equal to the catalog row by
`check_override`: `Tuning::of` debug-asserts `check_table`, and `tuning_tests.rs:459`
`the_real_override_table_passes_the_guard` runs it on release builds. So folding id plus numbers covers what may vary.
Folding the shape as well is allowed but not required.

## 2. Dependencies
- P-AUG-POOL-1 (merged, integration 62); P-AUG-CONTENT-1 and P-AUG-CONTENT-1-fix (merged).
- **Merges after P-ELITE-TUNE-1** (in flight, `agent/sonnet/P-ELITE-TUNE-1`): both regold the content hash, in the same
  six copies:
  - `tests/content.rs`;
  - the two `tools/unity-browser-reload-proof/*.mjs`;
  - `BakedContent.cs`;
  - `parity/abilities/hash-tape.json`;
  - `protocol/fixtures/archetypes_v1.json`.

  The implementer rebases on the integration head after ELITE-TUNE-1 lands and regolds once, there. The coordinator
  orders the merges (MIGRATION "P-AUG-POOL-1-fix (Opus): after P-ELITE-TUNE-1").
- Any later packet that adds a `CardNumbers` field must list it in this oracle's `number_fields` (it has no `..`, so the
  test stops compiling until the field is listed and so perturbed). That is an oracle edit for the owner, by design.

## 3. Relevant legacy paths
None: the identity fold is Rust-only. Legacy's values are what the Legacy table must keep (pinned as fold inputs):
- the pool `packages/shared/src/cards.ts:646-652` `INTERACTIVE_AUGMENT_IDS` (the 14, = `reward_chests::INTERACTIVE`);
- the card constants `constants.ts:237-288` (Rust `constants.rs`, by name in `LEGACY`);
- Third Time's inline `3` / `1.` (`onHit.ts:39`).

Legacy has no override rows, no faction-only offers and no weighting. `docs/OWNER_DECISIONS.md` has no row on
content-hash coverage; the elite and augment rework row (2026-11-18) governs the Rework tables.

Rust today (integration head 7673f8a02, before the stubs):
- `crates/rh-sim/src/cards/tuning.rs`:
  - `:18-48` `CardNumbers` (14 fields);
  - `:76-89` `Tuning` (fields `numbers`, `overrides`, `pool` `:82`, `faction_only` `:85`, `weight_eye_for_an_eye` `:88`);
  - `:102-124` `LEGACY` (legacy constants by name, `overrides: &[]`, `INTERACTIVE`, `&[]`, `false`);
  - `:125-147` `REWORK` (`REWORK_*` constants by name, `REWORK_OVERRIDES`, `REWORK_POOL`, `&[]`, `true`);
  - `:428` `map_numbers` (private before the stub), the exhaustive number walker `check_override` uses.
- `crates/rh-sim/src/cards/rework_overrides.rs:19-` `REWORK_OVERRIDES` (20 rows, no selections today).
- `crates/rh-sim/src/reward_chests/pools.rs:10-25` `INTERACTIVE`; `:30-50` `REWORK_POOL`.
- `crates/rh-sim/src/content/fold.rs`:
  - `:113-169` `visit_progression_content` folds the card *names* (`CardId::ALL`, `:156-162`) and `cards::visit_content`
    (tiers and five numbers, `cards/rules.rs:19-32`): no table slot, no override row, no pool.
  - The `reward-chests/1` stream (`reward_chests/rules.rs:29-44`) folds tier weights, range, lifetime, skip and
    themed-first ids, not the pool.
- `crates/rh-sim/src/content/definitions.rs:66-70` folds `visit_progression_content` under `mvp-progression/1`;
  `fold.rs:278` `content_hash_of_progression_words` is its word seam.
- `crates/rh-sim/tests/content.rs`:
  - `NON_GAMEPLAY` rows: `:66-67` `LEGACY` / `REWORK` ("no number of its own"); `:68` `REWORK_OVERRIDES` ("EMPTY here
    ... P-AUG-CONTENT-1 ... moves this entry to TABLES_FOLDED_BY_HASH", never done); `:73-74` `INTERACTIVE` /
    `REWORK_POOL` ("identifiers only");
  - `:196` `TABLES_FOLDED_BY_HASH`;
  - `:574` `GOLDEN_CONTENT_HASH = 0xc890_f52f_d7ab_4546`.
- `REWORK_EYE_FOR_AN_EYE_WEIGHT` and every `REWORK_*` value are registry rows (`constants.rs`), already folded by value.

## 4. New paths
- `crates/rh-sim/tests/chest_pool_content.rs` (oracle; a new file because the implementer must edit
  `tests/content.rs`). The name predates the widening; it is kept so that the oracle file list stays one file.

## 5. Exclusive write scope
- `crates/rh-sim/src/content/fold.rs`:
  - the fold, and the body of `content_hash_of_card_tables`;
  - `CardTableSnapshot`, `CardTableSnapshot::of` and `card_table_snapshots` may be reworked, but keep their signatures
    and fields.
- `crates/rh-sim/src/cards/tuning.rs`: accessors only (`of_rule`, `overrides`, `faction_only`,
  `weights_eye_for_an_eye`, and `map_numbers` made `pub`, all from the stubs). No table, number or behaviour change.
- `crates/rh-sim/src/cards/mod.rs`: the `pub use tuning::{..}` line only (the stub added `map_numbers`).
- `crates/rh-sim/src/content/definitions.rs`: only if the implementer folds the tables as their own stream rather than
  inside `visit_progression_content` (one `h.str(..)` plus a visitor call); otherwise untouched.
- `crates/rh-sim/tests/content.rs`:
  - Move these rows from `NON_GAMEPLAY` to `TABLES_FOLDED_BY_HASH`, each with a reason naming the fold:
    - `cards/tuning.rs` `LEGACY` and `REWORK` (the realized tables);
    - `cards/rework_overrides.rs` `REWORK_OVERRIDES` (its stale "EMPTY here" reason goes);
    - `reward_chests/pools.rs` `INTERACTIVE` and `REWORK_POOL`.
  - `GOLDEN_CONTENT_HASH`, only through `scripts/regolden-content.sh`.
- The other regold copies, only through `scripts/regolden-content.sh`. It rewrites `BakedContent.cs`, a build artefact
  by name: run the gate with `--allow-artefacts` for that one file.
- `docs/agent/AUGMENT_REWORK.md`: say that a table's named numbers, override rows and chest inputs are in the content
  hash, and that adding a row, a pool card or a faction pair, or repointing a field, is a regold. Put it in "The chest
  pool" section, in "Adding an override row" and in "Changing a named number".

## 6. Contracts and references
- `crates/rh-sim/AGENTS.md`: content goes where `content_hash` folds it; `tests/content.rs` stays green.
- `docs/agent/AUGMENT_REWORK.md` "The chest pool (P-AUG-POOL-1)" and the override-row steps.
- C-PARITY: no parity fixture moves except the two protected hash copies the regold script rewrites
  (`parity/abilities/hash-tape.json`, `protocol/fixtures/archetypes_v1.json`), by their documented commands.
- P-AUG-CONTENT-1-fix (`cards/rework_guard_tests.rs`) keeps every changed override number a `REWORK_*` value; this
  packet makes *which* value each slot reads part of the identity too.

## 7. Behaviour to preserve
- Every card number, override row, chest offer and reward draw, under both rules: no file under `reward_chests/`,
  `systems/` or `cards/` changes beyond the accessors. `reward_chests/pool_tests.rs` (including
  `legacy_offers_and_draws_are_the_integration_heads`), `cards/rework_content_tests.rs` and `rework_guard_tests.rs`
  stay green.
- The Legacy table's inputs are exactly today's. "The Legacy fold equals today's behaviour" means: the fold reads these
  inputs (pinned), and the digest itself moves.
  - the numbers: the legacy constants by name, Wishful share rules 0, Third Time `3` / `1.`;
  - no override row, so every `def(id)` is the catalog row;
  - pool `INTERACTIVE` in source order, no faction pair, no weighting;
  - `offer(id)` is `Some(Offer::Any)` for the 14 and `None` for the other 66 ids.
- No checkpoint, replay, observation or protocol version moves; only `content_hash` (and its six copies).

## 8. Acceptance checks
- `cargo test -p rh-sim --test chest_pool_content` green (the oracle).
- `cargo test -p rh-sim --test content --test progression_content` green after the regold.
- `cargo test -p rh-sim --lib cards::` green (the override guard and the rework content tests).
- `scripts/regolden-content.sh --check` exits 0.
- `scripts/gate.sh --quick --allow-artefacts --oracle packet/P-AUG-POOL-1-fix` passes.

## Existing tests that pin what this packet changes
- `crates/rh-sim/tests/content.rs:566-574` `hash_golden` / `GOLDEN_CONTENT_HASH` (`0xc890_f52f_d7ab_4546`): moves, by
  the regold script only. There is no `oracle-amend:` for it: the script is the documented route, and P-ELITE-TUNE-1
  moves it first.
- `crates/rh-sim/tests/content.rs:991` `every_const_in_the_source_tree_is_registered_or_explained`, with the
  `NON_GAMEPLAY` rows `:66-68` and `:73-74`, stays green when those five rows move to `TABLES_FOLDED_BY_HASH`: the test
  accepts a `(file, name)` in either list and requires each listed name to be declared (`:1021`).
- `crates/rh-sim/tests/progression_content.rs:7-27`
  `actual_progression_words_and_order_participate_in_the_aggregate_identity` asserts
  `content_hash_of_progression_words(visit_progression_content words) == content_hash()` and more than 200 words. It
  stays green either way, with no conflict:
  - tables folded inside `visit_progression_content`: more words;
  - folded as a separate stream in `definitions.rs`: that stream is not part of the progression words.
- `crates/rh-sim/src/cards/rework_guard_tests.rs` (P-AUG-CONTENT-1-fix) keeps a private mirror of `map_numbers`. Making
  `map_numbers` public does not touch it; it stays green.
- `crates/rh-sim/src/reward_chests/pool_tests.rs` (P-AUG-POOL-1's oracle) asserts the real tables' pools, that both
  real tables are all `Offer::Any`, and the Legacy draw golden. Not touched; must stay green.
- `crates/rh-sim/tests/augment_rules.rs`
  `the_card_table_is_the_legacy_catalog_under_legacy_and_for_unchanged_cards_under_rework`: `Tuning::of(Legacy).pool()
  == INTERACTIVE`, Rework `== REWORK_POOL`, and the Legacy defs are the catalog's. Not touched; stays green.
- The regold copies (`tools/unity-browser-reload-proof/check.mjs`, `normal-companion.mjs`,
  `client-unity/UnityProject/Assets/Scripts/BakedContent.cs`, `parity/abilities/hash-tape.json`,
  `protocol/fixtures/archetypes_v1.json`): rewritten by the script only.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/chest_pool_content.rs` (`oracle:` commit; widened in the `oracle-amend:` commit by coordinator
  decision 2026-11-19)
- `docs/backlog/packets/P-AUG-POOL-1-fix.md`

The `oracle-amend:` commit changes only this packet's own new oracle file (not merged, never in the integration
branch); no existing test of the integration branch changes.

The seam (`stub:` commits; the implementer replaces the body of `content_hash_of_card_tables` and makes `content_hash`
fold `card_table_snapshots()`), in `crates/rh-sim/src/content/fold.rs`, re-exported as `rh_sim::content::*`:

```rust
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CardTableSnapshot<'a> {
    pub rule: crate::AugmentRule,
    pub numbers: crate::cards::CardNumbers,
    pub overrides: &'a [crate::cards::CardDef],
    pub pool: &'a [crate::cards::CardId],
    pub faction_only: &'a [(crate::cards::CardId, FactionId)],
    pub weight_eye_for_an_eye: bool,
}
impl CardTableSnapshot<'static> { pub fn of(t: &'static crate::cards::Tuning) -> Self }
pub fn card_table_snapshots() -> [CardTableSnapshot<'static>; 2]       // [Legacy, Rework], via Tuning::of_rule
pub fn content_hash_of_card_tables(registry: &[Entry], stagger_weapons: &[WeaponId],
                                   tables: &[CardTableSnapshot<'_>]) -> u64 // STUB: ignores `tables`
```

The stub also changes `crates/rh-sim/src/cards/tuning.rs`, adding accessors to `impl Tuning`. They are real accessors
with no behaviour:
- `pub fn of_rule(rule: AugmentRule) -> &'static Tuning`;
- `pub fn overrides(&self) -> &'static [CardDef]`;
- `pub fn faction_only(&self) -> &'static [(CardId, FactionId)]`;
- `pub fn weights_eye_for_an_eye(&self) -> bool`.

It also makes `pub fn map_numbers(row: &CardRow, f: &mut dyn FnMut(f64) -> f64) -> CardRow` public, re-exported as
`rh_sim::cards::map_numbers`. The first stub's `ChestPoolTable` / `chest_pool_tables` / `content_hash_of_chest_pools`
are removed by the last `stub:` commit (superseded).

What each oracle test pins (`chest_pool_content.rs`):
- **`the_folded_card_tables_are_the_real_tables_and_legacy_is_todays`** (green at the stub: the input pin):
  - `card_table_snapshots()` is `[Legacy, Rework]`, each equal to `CardTableSnapshot::of(Tuning::of(config))` for the
    default config, `live_content()` and a Rework config.
  - Legacy:
    - the numbers are exactly the legacy constants (`PLANT_FEET_BONUS`, `GAMBLER_CHANCE` twice, `GAMBLER_UP`/`_DOWN`,
      `WISHFUL_*`, shares 0, `OUTGOING_ROW_CAP`, `HP_RACE_CAP`, 3, 1.);
    - no override, every `def(id)` is the catalog's;
    - pool `INTERACTIVE`, no pair, flag off, and `offer` is `Any` for exactly the 14.
  - Rework: its numbers and overrides are the live table's (at least 10 rows), its pool is `REWORK_POOL`, its pairs are
    the table's, the flag is on.
- **`the_seam_with_the_real_tables_is_the_content_hash`** (green at the stub):
  `content_hash_of_card_tables(REGISTRY, STAGGER_WEAPONS, &card_table_snapshots()) == content_hash()`. This ties the
  seam to the real identity.
- **`every_card_number_field_of_either_table_moves_the_content_hash`** (red): each of the 14 `CardNumbers` fields
  (f64 bits ^1, `third_time_every` ^1), in each table, moves the hash, and all 28 hashes are distinct.
- **`swapping_two_card_number_fields_moves_the_content_hash`** (red): in each table, swapping `gambler_up` and
  `gambler_down`, or `plant_feet_bonus` and `outgoing_row_cap`, moves the hash. The set of values is unchanged by the
  swap, and the test asserts the two values differ.
- **`every_number_of_every_rework_override_row_moves_the_content_hash`** (red): every number of every Rework override row
  (in `map_numbers` order, rows then selections) bumped by one ulp moves the hash. All are distinct, with at least one
  per row.
- **`retargeting_swapping_or_removing_a_rework_override_row_moves_the_content_hash`** (red): each of these moves the
  hash:
  - the first override's first number replaced by another registered `REWORK_*` value;
  - two rows' first numbers swapped;
  - each override row removed.
- **`adding_or_removing_one_pool_card_moves_the_content_hash`** (red): for each table, removing each pool card, and
  adding each live augment outside it (at least 6 for Legacy, at least 1 for Rework), moves the hash. All are distinct.
- **`adding_or_changing_a_faction_pair_moves_the_content_hash`** (red): for each table, `(first pool card, f)` for each
  of the five factions, and a second pair, moves the hash. All are distinct.
- **`flipping_the_eye_for_an_eye_weight_flag_moves_the_content_hash`** (red): each table's flag flipped moves the hash.
- **`which_rule_holds_which_table_is_folded`** (red): each of these moves the hash:
  - the two tables swapped;
  - Legacy given the Rework pool;
  - Legacy given the Rework override rows.

At the stub the eight red tests fail on their first `assert_ne!`, by assertion; both hashes are `0xc890f52fd7ab4546`.
For example: "changing the Legacy table's plant_feet_bonus does not move content_hash", or "number 0 of the Rework
override row of HereComesTheBoom does not move content_hash". The two green tests pass.

A throwaway prototype (not committed) passed all ten tests and `tests/progression_content.rs`; `tests/content.rs` then
failed only `hash_golden`, the expected regold. The prototype:
- `visit_progression_content` delegates to `visit_progression_content_with(tables, ..)`.
- That function appends, for each table, before the boost names:
  - the rule;
  - the 14 `CardNumbers` words in field order;
  - the override count, then for each row: its id, its row count, and for each row its number count and number bits
    (via `map_numbers`), then its selections;
  - the pool length and ids, the pair count and pairs, and the flag.
- The seam collects those words into `content_hash_of_progression_words`.

## 9. Validation commands
- `cargo test -p rh-sim --test chest_pool_content`
- `cargo test -p rh-sim --test content --test progression_content`
- `cargo test -p rh-sim --lib cards::`
- `scripts/regolden-content.sh` then `scripts/regolden-content.sh --check`
- `scripts/gate.sh --quick --allow-artefacts --oracle packet/P-AUG-POOL-1-fix`

## 10. Risk and suggested model tier
Opus implementer, `reviewer-opus`. This is a shared content-identity file, and the hash move must be followed by every
client, replay and fixture copy. A fold that reads copies instead of the `Tuning` statics would pass the seam tests and
still miss a later table edit.

## 11. Known traps
1. **Fold the real tables.** `content_hash` must fold `card_table_snapshots()` (which reads `Tuning::of_rule`), not a
   copy of the arrays or the constants. The seam and `content_hash` must share one code path, e.g. a
   `visit_card_tables(tables, word)` called by both. The oracle checks the identity with the real tables; the reviewer
   checks there is no second list.
2. **Unambiguous framing.** Per table, fold a tag, then:
   - the rule;
   - the numbers in a fixed field order;
   - the override count, then per row its id, row count, and per row the number count and bits (then the selections:
     faction code and rows);
   - the pool length then ids;
   - the pair count then pairs;
   - the flag.

   Then moving a value between slots, rows or tables cannot collide; the oracle asserts the perturbations are distinct.
   Use `CardId::index()`, `FactionId::code()` and `f64::to_bits()`.
3. **One walker.** Fold override numbers through `cards::map_numbers`, the exhaustive walker `check_override` uses: a
   new row variant or number field is then folded the moment it is classified there. Do not write a second match.
4. **`CardNumbers` field order.** Destructure `CardNumbers` without `..` in the fold too, so that a new field fails to
   compile until it is folded.
5. **Text stays out** (decision in section 1). Fold `id` and numbers. `title`/`text`/`tags` are display, or are forced
   equal to the catalog row by `check_override`.
6. **Pool order and override-row order are not behaviour**: `augment_pool` walks `CardId::ALL`, and `def` finds a row by
   id. The oracle does not pin whether reordering them moves the hash; folding in array order is fine.
7. **Where to fold.** The simplest place is inside `fold.rs` alone (the prototype above). `tests/progression_content.rs`
   stays green either way.
8. **Regold once, after P-ELITE-TUNE-1**, through `scripts/regolden-content.sh` (never hand-edit a copy); then run
   `--check`. Protected copies (`parity/`, `protocol/fixtures/`) are written by the script's documented commands.
9. **`TABLES_FOLDED_BY_HASH` reasons.** `every_const_in_the_source_tree_is_registered_or_explained` reads `(file, name)`
   only, but the reasons are the record a later packet trusts. Name the fold, e.g. "folded by
   `content::card_table_snapshots` under `mvp-progression/1`".

## Notes from previous attempts
None.

Still outside this packet (flagged, not widened):
- The generated catalog (`cards/catalog_data.rs` `DEFINITIONS`, `NON_GAMEPLAY` "the gameplay numbers are the registered
  source constants") has the same by-name-only coverage for its rows. It is generated from, and pinned to, the legacy
  capture rather than hand-written.
- `mob_runtime.rs` `LEGACY_ELITES` / `REWORK_ELITES` (by-name constants in a struct) have the same shape of hole.
  P-ELITE-TUNE-1 is filling them now.
