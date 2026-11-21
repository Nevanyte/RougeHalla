# P-AUG-RULES-1: the elite and augment rework seam (two live-only rules, a rule-aware card table, an elite table; no behaviour change)

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-CARDS-2/3, P-MOBS-2), under the owner's 2026-11-18 approval
  of the elite and augment rework (`docs/OWNER_DECISIONS.md` row "Elite and augment rework", 2026-11-18; plan of record
  `docs/backlog/AUGMENT_ELITE_REWORK.md`, "Decisions taken" 1 and "Architecture").
- **Implementer tier:** implementer-opus (rh-sim state, statics digest, save/restore checks; cross-crate: rh-sim,
  rh-server, rh-headless, rh-policy)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10); this packet changes no outcome, so its proof is
  equivalence (Legacy and Rework with empty tables play the same match) and every existing parity fixture stays
  byte-identical · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Every later rework packet changes numbers and behaviour only in the live world. This packet builds the switch and the
seams, and changes nothing a player can see:
- Two `SimConfig` rules, `augments: AugmentRule { Legacy (default), Rework }` and `elites: EliteRule { Legacy (default),
  Rework }`, exactly like `CampBuffRule` / `FrostWish` (`crates/rh-sim/src/statics.rs:276-360`): `Legacy` serializes as
  nothing and folds no hash word, `Rework` is `"rework"` in JSON and a tag of its own in the state hasher.
  `SimConfig::live_content()` (`statics.rs:435-460`) selects `Rework` for both; `SimConfig::default()` keeps `Legacy`.
- A card tuning table, `cards::Tuning`, derived on `MatchStatic` (`#[serde(skip)] cards: &'static Tuning`, built from
  the config like `hazards` / `blink_ring`, `statics.rs:14-96`), in the manner of `abilities::definition_for`
  (`abilities/mod.rs:390-398`). It answers `def(id)`, the named numbers (`CardNumbers`) and the pools. Under `Rework` it
  reads a hand-written override table that is EMPTY in this packet, so it equals legacy.
- Every reader of card rows and of the named numbers goes through the table, so a later override row is applied
  everywhere at once (fold, restore check, ledger, hooks, pools, envelope).
- An override-shape guard: an override may differ from its legacy definition only in row numbers and the `text`
  string (coordinator amendment, 2026-11-19); `id`, `title`, `kind`, `tier`, `base`, `requires`, `unique`, `ready`,
  `tags`, every row's variant and key (flags included) and the selections' factions and row shapes must be equal.
- The override table is ONE hand-written file, `crates/rh-sim/src/cards/rework_overrides.rs`, holding
  `pub(crate) static REWORK_OVERRIDES: &[CardDef] = &[ ... ];` whose entries are written exactly in the
  `catalog_data.rs` layout (`CardDef { id: CardId::<Id>, kind: ..., tier: ..., base: ..., requires: ..., unique: ...,
  ready: ..., title: "...", text: "...", tags: &[...], rows: &[...], selections: &[...] }`, one field per line, in
  that order), so the C# mirror test's regex (`BuildDrawerEditModeTests.cs:28`) reads the live text from it unchanged.
- An elite table, `mob_runtime::EliteTuning { k, hp_mult, dmg_mult }`, read wherever `ELITE_K` / `ELITE_HP_MULT` /
  `ELITE_DMG_MULT` are read today; legacy values under both rules.
- A guide, `docs/agent/AUGMENT_REWORK.md`: how a later packet adds a rework override row or a rework number.

When this lands: no state hash, content hash, checkpoint, replay or parity fixture of a `Legacy` world moves; a
`Rework` world differs from the same `Legacy` world only by its statics digest (so its state hashes), and plays the same
match.

## 2. Dependencies
None (wave 1). P-AUG-CONTENT-1, P-SIM-BENCH-SEAM-1, P-AUG-PLANT-1 and every later rework packet build on it.

