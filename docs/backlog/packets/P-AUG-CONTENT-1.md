# P-AUG-CONTENT-1: the Augment_Tuning numbers and text as hashed `REWORK_*` rows, live-world only (content move 1)

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-CARDS-2/3, P-MOBS-2), under the owner's 2026-11-18 approval of the
  elite and augment rework (`docs/OWNER_DECISIONS.md` row "Elite and augment rework", 2026-11-18; plan of record
  `docs/backlog/AUGMENT_ELITE_REWORK.md`, Appendix A and "Decisions taken" 2, 4 and 7)
- **Implementer tier:** implementer-sonnet (data in two hand-written tables plus the documented regold command; no tick,
  RNG or state change)
- **Reviewer:** reviewer (Sonnet); every integration merge also gets reviewer-opus
- **Integration base:** feature/unity-rework (the oracle branch is cut from `8aa2dbf59`, the P-AUG-RULES-1 merge on top of
  the regold command)
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10): one oracle file shows each number is the Appendix A
  number and each is read; existing parity fixtures and `card_catalog` stay green (the default world is `Legacy`) · D2 n/a ·
  D5/D6/D9 none

## 1. ID and outcome
Under `SimConfig::augments = Rework` (the live world, `live_content()`), 18 cards play the Augment_Tuning numbers and show
the Augment_Tuning text; under `Legacy` nothing changes. Every changed number is a hashed `crate::constants` registry row
named `REWORK_*`, appended at the end of the `content!` block in the order below, and the override rows
(`crates/rh-sim/src/cards/rework_overrides.rs`) and the `REWORK` `CardNumbers` (`cards/tuning.rs`) name those constants, so
`content_hash` covers them (content move 1 of 3). Registry rows, in order (value; the card):

