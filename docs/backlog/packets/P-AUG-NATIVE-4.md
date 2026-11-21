# P-AUG-NATIVE-4: the four faction-only native augments (Corpse Hoarder, Stoked, Glacier, Trophy Hunter), and native pool admission for all three batch tables

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-CARDS-2/3), under the owner's 2026-11-18 approval of the elite and
  augment rework (`docs/OWNER_DECISIONS.md:13`, row "Elite and augment rework": augments "Plus 13 new"; plan of record
  `docs/backlog/AUGMENT_ELITE_REWORK.md`: packet row P-AUG-NATIVE-4 (`:172`), decision 5 (`:77`), Appendix A rows
  Corpse Hoarder (`:388`), Stoked (`:385`), Glacier (`:381`), Trophy Hunter (`:403`), and the coordinator notes
  "The batches, hook readings to confirm" (`:206-214`)). Coordinator decision 2026-11-20 (message to this packet):
  this packet owns wiring `cards::native::pool_members()` into the Rework chest pool for all three tables.
- **Implementer tier:** **implementer-opus recommended** (flag, see section 10). The brief was routed Sonnet, but three
  of the four cards need a stat-fold seam 1b did not provide (native rows into `modifiers::recompute_core`), and the pool
  wiring touches `checkpoint.rs` restore validation and the reward draw pool.
- **Reviewer:** reviewer-opus
- **Integration base:** `feature/unity-rework` @ bb3e37fbf (integration 67: P-AUG-NATIVE-1b, P-WIRE19-A; protocol 19,
  observation 31, content `a03745630efa1c12`).
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10): one numbers test per card through the real hooks,
  the offer rule, a mid-count restore, the native-free digest · D2 n/a · D5/D6/D9 none (no wire change: native ids and
  the readout rows exist already; `observe.rs` untouched).

## 1. ID and outcome

1. **Four cards** (`cards/native/faction.rs`, rows in `cards/native/table.rs`), each unique, held through the real hooks
   of 1b (`cards::native::hooks::fire`), numbers from the registered `REWORK_*` rows (1a; workbook Augment_Tuning):

   | Card (faction) | Hook | Handler | Effect on the holder | Number rows |
   |---|---|---|---|---|
   | Corpse Hoarder (Plague) | `CorpseHarvest` | `counter = min(cap, counter + PER)` | max HP `+counter` of the faction base HP, beside the corpse's own row | `REWORK_CORPSE_HOARDER_PER` 0.03, `_CAP` 0.24 |
   | Stoked (Fire) | `BurstLanded` | `counter = min(cap, counter + PER)` | `+counter` AP (`StatMirrors::ap_bonus`) | `REWORK_STOKED_PER` 2, `_CAP` 30 |
   | Glacier (Frost) | `ChillInflicted { ms }` | `counter = min(cap, counter + PER * ms / 1000)` | `+counter` armor (`StatMirrors::armor_bonus`) | `REWORK_GLACIER_PER` 0.15, `_CAP` 30 |
   | Trophy Hunter (Sentenced) | `HuntStack { stacks }` | `counter = min(cap, counter + PER * stacks)` | `+counter` damage share, in `outgoing_damage` like Marksman's Tally | `REWORK_TROPHY_HUNTER_PER` 0.02, `_CAP` 0.15 |

   Readouts: one row per card, `(card, Counter, counter, rule cap)` (`faction::readouts` -> `[Source::Counter]`).
   `table.rs` rules are already `counter(CAP)` for all four (1a), so no cap row moves.
2. **Two hook readings, decided here and pinned by the oracle** (coordinator note, `AUGMENT_ELITE_REWORK.md:206-211`):
   - **Stoked counts the burst when it is queued**, not when it lands. `fire_roam.rs:204` fires `BurstLanded` right after
     `defer_hit` (`:176`); the burst's own hit reaches the ledger the next tick. A burst whose victim then teleports or
     dies still counts. Pinned: the hook tick is strictly before the tick the burst's `Event::Hit` (`weapon: None`) is
     emitted (measured on the base: it is the tick before).
   - **Glacier counts every chill source, per tick.** `frost.rs:105` (`ranged_hits`) fires `ms = FROST_RANGED_CHILL_MS`
     (1200) once per landed bow or wand hit of a Frost player; `hooks::attack_chill` (`hooks.rs`, called at `frost.rs:293`)
     fires `ms = TICK_MS` (50) once per source in `chillers` each tick the victim's chill is below 1. Two sources
     chilling one victim both pay. Measured on the base: a Frost archer's aura chills a victim 200 u away nearly every
     tick, so a bow test sees ~170 tick hooks beside its 3 ranged ones. The oracle pins
     `counter = PER * (ranged * 1.2 + tick_hooks * 0.05)` against the real trace, not a count it chose.