## 3. Relevant legacy paths
The rework itself is not legacy (owner-approved new design); these are the legacy numbers the seam must reproduce
under both rules (verified with `rg`):
- `packages/shared/src/constants.ts:237` `HP_RACE_CAP = 2.5`, `:242` `OUTGOING_ROW_CAP = 2.5`, `:276`
  `PLANT_FEET_BONUS = 0.25`, `:278-280` `WISHFUL_BUDGET_MS` / `WISHFUL_WINDOW_MS` / `WISHFUL_FLOOR_SHARE`, `:286-288`
  `GAMBLER_CHANCE` / `GAMBLER_UP` / `GAMBLER_DOWN`, `:485` `ELITE_K = 0.65`, `:513-514` `ELITE_HP_MULT = 2.0`,
  `ELITE_DMG_MULT = 1.5`.
- `packages/shared/src/mods.ts:284` (G1: the fold clamps the `hit` mult at OUTGOING_ROW_CAP) and `:288` (G4: the
  `hpRace` mult at HP_RACE_CAP); `packages/server/src/sim/mods.ts:685` (the outgoing row ceiling `OUTGOING_ROW_CAP /
  own`).
- `packages/server/src/sim/cardState.ts:99-105` (Gambler: up below `GAMBLER_CHANCE`, down below `2 * GAMBLER_CHANCE`).
- `packages/server/src/sim/onHit.ts:39` (Third Time: every third hit in a row adds one on-hit application).
- `packages/server/src/sim/cardHooks.ts:364-383` (Wishful Thinking: budget, window, floor).
- `packages/server/src/sim/weapons.ts:333-339` (Plant Your Feet: `1 + PLANT_FEET_BONUS` on the packet's raw and mult,
  and as the range multiplier).
- `packages/shared/src/mobs.ts:37-41` (`mobFaction`: elite `k`, `hpMult`, `d`), `:211` (`mobTypeFaction`).
- `packages/shared/src/cards.ts:261` (Machine Gun), `:282` (Arcane Overload), `:287` (Committed), `:646-652`
  (`INTERACTIVE_AUGMENT_IDS`).