| Row | Value | Used by |
|---|---|---|
| `REWORK_TANK_ENGINE_PER` | 1.5 | Tank Engine `Fortify.per` |
| `REWORK_TANK_ENGINE_CAP` | 350 | Tank Engine `Fortify.cap` |
| `REWORK_PLANT_FEET_BONUS` | 0.35 | `CardNumbers::plant_feet_bonus` (Plant Your Feet; the range part is P-AUG-PLANT-1) |
| `REWORK_SLOW_BURN_DOT` | 0.85 | Slow Burn `Mult Dot` (-15% per second after break-off) |
| `REWORK_POCKET_SAND_SLOW` | 0.4 | Pocket Sand `Status.value` |
| `REWORK_POCKET_SAND_MS` | 1500 | Pocket Sand `Status.ms` |
| `REWORK_OVERKILL_RADIUS` | 260 | Overkill `Splash.radius` |
| `REWORK_THIRD_TIME_EXTRA` | 1.5 | `CardNumbers::third_time_extra` (every 3rd hit: 1 + 1.5 = 2.5x on-hit effects); `third_time_every` stays the literal 3 |
| `REWORK_SPIKED_SHELL_SHARE` | 0.2 | Spiked Shell `Return.share` |
| `REWORK_SIPHON_SHARE` | 0.25 | Siphon `Stat LifestealDot` |
| `REWORK_HEMORRHAGE_PER` | 0.12 | Hemorrhage `OnHit.per` |
| `REWORK_SECOND_WIND_BELOW` | 0.3 | Second Wind trigger `arg` |
| `REWORK_SECOND_WIND_HEAL` | 0.25 | Second Wind `Heal.share` |
| `REWORK_GAMBLER_UP_CHANCE` | 0.18 | `CardNumbers::gambler_up_chance` (decision 4) |
| `REWORK_GAMBLER_DOWN_CHANCE` | 0.12 | `CardNumbers::gambler_down_chance` |
| `REWORK_COMMITTED_DAMAGE` | 0.22 | Committed `Stat Damage` (the +15% speed stays) |
| `REWORK_GLASS_CANNON_MAX_HP` | -0.22 | Glass Cannon `Stat MaxHp` |
| `REWORK_MACHINE_GUN_HIT` | 0.55 | Machine Gun `Mult Hit` |
| `REWORK_FISTS_ATTACK_SPEED` | 0.5 | Fists of Fury `While` row `v` |
| `REWORK_BOOM_HIT` | 2.6 | Here Comes the Boom `Mult Hit` |
| `REWORK_OUTGOING_ROW_CAP` | 2.6 | `CardNumbers::outgoing_row_cap` (decision 2: both cap sites, the fold's `hit` clamp and the outgoing row ceiling) |
| `REWORK_VAMPIRIC_LIFESTEAL` | 0.18 | Vampiric Pact `Stat Lifesteal` |
| `REWORK_ARCANE_OVERLOAD_WISH_COOLDOWN` | 1.5 | Arcane Overload `Mult WishCooldown` |
| `REWORK_ELITE_SHARE_STACKS` | 12 (`u32`, unit "stacks") | nothing yet: P-ELITE-SHARE-1 reads it (decision 7) |

(All `f64` and unit "x" / "share" / "chance" / "u" / "ms" as fits, except the last.) `HP_RACE_CAP` and A Race to 0 do not
change. Not here: Wishful Thinking (P-AUG-TUNE-1: percent rule, and its text), Best Offense and Eye for an Eye (later
packets). Third Time's pips and Plant's range are later packets.

Each of the 18 override rows carries the card's Rework `text`, EXACTLY the description string in
`client-unity/UnityProject/Assets/Scripts/UI/CardDisplayCatalog.cs` on `agent/sonnet/P-AUG-UI-1` (commit `b2fc08016`);
the oracle repeats the 18 strings. The 18 are: Here Comes the Boom, Machine Gun, Glass Cannon, Vampiric Pact, Arcane
Overload, Committed, Slow Burn, Fists of Fury, Overkill, Tank Engine, Pocket Sand, Gambler, Third Time's the Charm, Plant
Your Feet, Hemorrhage, Spiked Shell, Siphon, Second Wind (in `CardId` order in the file).

Then run `scripts/regolden-content.sh` (content move 1): see section 9.

## 2. Dependencies
P-AUG-RULES-1 (the seam, merged in `8aa2dbf59`) and P-CONTENT-REGOLDEN-1 (`scripts/regolden-content.sh`, merged). It merges
in the same integration as P-AUG-UI-1 (parked; the C# mirror test below only passes once both are in).

## 3. Relevant legacy paths
The rework numbers are new design (Augment_Tuning, owner-approved 2026-11-18), not legacy. The legacy numbers they replace,
which `Legacy` worlds must keep (verified with `rg`; the catalog rows are `crates/rh-sim/src/cards/catalog_data.rs`, pinned
to the capture by `tests/card_catalog.rs`):
- `packages/shared/src/constants.ts:242` `OUTGOING_ROW_CAP = 2.5`, `:276` `PLANT_FEET_BONUS = 0.25`, `:286` `GAMBLER_CHANCE
  = 0.15` (read as up `< C`, down `< 2C`, `packages/server/src/sim/cardState.ts:99-105`), `:291` `TANK_ENGINE_CAP = 250`.
- `packages/server/src/sim/onHit.ts:39` (Third Time: `% 3`, `n++`).
- Card rows: `packages/shared/src/cards.ts:308` (Tank Engine), `:315` (Pocket Sand), `:416` (Spiked Shell), `:446` (Second
  Wind); the others by `catalog_data.rs`: Boom `:648`, Machine Gun `:668`, Glass Cannon `:686`, Vampiric Pact `:722`,
  Arcane Overload `:740`, Committed `:758`, Slow Burn `:777`, Fists `:795`, Overkill `:813`, Tank Engine `:830`, Pocket
  Sand `:847`, Gambler `:864`, Third Time `:1005`, Plant `:1107`, Hemorrhage `:1141`, Spiked Shell `:1175`, Siphon
  `:1226`, Second Wind `:1277`.
- Same-tick and tick-boundary notes: nothing here is new timing. The rows are read where the seam already reads them
  (fold, hooks, ledger): Tank Engine and Pocket Sand in `on_blocked` (`cards/mod.rs:405-490`, rows from `hx.k.cards`);
  Gambler's coin is the one salted draw per ledger entry (`cards/mod.rs:126-136`; no RNG stream draw, order unchanged);
  Third Time in `cards/on_hit.rs:236-248`. An empty or full inventory is not special (a card is held or not).

Legacy doubts (flag, do not fix; a behaviour fix is its own packet):
- Second Wind's heal runs `ms: Some(2000.0)` while its text (legacy and rework) says "over 1.5 s".
- Tank Engine's +350 cap has no `check_world` rule (legacy +250 has none either; P-AUG-NATIVE-1a adds the missing cap rule).
- "Plant Your Feet: +35% range and damage": only the damage half exists until P-AUG-PLANT-1.

## 4. New paths
- `crates/rh-sim/src/cards/rework_content_tests.rs` (the oracle; wired by one `mod` line in `cards/tuning.rs`, stub).
- `docs/backlog/packets/P-AUG-CONTENT-1.md` (this file).

## 5. Exclusive write scope
- `crates/rh-sim/src/constants.rs`: append the `REWORK_*` rows above at the end of the `content!` block, in that order
  (never reorder or edit an existing row).
- `crates/rh-sim/src/cards/rework_overrides.rs`: the 18 override rows, each copied from `catalog_data.rs` in the same field
  layout, rows in `CardId` order, row numbers `v: crate::constants::REWORK_...`, text from the UI-1 branch. `use` lines for
  what the rows need are allowed.
- `crates/rh-sim/src/cards/tuning.rs`: the `REWORK` table's numbers only (the `LEGACY` table and the logic stay).
- The six pinned hash copies, only through `scripts/regolden-content.sh`: `crates/rh-sim/tests/content.rs`
  (`GOLDEN_CONTENT_HASH`), `tools/unity-browser-reload-proof/check.mjs`, `tools/unity-browser-reload-proof/normal-companion.mjs`,
  `client-unity/UnityProject/Assets/Scripts/BakedContent.cs`, `parity/abilities/hash-tape.json`,
  `protocol/fixtures/archetypes_v1.json`.
- Not in scope: `catalog_data.rs` / `catalog.rs`, `stat_fold/definition.rs`, `content.rs` (the override table is NOT folded
  into the hash by a visit function: its numbers are registry rows, which are, and its other fields are guarded equal),
  `reward_chests/pools.rs`, any reader, `Cargo.lock`, `CardDisplayCatalog.cs` (P-AUG-UI-1), `packages/**`.

## 6. Contracts and references
- C-PARITY (the default world is `Legacy`), C-DET (no draw, no tick change), `docs/agent/AUGMENT_REWORK.md` ("Adding an
  override row", "Changing a named number", "Moving the content hash").
- Plan decisions: 1 (live-only), 2 (cap 2.6), 4 (Gambler 18/12), 7 (12 stacks), 10 (hash move 1 of 3).

## 7. Behaviour to preserve
- Every `Legacy` world: statics digest, state hashes, checkpoints, replays, events, `CardId::definition()`, the catalog
  (`tests/card_catalog.rs` unchanged and green), the public pool functions (`tests/reward_pools.rs`).
- Under `Rework`: every card not in the list of 18 (Wishful Thinking, A Race to 0, Best Offense, Eye for an Eye and the
  rest), `hp_race_cap`, Wishful's budget, window and floor, `third_time_every`, `pool()` (still `INTERACTIVE`).
- A `Rework` checkpoint with the fold cards and a ranged packet in flight still restores
  (`tests/augment_rules.rs`, section 4: this is the check that the envelope and the cached-fold check read the new rows).
- The parity report, schedule and the determinism sweep: unchanged (the default world never reads a rework row).
- `Cargo.lock` unchanged.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-AUG-CONTENT-1 --allow-artefacts` (BakedContent.cs changes; add
  `--regen-fixtures` if the gate asks, see section 9); the coordinator's full gate on the merge.
- Oracle green (below); `tests/content.rs` green (registry well formed, every row perturbs the hash, stray-const audit,
  `hash_golden` at the regolded value); `tests/card_catalog.rs`, `tests/reward_pools.rs`, `tuning_tests.rs` unchanged and
  green; `parity-report` MATCH unchanged.
- The C# mirror test (`BuildDrawerEditModeTests`, `DisplayCatalogExactlyMirrorsRustCardIdsTitlesDescriptionsAndTags`) is
  green when this packet and P-AUG-UI-1 are in the same tree. Unity cannot run it in a Rust worktree: say so in the hand-off.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/cards/rework_content_tests.rs` (new; `oracle:` commit): 8 tests.
  - `rework_overrides_carry_the_augment_tuning_rows_and_text`: the 18 override rows equal the Appendix A rows written out in
    full, the text equals the UI-1 catalog string, each differs from the legacy row and text, and the guard passes.
  - `rework_named_numbers_are_the_augment_tuning_numbers`: plant 0.35, gambler 0.18/0.12, third time 1 + 1.5, cap 2.6 in
    `numbers()` and in `fold_definition()`; Race cap and Wishful numbers unchanged.
  - `every_changed_number_is_a_hashed_rework_registry_row`: every row above is registered with its value, the
    `REWORK_*` rows are the end of the registry in order, `REWORK_ELITE_SHARE_STACKS` = 12 (`u32`), and the table numbers
    equal the rows.
  - `legacy_is_unchanged_and_unlisted_cards_keep_their_catalog_rows`.
  - Behaviour: `tank_engine_earns_one_and_a_half_hp_per_blocked_point_up_to_350`,
    `pocket_sand_slows_the_attacker_forty_percent_for_one_and_a_half_seconds`,
    `gambler_doubles_about_eighteen_percent_and_halves_about_twelve` (20000 entries, 1.5 points; tells 18/12 from 15/15),
    `the_fold_reads_the_rework_numbers` (Committed row 1.22, Boom fold and outgoing row 2.6 vs 2.5, Machine Gun 0.55,
    Glass Cannon max health ratio, Arcane Overload 1.5 vs 2.0): each as Rework vs Legacy worlds.
- `crates/rh-sim/tests/augment_rules.rs` (amended, `oracle-amend:`; items 1 and 2 below)
- `client-unity/UnityProject/Assets/Tests/Editor/BuildDrawerEditModeTests.cs` (amended, `oracle-amend:`; item 3 below)
- `docs/backlog/packets/P-AUG-CONTENT-1.md` (this packet)
- `crates/rh-sim/src/cards/tuning.rs`: ONE `mod` line (`#[path = "rework_content_tests.rs"] mod rework_content_tests;`) is in
  the `stub:` commit, not an oracle edit. (The new file is added in the `oracle:` commit, so the `stub:` commit alone does
  not build its tests.)

Oracle amendments (`oracle-amend:` commits; each changes an existing test by design, for the owner to approve):
1. `crates/rh-sim/tests/augment_rules.rs`, `the_card_table_is_the_legacy_catalog_under_both_rules` (renamed
   `..._under_legacy_and_for_unchanged_cards_under_rework`): asserted every card equal to the catalog and every named
   number equal to the legacy constant under BOTH rules. Now: all of it under `Legacy`; under `Rework` only the cards
   outside the 18 (the 18 must differ), the numbers this packet does not move, the pool, and the cap (2.6 and the fold's G1
   clamp). Keeps the Legacy guarantee.
2. `crates/rh-sim/tests/augment_rules.rs`, `legacy_and_empty_rework_play_the_same_match` (renamed
   `legacy_and_equal_elite_rework_play_the_same_match`): asserted the same match under (Legacy, Legacy) and (Rework,
   Rework) over seeds 11-13 with fold cards. Now the pair is (augments Legacy, elites Legacy) vs (augments Legacy, elites
   Rework): the elite part stays (elite table equals legacy until P-ELITE-TUNE-1), and the config check says augments is
   absent. The augment half is covered by the new oracle and by section 4 of the same file.
3. `client-unity/UnityProject/Assets/Tests/Editor/BuildDrawerEditModeTests.cs`,
   `DisplayCatalogExactlyMirrorsRustCardIdsTitlesDescriptionsAndTags` (line 38): compared `CardDisplayCatalog` with
   `catalog_data.rs` only. Now it reads `rework_overrides.rs` with the same regex (same layout) and compares the override
   text and tags for an overridden id, `catalog_data.rs` otherwise; it also asserts every override id is a real `CardId`.
   Passes today (empty table, legacy text) and with this packet plus P-AUG-UI-1; it fails on a tree with UI-1 and an
   unfilled table, as intended. Not run here (Unity).

No test pinned the override table as empty except prose: `crates/rh-sim/tests/content.rs` NON_GAMEPLAY entry
`("cards/rework_overrides.rs", "REWORK_OVERRIDES", "... EMPTY here ...")` still passes (the entry only needs a non-empty
reason and a matching declaration); its wording is stale and `scripts/regolden-content.sh` edits that file, so a prose fix
is left to a later docs packet (flagged, not amended).

## 9. Validation commands
- `export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p rh-sim --lib rework_content`, then
  `cargo test -p rh-sim --test augment_rules --test content --test card_catalog --test reward_pools`, then
  `cargo test -p rh-sim --lib tuning`.
- `scripts/regolden-content.sh` (after the rows exist and the tests pass; `--dry-run` / `--check` first if unsure). It
  rewrites the four text copies, then runs two documented commands that rewrite PROTECTED fixtures:
  `cargo test -p rh-sim --lib record_ability_hash_tape -- --ignored` (rewrites `parity/abilities/hash-tape.json`, line 258
  `contentHash`) and `cargo run -p rh-parity --bin hitbox-fixtures` (rewrites `protocol/fixtures/archetypes_v1.json`, line
  300 `contentHash`). This packet says so: those two files are expected to change, only by the hash. The gate's protected
  path check wants `--regen-fixtures` for them; BakedContent.cs wants `--allow-artefacts`.
- Checked here: `hitbox-fixtures` also writes `pathfinding_v2.json` and `server_walk_v2.json`; neither contains the content
  hash (grep) and both run the default (Legacy) world, so they must come out byte-identical. After the script,
  `git diff --stat` must show exactly the six hash copies plus the files of section 5; anything else is a stop.
- Content audit: it does not require a registry row to be read (the audit scans consts for registered-or-explained and a
  perturbation test bumps every row), so the unread `REWORK_ELITE_SHARE_STACKS` passes as is. A second declaration of any
  `REWORK_*` name outside `constants.rs` fails it (`a_second_declaration...`): use the constants by path.

## 10. Risk and suggested model tier
Sonnet: two tables of data, one documented command, no logic. Risks: a typo in a row number (the oracle writes every row
in full), text drift from UI-1 (the oracle repeats the 18 strings and the C# test compares the file), the shape guard
refusing a row (it runs in every debug `Rework` build), and hash-tape churn beyond `contentHash` (stop and escalate).

## 11. Known traps
- Rows are in `CardId` order and in the `catalog_data.rs` layout (one field per line; the C# regex depends on it).
  `title`, `tags`, `kind`, `tier` are unchanged (the guard).
- Gambler and Third Time and Plant have no row numbers (a flag): their numbers are the `CardNumbers` fields; their override
  rows change `text` only. Plant's text says "range" and the range part is not ported: say so in the hand-off, do not fix.
- Here Comes the Boom needs BOTH `REWORK_BOOM_HIT` and `REWORK_OUTGOING_ROW_CAP`; with the legacy 2.5 cap the fold clamps
  the 2.6 back to 2.5.
- `REWORK_GLASS_CANNON_MAX_HP` is negative; the registry accepts it (finite).
- Third Time: `third_time_extra` is the EXTRA applications (1.5), not the multiplier (2.5).
- Wishful Thinking's text: the UI-1 branch already shows the TUNE-1 text for it ("1.5% of its full length (at most 20% a
  minute)"). This packet leaves Wishful's override row out (behaviour is P-AUG-TUNE-1's), so the C# mirror test cannot pass
  with UI-1's Wishful string until TUNE-1 lands. FLAGGED FOR THE COORDINATOR: either UI-1 reverts its Wishful line, or TUNE-1
  merges in the same integration; this packet does not add a text-only Wishful row (it would describe a rule the sim does
  not play).

## Proposed DEVIATIONS row (owner to sign; not edited here)
Category: balance (intentional difference from legacy, live world only). "DEV-<n>: the Rework augment numbers. Under
`SimConfig::augments = Rework` (live) 18 augments play the Augment_Tuning numbers (Tank Engine 1.5 HP per point, cap +350;
Plant Your Feet +35%; Slow Burn -15% per second; Pocket Sand 40% for 1.5 s; Overkill 260 u; Third Time 2.5x; Spiked Shell
20%; Siphon 25%; Hemorrhage 12%; Second Wind 25% below 30%; Gambler 18% double / 12% half; Committed +22%; Glass Cannon
-22% max health; Machine Gun 55%; Fists of Fury +50% attack speed; Boom 2.6x with the outgoing cap 2.6; Vampiric Pact
+18%; Arcane Overload Wish cooldown x1.5). Default, headless and parity worlds keep legacy. Re-validation: the
workbook's Augment_Value model (`docs/quests/FUTURE_ONLY_Quest_Design_Discussion.xlsx`, sheet Augment_Tuning) and
`rework_content_tests.rs`; playtests will move the values (each is one registry row)."

## Notes from previous attempts
<!-- Coordinator appends on escalation: tier, branch, the gate's failure block. Nothing else. -->