3. **A native stat seam (the hook 1b did not provide; mark for Opus).** `outgoing_share` (Marksman's Tally) covers Trophy
   Hunter's damage only. Max HP, AP and armor change the stat fold: `modifiers::recompute_core` (`modifiers/mod.rs:285`)
   folds `build.rows` + `combined_farm_rows` and writes `Runtime { sums, farm, max_hp_mult, wire }`; a counter change
   must refold and, for max HP, call `sync_max_hp` (`:564`) without raising current HP beyond the existing rule. Proposal:
   `cards::native::fold_rows(build) -> ([EffectRow; 3], usize)` read in `recompute_core` as extra farm-class rows
   (outside the card caps, like `Farm::rows` corpse stacks, `modifiers/farm.rs:140`: `Stat { MaxHp, v }`; `Stat { Ap }`;
   `Stat { Armor }`) with the card's own cap as the bound; each handler, after changing the counter, calls
   `modifiers::recompute` and `sync_max_hp` for its holder. The oracle pins the observable only (mirror and max HP after the
   tick of the event; restore). `CombinedFarm.rows` is a `[EffectRow; 36]` scratch: check it still fits. Allocation-free.
4. **Pool admission for all three tables** (coordinator decision; P-AUG-NATIVE-2 and -3 do not touch pools).
   `Tuning::pool()` and `REWORK_POOL` stay the catalog's 19 (P-AUG-POOL-1's tests pin them: `pool_tests.rs:128`). New:
   `Tuning::in_pool(id)` (stubbed in `cards/tuning.rs`): a catalog card of `pool`, or under Rework a native listed by
   `native::pool_members()`. Route through it:
   - `Tuning::augment_pool` (`tuning.rs:217`): after the catalog walk, append the Rework natives (native order) that are
     `ready`, augments and not held by every picker (`held_by_all`); under Legacy nothing is appended (draws byte-identical);
   - `Tuning::offer` (`:248`): `Offer` of a native from `pool_members()` (its table's `Offer`); `faction_only` stays the
     test-only seam (`for_test_pool`);
   - `Tuning::offer_pool` (`:264`): the `retain` runs when `faction_only` is non-empty OR the pool holds a native `Offer::Faction`;
     the faction rule is `Offer::admits` (`reward_chests/pools.rs:68`);
   - `reward_chests::validate_world` (`reward_chests/mod.rs:457`, `pool.contains` at `:498`) and its one caller
     `checkpoint.rs:663` (`k.cards.pool()`): take the tuning (or a predicate) so a Rework camp chest offering a native
     restores; Legacy still refuses;
   - `systems/training/console.rs:71` (`tuning.pool().contains`): use `in_pool` so the practice console rolls and grants
     natives (optional; list it in the hand-off either way).
   Draw protocol unchanged: `roll_with` still makes one tier draw and one index draw per pick over the offered pool; the
   pool is simply longer under Rework. **Rework chest outcomes move** (new cards in the pool); Legacy and a Rework world
   with no chest drop do not.
5. **Faction rule (decision 5)**: a faction-only native is offered only when every eligible picker at the chest is that
   faction (`Offer::Faction(f)`; no picker -> no faction card). `faction::POOL` lists the four with their factions:
   Corpse Hoarder `Plague`, Stoked `Fire`, Glacier `Frost`, Trophy Hunter `Sentenced`. Never under Legacy.
6. **Exact `check` rule per card** (1b guide: "each batch adds its card's exact rule"): the four counters are non-integral
   shares, so nothing to tie to marks; `meters` and `marks` stay 0. If the stat seam adds a bound on a counter (state outside
   its cap is already refused by `native::check`), no new rule is needed; say so in the hand-off. A restore of a state whose
   folded stats disagree with its counter must not be possible: the folded `modifiers` are recomputed on restore, so the
   hash-exact restore test is the guard.
7. **Content hash** moves once (the four cards' `POOL` rows are not hashed; their `NativeRule`s already are; if the
   implementer adds rows to `table.rs` definitions they are), through `scripts/regolden-content.sh` only. No format bump:
   `CHECKPOINT_FORMAT`, `REPLAY_FORMAT`, `OBSERVATION_VERSION`, `PROTOCOL_VERSION` stay.
8. **Guide**: `docs/agent/AUGMENT_REWORK.md` section "Native hooks and batch tables": the admission paragraph ("Admission
   waits for P-WIRE19-A") becomes the pool rule of section 4 above; add the Stoked and Glacier readings and the stat seam.

## 2. Dependencies
- P-AUG-NATIVE-1b and P-WIRE19-A (both in the base).
- Runs beside P-AUG-NATIVE-2 (`weapon.rs`), P-AUG-NATIVE-3 (`zone.rs`), P-WIRE19-B (`observe.rs`, protocol). Keep out of their
  files. NATIVE-2/3 add their cards' `POOL` rows to their own tables only; this packet's reader picks them up.
- Merge order note for the coordinator: this packet changes Rework chest draws; NATIVE-2/3 oracles that roll Rework chests
  (none known) would see the longer pool.

## 3. Relevant legacy paths
The four cards are new (no legacy implementation); legacy the hooks sit beside, verified with `rg`:
- Corpse harvest: `packages/server/src/sim/plagueCorpses.ts` (the base corpse row; Rust `systems/plague_corpses.rs:106-129`,
  `farm.set_corpse_stacks` then `recompute` + `sync_max_hp` at `:107-111`, hook at `:124`).
- Fire roam burst: `packages/server/src/sim/fireRoam.ts` `hitLanded` (Rust `systems/fire_roam.rs:136-209`: the burst is a
  derived `defer_hit` entry consumed by the next tick's ledger; `burst_damage` uses bonus AD, `:41`).
- Frost chill: `packages/server/src/sim/factions.ts` (Frost chill; the ranged chill and the aura) (Rust `systems/frost.rs:88-110` `ranged_hits`,
  `:293` `attack_chill`).
- Sentenced hunt: `packages/server/src/sim/sentencedHunt.ts` (Rust `systems/sentenced_hunt.rs:106-151`, `hunt_stacks`
  saturating add at `:137`; `HuntStack { stacks }` is 0 when already at 255).
- Workbook `docs/quests/FUTURE_ONLY_Quest_Design_Discussion.xlsx` Augment_Tuning (plan copy `AUGMENT_ELITE_REWORK.md:381-403`).
- Same-tick notes: corpse harvest runs in the action-ordered `plague_corpses::system` (shuffled order, one winner per
  corpse); the hook fires after the corpse's own row folded. The hunt hook fires inside `fighter_out` for each hunter of
  the dead fighter, in player order. No RNG draw anywhere in these hooks. Death mid-action: a holder who dies on the tick
  keeps its counter (state is the build's; run end clears builds as before).

## 4. New paths
- `crates/rh-sim/src/cards/native/faction_tests.rs` (oracle), `crates/rh-sim/src/reward_chests/native_pool_tests.rs` (oracle).

## 5. Exclusive write scope (implementer)
- `crates/rh-sim/src/cards/native/faction.rs` (the table: `POOL`, `handle`, `readouts`, the fold-row and share seams).
- `crates/rh-sim/src/cards/native/mod.rs` only for the seam entry points (`outgoing_share` adding Trophy Hunter,
  `fold_rows`); `crates/rh-sim/src/cards/native/table.rs` only if a definition/rule row needs a change (exact `check` words).
- `crates/rh-sim/src/modifiers/mod.rs` (`recompute_core` reads the native rows; max HP sync) and `modifiers/farm.rs`
  only if the seam reuses its row type.
- `crates/rh-sim/src/cards/tuning.rs` (`in_pool`, `augment_pool`, `offer`, `offer_pool`), `crates/rh-sim/src/reward_chests/pools.rs`
  (helpers, the `Offer` rule if changed), `crates/rh-sim/src/reward_chests/mod.rs` (`validate_world`), `crates/rh-sim/src/checkpoint.rs`
  (the one `validate_world` call at `:663`), `crates/rh-sim/src/systems/training/console.rs:71` (optional).
- The hook call sites' handlers only through `faction.rs`; the 1b call sites (`fire_roam.rs`, `frost.rs`, `plague_corpses.rs`,
  `sentenced_hunt.rs`) stay unless a fix of the readings above is needed (then say why).
- `crates/rh-sim/src/constants.rs` appended `REWORK_*` rows only if a number is missing (none expected).
- `crates/rh-sim/tests/content.rs` entries; the content-hash copies through `scripts/regolden-content.sh` only.
- `docs/agent/AUGMENT_REWORK.md` (guide paragraph, section 1.8).
Not in scope: `weapon.rs`, `zone.rs`, `observe.rs`, protocol and decoders, `schedule.rs`, `Cargo.lock`, `docs/MIGRATION.md`.

## 6. Contracts and references
C-TICK (no schedule row, no reorder), C-RNG (no draw), C-OBS (readouts own-only: the 1b producer), C-DET (every counter is
already hashed and checkpointed: 1a slots), C-PARITY (existing fixtures green; Legacy byte-identical). ADR 0007.

## 7. Behaviour to preserve
- A Legacy world and a Rework world where nobody holds a native card: state hashes, events and checkpoint text unchanged
  (`hooks_tests::a_rework_world_without_native_cards_plays_as_on_the_base`, existing digest, stays green: it has no chest drop).
- Legacy chest draws: `pool_tests::legacy_offers_and_draws_are_the_integration_heads` stays green (the FNV pin).
- The 19-card `REWORK_POOL` and every `pool_tests.rs` expectation on it.
- `tests/no_alloc.rs`, `native_no_alloc.rs`, `hash_coverage.rs`.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-AUG-NATIVE-4` passes (`--base feature/unity-rework`).
- Oracle tests below green; the existing tests of the next section green except the two amended ones (below).
- Other existing tests that roll Rework chests may move because the Rework pool is longer; an implementer reports any
  such red test to the coordinator rather than editing it (none found by the oracle author: only the two amended ones were
  identified by reading; the full suite was not run on a wired pool).

## Existing tests that pin what this packet changes
| Test | Asserts | Status |
|---|---|---|
| `cards/native/hooks_tests.rs` `the_batch_tables_hold_their_own_cards` (was `..._and_no_pool_offers_them_yet`) | tables hold only their own cards, faction table is `Offer::Faction`, Tally and Bastion are `Any`; its last block asserted no pool, `offer` or `offer_pool` reads natives | **amended** (`oracle-amend:` commit): the "nothing reads yet" block removed, name shortened; replaced by `native_pool_tests` |
| `tests/native_cards.rs` `no_pool_holds_a_native_card_and_only_a_rework_chest_may_offer_one` | first loop: every id in `pool()`, `augment_pool`, `conditional_pool` is < 80 under both rules; then chest restore rules (unchanged, from WIRE19-A) | **amended** (`oracle-amend:`): under Rework an id >= 80 must be a `pool_members()` row |
| `reward_chests/pool_tests.rs` `the_rework_pool_is_interactive_plus_five...` | `Tuning::pool()` == `REWORK_POOL`, every pool id < 80, `offer(id) == Any` for the 19 | unchanged (this is why `pool()` stays the catalog's and `in_pool` is new) |
| `pool_tests.rs` `a_rework_chest_without_a_source_is_the_plain_roll_over_the_offer_pool` | chest draws equal `roll_with` over `offer_pool` | unchanged, self-consistent with a longer pool |
| `pool_tests.rs` `legacy_offers_and_draws_are_the_integration_heads` | Legacy draws FNV-pinned | unchanged: the Legacy pool gets nothing |
| `pool_tests.rs` `check_world_refuses_a_camp_chest_card_outside_the_rules_pool` | Rework-only card refused in Legacy; non-pool card refused in Rework | unchanged |
| `hooks_tests.rs` `a_rework_world_without_native_cards_plays_as_on_the_base` | native-free Rework digest (hashes, events, checkpoint text) | unchanged, must stay green (the "native-free Rework digest" the brief names) |
| `tests/native_cards.rs` `the_native_numbers_are_the_workbooks_registered_rows_and_the_caps_read_them` | the registered rows and caps | unchanged |
| `tests/content.rs` | content-hash and registry guards | regolden through the script |

**For the owner (oracle-amend):** the two amendments above remove "no pool offers a native card yet", which the 1b and
1a oracles pinned only until admission; WIRE19-A's packet (section 1.5) said the first batch to need natives offered flips
the switch. No expectation about numbers or draws changes.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/cards/native/faction_tests.rs` (new; `#[cfg(test)] mod faction_tests;` is in the stub commit)
- `crates/rh-sim/src/reward_chests/native_pool_tests.rs` (new; mod line in the stub commit)
- `crates/rh-sim/src/cards/native/hooks_tests.rs` (amended, `oracle-amend:` commit)
- `crates/rh-sim/tests/native_cards.rs` (amended, `oracle-amend:` commit)

Red tests on the stub (each fails on an assertion):
- `faction_tests::corpse_hoarder_adds_three_percent_max_hp_per_corpse_up_to_its_cap`: counter stays 0 (the hook fires: one `CorpseHarvest`).
- `faction_tests::stoked_adds_two_ap_per_burst_counted_when_the_burst_is_queued`: counter 0 vs 2 (the readings `queued < landed` and one burst hit already hold).
- `faction_tests::glacier_earns_armor_per_ranged_chill_second_and_the_armor_shows`: counter 0 vs per*(3*1.2 + tick hooks*0.05) (hook count already 3 ranged + ~170 tick).
- `faction_tests::glacier_earns_one_tick_of_chill_per_tick_while_the_victims_chill_is_below_one`: counter 0 vs 1.2 from 160 tick hooks.
- `faction_tests::trophy_hunter_earns_two_percent_per_hunt_stack_up_to_its_cap`: counter 0 vs 0.02 (hunt completes, one `HuntStack`).
- `faction_tests::trophy_hunter_share_multiplies_the_holders_hits`: ratio 1.0 vs 1.15 (the card is held in both arms: `power()` counts its tier into the PvP factor; comparing held-vs-not gives 1.44).
- `faction_tests::readouts_show_each_faction_card_as_a_counter_to_its_owner_only`: no rows vs the counter row.
- `faction_tests::a_checkpoint_mid_count_restores_hash_exact_and_plays_on`: restore and replay are exact on the stub; red at the end ("the harvest happened mid-run": counters do not move).
- `native_pool_tests::the_rework_chest_pool_holds_every_batch_table_row_with_its_offer_rule`: Marksman's Tally not in the Rework chest pool.
- `native_pool_tests::a_faction_native_is_offered_only_to_an_all_that_faction_chest_and_legacy_offers_none`: own faction card in 0 of 400 chests.
- `native_pool_tests::a_rework_camp_chest_with_native_cards_restores_and_a_legacy_one_is_refused`: restore refuses "invalid reward chest".
- `native_pool_tests::a_native_card_picked_from_a_rework_chest_feeds_its_hook`: Corpse Hoarder offered on 0 of 40 seeds (end to end: real drop, real `Choose`, then a corpse harvest moves the counter).

## 9. Validation commands
`~/.cargo/bin/cargo test -p rh-sim --lib -- faction_tests native_pool_tests`; `scripts/gate.sh --quick --oracle packet/P-AUG-NATIVE-4`
(`--base feature/unity-rework`); `scripts/regolden-content.sh` for the content-hash copies. The card provenance pin of
`tools/protocol-js/check-vectors.mjs` is red on the base and waived.

## 10. Risk and suggested model tier
Opus recommended. Hard parts: (a) the stat seam inside `recompute_core` (max HP sync must not heal; the folded stats must
come back identical after restore); (b) the longer Rework pool changes chest outcomes, so any Rework test that pins a
specific chest roll may move; (c) Glacier fires ~20 hooks per second per attacking Frost holder (cheap, but the stat refold
per tick must not allocate: refold only when the counter changed, i.e. not at the cap). If the coordinator keeps Sonnet, split:
the four handlers plus readouts (`faction.rs`) first, the stat seam and pool wiring as Opus work.

## 11. Known traps
- Max HP: `sync_max_hp` raises current HP by the delta; the corpse harvest sets `hp = hp_before.min(max)` after its own sync
  (`plague_corpses.rs:109-111`). The oracle compares max HP of a holder and a control after the harvest tick only.
- `power()` counts native tiers into `pvp_factor`: any damage comparison must hold the card in both arms (the oracle does).
- Stoked: `fire_roam.rs` only arms the burst when `roam.ready` at the attack's start, and only under
  `FactionMode::..FireRoam`; the oracle sets `roam.ready` directly and uses that mode.
- Glacier's per-tick hook: each source of `chillers` pays once per tick; the sword-adjacent holder in the oracle sees 160 hooks in 160 ticks.
- Trophy Hunter at 255 stacks: `HuntStack { stacks: 0 }` adds nothing.
- Pool order: natives are appended after the catalog walk in native order; `roll_with` draws by index, so the order is behaviour.
- A Plague corpse of a living player is refused by `check_world` ("invalid Plague corpse state"): tests create corpses with
  `settle::down_player`, never by pushing for a live player across a checkpoint.

## Notes from previous attempts
<!-- Coordinator appends on escalation. -->