Rust readers today (each must read the seam after this packet):
- Card rows, `CardId::definition()`: `cards/mod.rs:290` (`has_flag`), `:323` (`add`), `:336` (`valid`), `:353`
  (`Build::rows`), `:405` (`on_blocked`, Tank Engine's fortify numbers); `cards/on_hit.rs:40, :286`;
  `cards/after_damage.rs:74`; `cards/on_hurt.rs:40`; `cards/on_overkilled.rs:35`; `kill_augments.rs:312`
  (`invested_scores`); `modifiers/mod.rs:82` (the mark-rate restore bound over every card), `:683` (`execute_share`),
  `:910` (`outgoing_damage`); `reward_chests/pools.rs:39, :51, :67`; `reward_chests/mod.rs:303-309` (the `requires`
  refusal); `systems/training/console.rs:70-129, :426`; `systems/mob_checkpoint.rs:66` (Hemorrhage's bleed-duration
  restore bound); `quests/rules.rs:67, :77` (base and tier only).
- `Build::rows` callers: `modifiers/mod.rs:195` (`Modifiers::valid`, the cached-modifier re-fold at restore,
  `:185-200`), `:330` (`recompute_core`), `:789` (`fold_build`, used by `maximum_packet`); `build_summary.rs:100`;
  `cards/fight_clock.rs:12`.
- Named numbers: `constants.rs:100-115`; readers `cards/mod.rs:126-129` (Gambler), `:237-241` (Wishful),
  `systems/melee.rs:138` (Plant bonus), `cards/on_hit.rs:236-245` (Third Time `% 3` and `+1`),
  `modifiers/mod.rs:665` (`hp_race_mult`), `:899-905` (outgoing ceiling); and the STAT FOLD's own copies,
  `stat_fold/definition.rs:47` (`hp_race_cap`) and `:52` (`outgoing_row_cap`), applied at `stat_fold/fold.rs:205-207`
  and `:216-218` and folded into the content hash (`stat_fold/definition.rs:101-113`).
- The ranged-packet envelope: `modifiers/mod.rs:805-835` (`maximum_packet`, folds only `cards::SUPPORTED` =
  Slow Burn, Pocket Sand, Siphon, with max boosts and `Farm::maximum()`), used by `checkpoint.rs:273-279`
  (`valid_ranged_packet`) at `:644` (projectiles) and `:916` (pending actions).
- Pools: `reward_chests/pools.rs:47-74` (`conditional_pool`, `augment_pool`), callers `reward_chests/mod.rs:107`
  (`drop_augment`), `systems/training/console.rs:408`.
- Elites: `state.rs:1083-1093` (`World::faction_spec` hp) and `:1121-1130` (`point_damage`), `mob_runtime.rs:413-427`
  (`spawn_hp`, called from `Mob::born` at `:334`, `:352`; `Mob::born` callers all hold `k`), `systems/sentenced.rs:540-541`
  (`npc_pulse`), `rh-policy` `bots/planning.rs:180-183` (`mob_faction`) and
  `bots/temporal_percept/strategy/hunt_adapter.rs:286-291` (`mob_max_hp`).

## 4. New paths
- `crates/rh-sim/src/cards/tuning.rs` (stub on `packet/P-AUG-RULES-1`; the implementer replaces the bodies):
  `Tuning`, `CardNumbers`, `ShapeError`, `check_override`.
- `crates/rh-sim/src/cards/rework_overrides.rs` (stub: the empty table, in its fixed layout; later packets fill it).
- `crates/rh-sim/src/mob_runtime/elite_tuning.rs` is NOT required: `EliteTuning` is stubbed in `mob_runtime.rs`; the
  implementer may move it.
- `docs/agent/AUGMENT_REWORK.md` (the guide).
- Oracle files: see "Oracle files" below.

## 5. Exclusive write scope
- `crates/rh-sim/src/statics.rs`, `crates/rh-sim/src/lib.rs`, `crates/rh-sim/src/cards/tuning.rs`,
  `crates/rh-sim/src/cards/rework_overrides.rs` (stays an empty table here),
  `crates/rh-sim/src/cards/mod.rs`, `crates/rh-sim/src/cards/on_hit.rs`, `cards/after_damage.rs`, `cards/on_hurt.rs`,
  `cards/on_overkilled.rs`, `cards/fight_clock.rs`, `crates/rh-sim/src/kill_augments.rs`,
  `crates/rh-sim/src/build_summary.rs`, `crates/rh-sim/src/modifiers/mod.rs`, `crates/rh-sim/src/checkpoint.rs`,
  `crates/rh-sim/src/reward_chests/pools.rs`, `crates/rh-sim/src/reward_chests/mod.rs`,
  `crates/rh-sim/src/systems/training/console.rs`, `crates/rh-sim/src/systems/mob_checkpoint.rs`,
  `crates/rh-sim/src/systems/melee.rs`, `crates/rh-sim/src/systems/ledger.rs`, `crates/rh-sim/src/state.rs`,
  `crates/rh-sim/src/mob_runtime.rs`, `crates/rh-sim/src/systems/mobs.rs`, `crates/rh-sim/src/systems/sentenced.rs`,
  `crates/rh-sim/src/hash.rs` (only if the elite seam stores a field), `crates/rh-sim/src/stat_fold/fold.rs` (only to
  take the fold caps from the table; `stat_fold/definition.rs` stays as it is)
- `crates/rh-policy/src/lib.rs`, `crates/rh-policy/src/bots/planning.rs`,
  `crates/rh-policy/src/bots/temporal_percept/strategy/hunt_adapter.rs`
- The full `SimConfig` literals the stub commit already updated (compile-only `Legacy` lines; edit only if a
  signature forces it): see the stub commit's file list.
- `docs/agent/AUGMENT_REWORK.md` (new).
- Not in scope: `Cargo.lock`, any `Cargo.toml`, `parity/**`, `protocol/fixtures/**`, `packages/**`,
  `crates/rh-sim/src/cards/catalog.rs` / `catalog_data.rs` (generated), `stat_fold/definition.rs`, `constants.rs`.

## 6. Contracts and references
- C-PARITY (every parity fixture byte-identical), C-DET / ADR 0007 (the digest pins the config; the new tags must not
  collide with any other config value: `statics.rs:313-326`), C-RNG (no new draw), C-TICK (no schedule row),
  C-OBS (nothing new is observed).
- `crates/rh-sim/AGENTS.md`: no_alloc, hash_coverage, check_world.
- `docs/backlog/AUGMENT_ELITE_REWORK.md` "Live-only pattern" and "Architecture".

## 7. Behaviour to preserve
- `SimConfig::default()` and every `Legacy` world: same statics digest, state hashes, checkpoints, replays, RNG draws,
  events, observations and content hash (`tests/content.rs:568`). `CardId::definition()` and the generated catalog do
  not change (`tests/card_catalog.rs`). The public `reward_chests::augment_pool` / `conditional_pool` keep their
  signatures and answers (`tests/reward_pools.rs`).
- A `Rework` world with the empty tables: the same events, world state and observations as the same `Legacy` world;
  only `statics.config.augments` / `.elites` and the digest differ.
- The ranged-packet envelope under `Legacy` is not loosened (restore acceptance of `Legacy` worlds unchanged).
- No allocation per step (`tests/no_alloc.rs`, `tests/cards_no_alloc.rs`): `Tuning` lookups are static, not built
  per call.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-AUG-RULES-1` passes; the coordinator's full gate on the merge.
- Every oracle file below green; the parity report MATCH unchanged; `tests/content.rs` content hash unchanged.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/augment_rules.rs` (new; `oracle:`): the rules' defaults and `live_content`, the JSON encoding
  and refusals, 64 distinct statics identities over the six silent config switches, the card table and the elite
  table legacy under both rules, equivalence of `Legacy` and empty `Rework` over seeds 11-13 on the elite-camp PvE
  fixture with fold cards granted through chests (events every tick, elite hp every tick, final checkpoint minus the
  two rule fields; floor: the elite is hurt on at least one seed, measured on all three), and a `Rework` checkpoint
  with Committed + Machine Gun + Arcane Overload and an arrow in flight that restores and plays on identically.
- `crates/rh-sim/src/cards/tuning_tests.rs` (new; `oracle:`, a `#[path]` module of `cards/tuning.rs`; the stub commit
  holds a one-line placeholder so the stub compiles): the shape guard (numbers and text admitted; tier, kind, unique,
  ready, base, requires, title, tags, id, a flag, a stat or mult key, a row added or removed, a selection added, a
  trigger's event, once or action refused), the test constructor through the guard, the real override table through
  the guard, a doctored +22% Committed reaching the fold and the restore check (and refused under the legacy table),
  the G1 cap reaching both the fold clamp (Boom 2.6) and the outgoing ceiling, Gambler's chances and factors read
  from the table, and the Rework ranged envelope covering eight fold cards (alone and together) at maximum boosts and
  farm, every faction, bow and wand, within 4x the legacy one.
- `crates/rh-sim/tests/hash_coverage.rs` (two `oracle-amend:` commits, for the owner):
  `the_serde_skips_are_exactly_the_documented_ones` counts `statics.rs` 8 (was 7), the new skip being
  `MatchStatic::cards`, with its reason; and two new scenarios in `scenarios()` for
  `every_serialized_leaf_of_a_match_changes_the_state_hash` (`augment_elite_rework_state`: practice arena, both rules
  `Rework`, config only; `elite_rework_mob_state`: the one-elite-camp PvE fixture under `Rework`), plus two `VALIDATED`
  rows, `statics.config.elites` and `world.mob_runtime.elites` (the latter used only if the elite seam keeps the rule
  on the mob runtime). Without a `Rework` scenario the campaign refuses the new optional leaves
  (`statics.config.augments` / `.elites` are null in every legacy scenario).
- `crates/rh-sim/tests/content.rs` (`oracle-amend:`, for the owner): `NON_GAMEPLAY` rows for `cards/tuning.rs`
  `LEGACY` / `REWORK`, `cards/rework_overrides.rs` `REWORK_OVERRIDES` and `mob_runtime.rs` `LEGACY_ELITES` /
  `REWORK_ELITES` (`every_const_in_the_source_tree_is_registered_or_explained` audits every `const`/`static` under
  `src/`). The implementation keeps exactly these names; it declares no other `const`/`static` (numbers come from the
  registered constants by name). P-AUG-CONTENT-1 moves `REWORK_OVERRIDES` to `TABLES_FOLDED_BY_HASH` when it fills it.
- `crates/rh-server/tests/live_content.rs` (`oracle-amend:`, for the owner): the exhaustive expected source-arena and
  training configs state `augments: Rework, elites: Rework` (the stub commit wrote `Legacy` there to compile).

Red on the stub, each on an assertion: all 7 tests of `augment_rules`, 6 of the 7 `tuning_tests` (the real-table guard
is green: the table is empty), `rh-server` `live_content`'s three exhaustive-config tests, and
`hash_coverage::every_serialized_leaf_of_a_match_changes_the_state_hash` (the stub writes `Rework` as null).
`the_serde_skips_are_exactly_the_documented_ones` and the content const audit are green after their amend commits.

### The stub (implementer-editable; commit `stub:`)
- `statics.rs`: `AugmentRule`, `EliteRule` (both variants serialize as unit, JSON reads only `null`), the two
  `SimConfig` fields with `#[serde(default)]`, `Legacy` in `Default`, NOT yet in `live_content()`;
  `MatchStatic::cards: &'static cards::Tuning` (`#[serde(skip)]`) set from `Tuning::of(&config)`. `lib.rs` re-exports.
- `cards/tuning.rs`: `Tuning { rule, numbers, overrides }` with `of(&SimConfig) -> &'static Tuning`, `rule()`,
  `numbers() -> &CardNumbers`, `def(id) -> &'static CardDef`, `pool() -> &'static [CardId]`, `augment_pool(&[Build])`,
  `conditional_pool(&[Build])`, `#[cfg(test)] for_test(rule, CardNumbers, &'static [CardDef]) -> Result<Tuning,
  ShapeError>`; `CardNumbers` (12 public fields, named in the file); `ShapeError { id, what }`;
  `check_override(legacy, rework) -> Result<(), ShapeError>`. The stub returns NaN numbers, an empty pool and an
  unchecked table.
- `cards/rework_overrides.rs`: `REWORK_OVERRIDES: &[CardDef] = &[]` (its layout header is the contract).
- `mob_runtime.rs`: `EliteTuning { k, hp_mult, dmg_mult }`, `EliteTuning::of(EliteRule) -> &'static EliteTuning`
  (stub NaN), statics `LEGACY_ELITES` / `REWORK_ELITES`. `cards/tuning.rs` statics `LEGACY` / `REWORK` (names fixed
  by the content audit amendment).
- Signatures: `outgoing_damage(tuning, ...)`, `execute_share(tuning, ...)`, `maximum_packet(tuning, weapon)`,
  `checkpoint::valid_ranged_packet(tuning, packet, weapon)` (callers pass `k.cards`; the stub ignores it);
  `checkpoint::check_world` is `pub(crate)`.
- Compile-only `augments: Legacy, elites: Legacy` lines in every full `SimConfig` literal (rh-sim, rh-server,
  rh-headless, rh-load; the stub commit's file list) and `sim.k.cards` in `modifiers/camps_tests.rs`.

## 9. Validation commands
- `export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p rh-sim --features trusted-status-probes --test augment_rules`
- `cargo test -p rh-sim --features trusted-status-probes --lib cards::tuning`
- `cargo test -p rh-sim --features trusted-status-probes --test hash_coverage`
- `cargo test -p rh-server --test live_content`
- `scripts/gate.sh --quick --oracle packet/P-AUG-RULES-1`

## 10. Risk and suggested model tier
Opus: the statics digest and config encoding (a tag collision silently merges two identities), the restore checks
(a wrong envelope refuses live checkpoints or admits forged packets), and a reader left on `CardId::definition()`
(an override then applies to the fold but not to the restore check, or to the hook but not to the fold) are each
invisible while the tables are empty. Cross-crate (rh-sim, rh-server, rh-headless, rh-policy).

## 11. Known traps
- Coordinator amendment (2026-11-19): override rows carry the live card TEXT. The Unity EditMode test
  `client-unity/UnityProject/Assets/Tests/Editor/BuildDrawerEditModeTests.cs:38`
  (`DisplayCatalogExactlyMirrorsRustCardIdsTitlesDescriptionsAndTags`) regex-parses `catalog_data.rs` and demands the
  client's `CardDisplayCatalog` text equal Rust's exactly; the live client will show Rework text, so Rust holds it in
  `rework_overrides.rs` in the same layout. The mirror test is left alone here (the table is empty, so it stays green);
  a later packet amends it to prefer an override's text over `catalog_data.rs`.
- The stat fold has its OWN copies of the G1 and G4 caps (`stat_fold/definition.rs:47, :52`, applied at
  `stat_fold/fold.rs:205-207, :216-218`; legacy `shared/mods.ts:284, :288`), separate from
  `constants::OUTGOING_ROW_CAP` (`modifiers/mod.rs:899-905`) and `HP_RACE_CAP` (`:665`). The plan names only the
  latter; Boom 2.6 needs both, so the table's `outgoing_row_cap` / `hp_race_cap` must reach the fold (e.g.
  `fold_rows_with_definition` with a copy of the default definition carrying the table's caps) in `recompute_core`,
  `Modifiers::valid` and `fold_build`. Do not edit `stat_fold/definition.rs` (content hash).
- Readers beyond the plan's list read card rows and must use `k.cards.def(id)` (each has `k` or `hx.k`): the hooks
  (`on_hit.rs`, `after_damage.rs`, `on_hurt.rs`, `on_overkilled.rs`, `cards/mod.rs` `on_blocked`: Tank Engine's
  fortify `per`/`cap` is a Rework row), `reward_chests/mod.rs:303-309`, `systems/training/console.rs`, and two
  restore bounds, `modifiers/mod.rs:82` (mark rate over every card) and `systems/mob_checkpoint.rs:66` (Hemorrhage's
  bleed `ms`). A row reader left on `CardId::definition()` makes an override half-applied; the empty table hides it.
- `Build::has_flag`, `add`, `valid`, `power` stay on the catalog: the shape guard keeps flags, `unique` and `tier`
  equal, so they cannot differ.
- Gambler: legacy is `roll < CHANCE` up, `roll < 2 * CHANCE` down. Read it as `roll < up` up, `roll < up + down`
  down; `0.15 + 0.15 == 2. * 0.15` exactly in f64, so the legacy draw is unchanged.
- Third Time: legacy `(streak + 1) % 3 == 0` and one extra application (`on_hit.rs:236-245`); `third_time_every` (3)
  and `third_time_extra` (1.0) must reproduce it bit for bit (`1. + unarmed + extra`).
- The ranged envelope today (`maximum_packet`) folds only `cards::SUPPORTED` with `Farm::maximum()`; at maximum farm
  the packet is about 1e30 (a very loose bound). Arcane Overload's AP x1.5 still lifts a real packet above it (Fire
  wand 1.61e30 against 1.12e30 on the stub). Under `Rework` fold every card a player can hold (a per-component maximum
  is safest: Glass Cannon lowers HP); under `Legacy` keep it as it is. A Legacy training world can set Arcane Overload
  by console and would be refused at restore: pre-existing, not this packet; flagged.
- P-AUG-PLANT-1 will scale a ranged packet's raw by `1 + plant_feet_bonus` (legacy `weapons.ts:336-338`); the
  envelope will then need that factor too (that packet's concern, noted for it).
- The two tags: `Rework` must fold a word no other config field writes (`RegenInCombat` docs, `statics.rs:313-326`);
  `augments` and `elites` are adjacent and both `"rework"` in JSON, so their hasher tags must differ from each other
  (e.g. `"augments=rework"`, `"elites=rework"`); the 64-identity test checks it.
- The elite seam must add no `#[serde(skip)]` (the amended skip list allows exactly `MatchStatic::cards`) and no new
  serialized world leaf other than `world.mob_runtime.elites` (the only one the amended `hash_coverage` documents).
  Readers without `k` (`World::faction_spec` and through it `defense`, `paced_faction_spec`, `signature_damage`;
  `point_damage`; `sentenced::npc_pulse`) reach the rule either through the world's `MobRuntime` (installed in every
  world that has mobs, training included: `systems/mobs.rs:70, :157`) as `MobRuntime::elites: EliteRule`, writing
  nothing under `Legacy` (the `CampBuffs` precedent, `mob_runtime.rs:449-470`, `hash.rs:36-40`), set where the
  runtime is built, tied to `k.config.elites` by a `check_world` rule with one refusal test; or by threading the
  table from `k` into those readers (about 20 call sites). The first is the recommended one.
  `spawn_hp` and every `Mob::born` caller hold `k`. rh-policy reads `EliteTuning::of(config.elites)` through the
  start struct that already carries `frost_wish` (`rh-policy/src/lib.rs:78, :95`).
- `Tuning::of` returns statics (no per-call build, no allocation per step).

### Survey: existing tests that pin what this packet touches
- `rh-sim/tests/hash_coverage.rs` `the_serde_skips_are_exactly_the_documented_ones` (`statics.rs` 7 skips): amended
  to 8 (`oracle-amend`). `every_serialized_leaf_of_a_match_changes_the_state_hash`,
  `in_flight_projectile_leaves_are_hashed_or_validated` (packet leaves validated by the envelope),
  `mob_spacing_and_regen_in_combat_are_four_separate_statics_identities`,
  `the_default_spacing_and_regen_still_fold_nothing`, `native29_*`: Legacy worlds only; stay green unchanged.
- `rh-server/tests/live_content.rs`: exhaustive expected live configs; amended to `Rework` (`oracle-amend`).
  `camp_buffs_profile.rs`, `frost_wall_live_room.rs`, `frost_wall_welcome.rs` read single fields; unaffected.
- `rh-sim/tests/content.rs:560-568` `hash_golden` (`GOLDEN_CONTENT_HASH`) and `every_registry_row_perturbs_the_hash`:
  the content hash must not move (no registry row, no `stat_fold::definition` change here).
- `rh-sim/tests/card_catalog.rs` (catalog pinned to the capture, `:326`): `catalog_data.rs` unchanged.
- `rh-sim/tests/reward_pools.rs`: `augment_pool` / `conditional_pool` against the capture; keep the public functions.
- `rh-sim/src/stat_fold/tests.rs:289-291`: the default fold clamps `hit` and `hpRace` at 2.5; keep the default
  definition's caps.
- `rh-sim/src/modifiers/mod.rs` tests (`the_outgoing_row_cap_holds_against_boom_and_glass_cannon`,
  `a_cached_while_hold_is_validated_against_its_bits`, `hp_race_mult` at `:951-954`) and `modifiers/camps_tests.rs`
  (stub-edited for the new `tuning` argument): legacy answers unchanged.
- `rh-sim/src/cards/mod.rs` tests (`wishful_thinking` at `:555-586`) and `abilities/checkpoint.rs:19-45` (the
  Wishful restore bound on `WISHFUL_BUDGET_MS` / `WINDOW_MS`): unchanged under Legacy; P-AUG-TUNE-1's concern.
- `rh-sim/tests/no_alloc.rs`, `cards_no_alloc.rs`, the other `*_no_alloc.rs`: zero allocations per step.
- `rh-sim/tests/checkpoint.rs`, `replay.rs`: Legacy checkpoints and replays restore and verify unchanged.
- `rh-parity` (hash tape `parity/abilities/hash-tape.json`, `tests/schedule.rs`) and the parity report:
  byte-identical; `rh-headless` determinism sweep (stub-edited literal).
- Unity `BuildDrawerEditModeTests.cs:38` (C# mirror of `catalog_data.rs` titles and text): untouched here (empty
  table).

## Notes from previous attempts
- Coordinator amendment 2026-11-19 (before any attempt): overrides carry text; the guard admits row numbers and
  `text` only; the table is one regex-friendly file (sections 1 and 11).
