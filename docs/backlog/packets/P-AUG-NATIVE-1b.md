# P-AUG-NATIVE-1b: native hook points, batch tables, own-only readouts, Marksman's Tally and Bastion (live world only)

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-CARDS-2/3), under the owner's 2026-11-18 approval of the elite
  and augment rework (`docs/OWNER_DECISIONS.md:12`, row "Elite and augment rework": augments "Plus 13 new"; plan of
  record `docs/backlog/AUGMENT_ELITE_REWORK.md`: "Architecture", "1b: hooks and readouts", packet row P-AUG-NATIVE-1b,
  Appendix A rows "Marksman's Tally" and "Bastion", and the coordinator note "P-AUG-NATIVE-1b and the batches" of
  2026-11-19, commit `02bdef002`, quoted in section 2 because it is not on this branch's base).
- **Implementer tier:** implementer-opus (hook call sites inside the tick's systems, ledger damage, `check_world`
  caps, content hash move, allocation-free hot path)
- **Reviewer:** reviewer-opus
- **Integration base:** `coord/int-65` @ 35eceb4e0 (integration branch plus P-ELITE-TUNE-1-fix, P-AUG-POOL-1-fix,
  P-ELITE-PICK-1, P-AUG-NATIVE-1a; checkpoint `rh-checkpoint/35`, content hash `8196e898724e4218`). Gate runs take
  `--base coord/int-65`.
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10): the two exemplars match the workbook's numbers
  through the real hooks; a native-free world is pinned byte-identical by digests recorded at the stub · D2 n/a ·
  D5/D6/D9 none (no wire, no observation change: readout rows are produced sim-side only; P-WIRE19-B carries them).

## 1. ID and outcome

P-AUG-NATIVE-1a gave the 14 native augments ids, a `Build::native` slot each (`count`, `counter`, three `meters`,
`marks`) and their caps, with no behaviour. This packet adds the behaviour seam the batch packets fill, and two cards
that use it end to end. When it lands:

1. **Hook points (no schedule row).** One dispatcher, `cards::native::hooks::fire(k, w, holder, NativeEvent)`, called as
   a plain helper from inside existing systems and hook links at the 13 points below. It does nothing unless
   `k.cards.rule() == AugmentRule::Rework` and the holder holds at least one native card; then it reaches the holder's
   native slots through the batch tables' handlers. No `schedule::PHASES` row, no `schedule::HOOKS` link, no RNG draw,
   no event is added (`crates/rh-parity/tests/schedule.rs:366-390` pins 19 hook rows and the phase lists). A Legacy
   world, and a Rework world where no player holds a native card, play byte-identically to the base.

   | `NativeHook` / `NativeEvent` variant | Plan name | Fires (once per event, for the event's holder) | Expected call site |
   |---|---|---|---|
   | `LongRangeHit` | long-range hit | a projectile the holder launched (bow arrow or wand ball, not reflected) lands a hit (an `Event::Hit` with `by` = holder) after travelling at least `REWORK_MARKSMANS_TALLY_RANGE_SHARE` (0.8) of its launch range (`Projectile::traveled`, launch range including Plant Your Feet's `range_mult`) | `systems/projectiles.rs` (where the hit entry is built) or the ledger with the entry's projectile |
   | `CreditedKill` | credited kill | the holder is the credited killer of a player (`systems/credit.rs:40` `credit_kill`, before the `PlayerKilled` hook at `:70`) or of a mob (`systems/mob_life.rs:599` `MobKilled`, with `elite`) | `credit.rs`, `mob_life.rs` |
   | `FistHit` | fist hit | the holder lands a hit with `weapon == Fists` (the same events as `HitCount`, filtered) | ledger |
   | `MobKill` | first kill of a mob type | the holder is credited with a mob kill; carries the `MobTypeId`. Whether it is the FIRST of its type is the card's state (Pathfinder's marks), not the hook's | `mob_life.rs:599` |
   | `HazardTick` | hazard second | each tick the holder stands on a zone hazard (ember, bog, ice), with the hazard and the tick's ms; the card accumulates its seconds | `systems/terrain/mod.rs` (`burn`, `bog`, the ice slip) |
   | `WishCast` | Wish cast | the holder's Wish cast lands (`hooks::cast_ended(.., CastOutcome::Landed)`, `systems/abilities/mod.rs:316`); a cancelled, refunded cast does not count | `abilities/mod.rs` |
   | `CorpseHarvest` | corpse harvest | the holder consumes a plague corpse | `systems/plague_corpses.rs` (`consume_action` / `system`) |
   | `BurstLanded` | landed burst | the holder's fully charged roaming Fire burst lands | `systems/fire_roam.rs` `hit_landed` |
   | `ChillInflicted` | chill inflicted | the holder applies chill to another fighter, with the chill's ms | where Frost chill is applied (`systems/frost.rs` / status operations) |
   | `HuntStack` | hunt stack | the holder's Sentenced hunt pays stacks, with the count | `systems/sentenced_hunt.rs:137` (`HuntComplete { stacks }`) |
   | `Block` | block | the holder's shield blocks: once per `HookArgs::Blocked` for the holder (melee `systems/melee.rs:200`, projectile `systems/projectiles.rs:485`), with the prevented packet | inside `cards::on_blocked` (`cards/mod.rs:450`), the one link both sites reach |
   | `Overheal` | overheal | healing the holder receives beyond its max hp, with the excess | `systems/heal.rs` `apply_with` |
   | `HitCount` | hit count | the holder lands a weapon hit: once per `Event::Hit { by: Some(holder), weapon: Some(_), passive: false }` | `systems/ledger.rs:963` (beside `HookArgs::HitLanded`) |

   The payloads in the stub are a proposal; the implementer may change them. The variant NAMES are pinned (the oracle's
   source scan looks for `NativeEvent::<Name>` at a call site outside `cards/native/`).
2. **Three batch tables**, `cards/native/weapon.rs`, `cards/native/zone.rs`, `cards/native/faction.rs`, so the Sonnet
   batches never share a file. Each holds its cards' handlers (which hook, what it does to the slot), readout sources and
   pool membership `POOL: &[(CardId, Offer)]`. Assignment (workbook sheet Augments column "Alignment", rows 37-56):

   | Table | Cards | Filled by |
   |---|---|---|
   | `weapon.rs` | Marksman's Tally (bow, wand), Bastion (shield) | this packet |
   | `weapon.rs` | Calluses (fists), Executioner's Ledger (axe, sword), Eighth Strike | P-AUG-NATIVE-2 |
   | `zone.rs` | Pathfinder, Hazard Walker, Wish Engine, Overflow | P-AUG-NATIVE-3 |
   | `zone.rs` | Marked Man (generalist; NATIVE-5 runs after NATIVE-3) | P-AUG-NATIVE-5 |
   | `faction.rs` | Corpse Hoarder (Plague), Stoked (Fire), Glacier (Frost), Trophy Hunter (Sentenced), each `Offer::Faction` | P-AUG-NATIVE-4 |

   **Decision: admission waits for P-WIRE19-A.** The tables hold membership now (`weapon::POOL` lists Marksman's Tally
   and Bastion as `Offer::Any`; zone and faction are empty), but nothing reads it: `Tuning::pool`, `augment_pool`,
   `conditional_pool` and `offer_pool` stay over `CardId::ALL`, and `check_world` keeps refusing a chest that offers a
   native card (1a, `cards::native::check`). Admission is a missing reader, not a flag: P-WIRE19-A (or the packet the
   coordinator names after it) wires `native` membership into `Tuning` and lifts the chest rule, with the 1a oracle
   `no_pool_or_chest_holds_a_native_card` amended in an `oracle-amend:` commit. Reason: `WireRewardId::Card(id as u8)`
   and the C#/JS decoders refuse ids ≥ 80 today (`rh-protocol/tests/v11_union.rs:127`), so an offered native card would
   break the wire.
3. **Own-only readout producer (C-OBS).** `pub fn cards::native::readouts(sim: &Sim, viewer: PlayerId) -> Readouts`:
   fixed-size rows `Readout { card, kind: ReadoutKind, value, max }` read from the VIEWER's own native slots only, held
   cards in native order, each card's rows as its batch table declares them. A viewer who holds no native card, a
   viewer who is not a seated player, and every viewer in a Legacy world get no rows. No allocation. Nothing in
   `observe.rs` changes: P-WIRE19-B calls it beside `observe.rs:806` (`out.me`) and puts the rows on the wire.
   1b's rows: Marksman's Tally `(MarksmansTally, Counter, counter, REWORK_MARKSMANS_TALLY_CAP)`; Bastion
   `(Bastion, Meter, meters[0], REWORK_BASTION_METER_CAP)`.
4. **Marksman's Tally** (`weapon.rs`; workbook Augment_Tuning row 11 "0.3%, cap 30%"; Augments row 37 "Hits landed from
   beyond 80% of max range → +X% damage each", alignment bow, wand):
   - each `LongRangeHit` adds `REWORK_MARKSMANS_TALLY_PER` (0.003) to the slot's `counter`, capped at
     `REWORK_MARKSMANS_TALLY_CAP` (0.30): `counter = min(cap, counter + per)`;
   - the counter is a damage share: it joins the holder's outgoing damage sum in `modifiers::outgoing_damage`
     (`modifiers/mod.rs:975`, `sum += counter`, under the same G1 ceiling as the card rows) for every outgoing kind the
     sum already applies to. With no other damage rows a holder's hit is `(1 + counter)` times a non-holder's.
   - Same-tick order: the hit that earns a stack is dealt before it earns it (the hook fires after the hit's amount).
   - It is not baked into a packet, so `maximum_packet` needs no native row for it (see 7).
5. **Bastion** (`weapon.rs`; workbook Augment_Tuning row 27 "35%"; Augments row 53 "Blocked damage fills a meter; next
   attack deals X% of it", alignment shield, cap "Meter cap"):
   - each `Block` adds what the block kept, measured exactly as Tank Engine measures it (`cards/mod.rs:522-533`, legacy
     `cardHooks.ts:192`: `mitigate_shares(prevented.raw, shares, holder armor, holder shield)`), to `meters[0]`, capped at
     a new registered `REWORK_BASTION_METER_CAP`. **Decision: 250** (blocked points), the legacy Tank Engine cap number
     (`TANK_ENGINE_CAP`, `constants.ts:292`): the workbook gives no number ("Meter cap"), and Bastion "Pairs with Tank
     Engine". The max burst is 87.5. It is a content row: a later tuning packet retunes it.
   - the holder's next landed weapon hit (`Event::Hit { by: holder, weapon: Some(_), passive: false }`) deals
     `REWORK_BASTION_SHARE × meters[0]` (0.35) more damage, added to that hit's amount AFTER the victim's mitigation and
     the outgoing multipliers (stored blocks are already mitigated damage), and `meters[0]` goes to 0. A miss or a
     blocked attack does not spend it. Only the first victim of a multi-body swing gets it.
   - `NATIVE_RULES` Bastion: `meter_caps[0] = REWORK_BASTION_METER_CAP`; counter, meters 1-2 and marks stay 0.
6. **Plan notes for 1b** (coordinator 2026-11-19):
   - `trusted_build::apply` refuses a native card unless the world's rule is Rework: new
     `BuildRefusal::NativeOutsideRework(CardId)` (stub adds the variant), nothing changed on refusal.
   - `MAX_FOLD_ROWS` (`cards/mod.rs:319`, 79) silently truncates (`Build::rows`, `cards/mod.rs:421`). 1b's exemplars
     add no fold rows, but the oracle's guard (one copy of every card of both tables, catalog plus native, under each
     table and each faction's own row selection `Tuning::rows(id, faction)`) found the base already over it: a Plague
     player's selection is 80 rows under both Legacy and Rework (79 is the catalog's total under `definition()`).
     **Decision (oracle resume, 2026-11-19): the implementer raises `MAX_FOLD_ROWS` to cover it** (at least 80; a
     const computed from the tables is better) and updates its `NON_GAMEPLAY` reason in `tests/content.rs`. It is a
     scratch bound, not state: no hash, checkpoint or realistic build moves (only a Plague build holding every catalog
     card once kept 79 of its 80 rows; legacy has no bound). The batches keep the guard green.
   - `power()` counts native tiers since 1a (legacy `cardPower`, `packages/shared/src/cards.ts:593-603`), which feeds
     `pvp_factor`. Kept: the oracle's damage comparisons hold the card in both arms.
   - Native damage rows and the Rework `maximum_packet` envelope (`modifiers/mod.rs:866`): neither exemplar changes a
     packet (Tally is in `outgoing_damage`, Bastion after mitigation), so the envelope does not move. A batch card that
     bakes damage into a packet must add itself there; the oracle's restore test with arrows in flight under a full
     Tally catches a baked Tally.
   - Non-integral counters and Pathfinder's marks: each batch adds its card's exact `check` rule (not 1b).
7. **No new state, no format bump.** The slots are 1a's (`Build::native`, hashed and checkpointed). `CHECKPOINT_FORMAT`,
   `REPLAY_FORMAT` and `OBSERVATION_VERSION` stay. The content hash moves once (Bastion's cap row and its `NATIVE_RULES`
   word, and the batch tables if folded), through `scripts/regolden-content.sh`.
8. **Guide.** `docs/agent/AUGMENT_REWORK.md` gains "Native hooks and batch tables (P-AUG-NATIVE-1b)": the 13 hooks and
   their sites, how a batch adds a handler, a readout and pool membership in its own table, the admission rule, the
   `MAX_FOLD_ROWS` and `maximum_packet` rules, and the no-allocation rule.

## 2. Dependencies
- P-AUG-NATIVE-1a (merged in `coord/int-65`).
- Parallel: P-WIRE19-A owns `rh-protocol`, the decoders, `observe.rs` wire mapping, `wire.rs` and `collections.rs`.
  1b touches none of them (it does not need `observe.rs`).
- Coordinator note (2026-11-19, `02bdef002`, on the plan of record but not on this base): "`MAX_FOLD_ROWS = 79`
  silently truncates when full. Raise it before native cards add fold rows. The Rework `maximum_packet` envelope
  iterates `CardId::ALL` only. Native damage rows must join it, or restore will refuse native-boosted packets. `power()`
  now counts native tiers, which feeds `ledger.rs` `pvp_factor` and `higher_power` [...]. `trusted_build::apply` can
  grant a native card in a Legacy world. Refuse native ids unless the rule is Rework. Native `check` admits non-integral
  counters [...]. Each batch packet adds its card's exact rule."
- Content lane: this is one more content-hash move, through the script.

## 3. Relevant legacy paths
The cards are new (no legacy implementation). Legacy the hooks sit beside, verified with `rg`:
- `packages/server/src/sim/cardHooks.ts:186-197` `onBlocked`: Tank Engine's `cards.prevented += mitigateShares(prevented.raw,
  prevented, defenseOf(holder.s))` (Bastion's fill measure); `:42` the `blocked` chain.
- `packages/server/src/sim/melee.ts:83` and `projectiles.ts:305,310`: `world.hooks.blocked` for melee blocks and arrow
  reflections (Rust `systems/melee.rs:200`, `systems/projectiles.rs:485`).
- `packages/server/src/sim/ledger.ts:370-395`: `hitLanded` after the victim took the damage and its hit fx went out
  (Rust `systems/ledger.rs:963`): the hit-count point, and why a stack earned by a hit is not in that hit.
- `packages/shared/src/cards.ts:593-603` `cardPower` (tier × count of every held card).
- Workbook `docs/quests/FUTURE_ONLY_Quest_Design_Discussion.xlsx`: Augment_Tuning row 11 (Marksman's Tally: "0.25% per
  long-range hit, cap 25%" → "0.3%, cap 30%") and row 27 (Bastion: "Next attack deals 25% of stored blocks" → "35%");
  Augments row 37 (Marksman's Tally: "beyond 80% of max range", "Weapon: bow, wand") and row 53 (Bastion: "Blocked
  damage fills a meter", "Weapon: shield", cap "Meter cap", "Pairs with Tank Engine").

## 4. New paths
- `crates/rh-sim/src/cards/native/hooks.rs` (stub): `NativeHook` (13 variants, `ALL`), `NativeEvent`, `fire`, and the
  `cfg(test)` trace the oracle reads (`take_trace`).
- `crates/rh-sim/src/cards/native/readout.rs` (stub): `ReadoutKind`, `Readout`, `Readouts`, `MAX_READOUTS`, `readouts`.
- `crates/rh-sim/src/cards/native/weapon.rs`, `zone.rs`, `faction.rs` (stub): `POOL` each (empty at the stub).
- `REWORK_BASTION_METER_CAP: f64 = 250., "dmg"` appended to the `content!` registry (`constants.rs`).

## 5. Exclusive write scope
- `crates/rh-sim/src/cards/native/mod.rs`, `table.rs`, and the stub files `hooks.rs`, `readout.rs`, `weapon.rs`,
  `zone.rs`, `faction.rs`.
- `crates/rh-sim/src/cards/mod.rs` (`on_blocked`'s `Block` call; `MAX_FOLD_ROWS` raised, section 1.6).
- `crates/rh-sim/src/modifiers/mod.rs` (`outgoing_damage`: Tally's share; `maximum_packet` only if a native packet row
  is needed).
- Call sites, the helper call only: `crates/rh-sim/src/systems/ledger.rs`, `systems/projectiles.rs`, `systems/credit.rs`,
  `systems/mob_life.rs`, `systems/terrain/mod.rs`, `systems/abilities/mod.rs`, `systems/plague_corpses.rs`,
  `systems/fire_roam.rs`, `systems/frost.rs` (or the status operation that applies chill), `systems/sentenced_hunt.rs`,
  `systems/heal.rs`. Ledger: Bastion's burst too.
- `crates/rh-sim/src/trusted_build.rs` (the refusal).
- `crates/rh-sim/src/constants.rs`: the appended row only.
- `crates/rh-sim/tests/content.rs`: `NON_GAMEPLAY` / `TABLES_FOLDED_BY_HASH` entries for the new statics (the stub adds
  `NON_GAMEPLAY` rows for `hooks.rs` `ALL`/`TRACE`, `readout.rs` `MAX_READOUTS` and the three `POOL`s; the implementer
  may move a table to the folded list once it folds it), the `MAX_FOLD_ROWS` reason text, `GOLDEN_CONTENT_HASH`
  through the script only. `content/fold.rs` only if the batch tables are folded.
- The content-hash copies, through `scripts/regolden-content.sh` only (`tools/unity-browser-reload-proof/check.mjs`,
  `normal-companion.mjs`, `client-unity/UnityProject/Assets/Scripts/BakedContent.cs` (`--allow-artefacts`),
  `parity/abilities/hash-tape.json` and `protocol/fixtures/archetypes_v1.json` (`--regen-fixtures`)).
- `docs/agent/AUGMENT_REWORK.md`: the new section.

Nothing in `rh-protocol`, `rh-server`, `rh-policy`, `observe.rs`, `wire.rs`, `reward_chests/`, `schedule.rs`,
`hooks.rs` (the crate's hook dispatcher) or `client-unity/` (except the regolden copy).

## 6. Contracts and references
- C-TICK (no schedule row, no hook link), C-RNG (no draw), C-OBS (readouts own-only; observations unchanged), C-DET
  (restore mid-count hash-exact), C-PARITY (Legacy and native-free Rework unchanged), C-INPUT (no command).
- `docs/agent/AUGMENT_REWORK.md` "Native cards (P-AUG-NATIVE-1a)", `crates/rh-sim/AGENTS.md`, ADR 0007.

## 7. Behaviour to preserve
- Legacy world: state hashes and checkpoint bytes (1a's `legacy_worlds_keep_their_state_hash_and_checkpoint_bytes`).
- A Rework world where no one holds a native card: state hashes, events and checkpoint bytes (new digest test, recorded
  at the stub).
- Observations and events of a native holder equal a non-holder's (1a's
  `a_player_holding_a_native_card_is_observed_as_one_who_does_not`, 20 idle ticks: it must stay green).
- No pool or chest offers a native card (1a's `no_pool_or_chest_holds_a_native_card`).
- Zero allocations per step (`tests/no_alloc.rs`, `tests/cards_no_alloc.rs`, the new `tests/native_no_alloc.rs`).

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-AUG-NATIVE-1b --base coord/int-65 --allow-artefacts --regen-fixtures`
  passes; the full gate is the coordinator's on the merge.
- `scripts/regolden-content.sh --check` exits 0; `git diff packet/P-AUG-NATIVE-1b..HEAD -- parity/abilities/hash-tape.json`
  changes only `"contentHash"`.
- `cargo test -p rh-parity --test schedule` green (no schedule row added).

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/cards/native/exemplars_tests.rs`
- `crates/rh-sim/src/cards/native/hooks_tests.rs`
- `crates/rh-sim/tests/native_no_alloc.rs`
- `docs/backlog/packets/P-AUG-NATIVE-1b.md` (this brief)

Stub (`stub:` commit; the implementer replaces or edits these): `cards/native/hooks.rs` (`NativeHook` + `ALL`,
`NativeEvent` with proposed payloads, `NativeEvent::hook`, `fire` with the rule and holder guard and no handler, the
`cfg(test)` `trace` module that `fire` records into after the guard: keep the `trace::record(holder, hook)` call for
every dispatch that passes the guard), `cards/native/readout.rs` (`ReadoutKind`, `Readout`, `Readouts`,
`MAX_READOUTS = 28`, `readouts` returning no rows), `cards/native/{weapon,zone,faction}.rs` (`POOL`, empty),
`cards/native/mod.rs` (the module lines, `pool_members`, the `cfg(test)` oracle module lines), `trusted_build.rs`
(`BuildRefusal::NativeOutsideRework(CardId)`, never returned), `tests/content.rs` (six `NON_GAMEPLAY` rows).
Not stubbed: `REWORK_BASTION_METER_CAP` (the implementer appends the row; the oracle reads it through `REGISTRY`).

Red at the stub, each on an assertion (`cargo test -p rh-sim --features trusted-status-probes`):

| Test | Fails at the stub because |
|---|---|
| `hooks_tests::every_native_hook_point_has_a_call_site_outside_the_native_module` | no `NativeEvent::<Name>` outside `cards/native/` (all 13 missing) |
| `hooks_tests::ranged_hooks_fire_once_per_landed_hit_for_holders_only` | trace empty; wants `{LongRangeHit: 3, HitCount: 3}` for 3 long bow hits (short: `{HitCount: 3}`) |
| `hooks_tests::fist_hooks_fire_once_per_landed_punch_for_holders_only` | trace empty; wants `{FistHit: 3, HitCount: 3}` |
| `hooks_tests::block_hook_fires_once_per_block_for_holders_only` | trace empty; wants `{Block: 3}` |
| `hooks_tests::credited_kill_hook_fires_once_per_kill_for_holders_only` | trace empty; wants `{CreditedKill: 1, HitCount: 1}` |
| `hooks_tests::the_batch_tables_hold_their_own_cards_and_no_pool_offers_them_yet` | `weapon::POOL` does not list Marksman's Tally and Bastion as `Offer::Any` |
| `hooks_tests::trusted_build_refuses_a_native_card_outside_rework` | `apply` grants Marksman's Tally in a Legacy world (`Ok(())`) |
| `hooks_tests::max_fold_rows_covers_every_card_of_both_tables` | `MAX_FOLD_ROWS` 79 < 80 fold rows of a Plague selection, Legacy and Rework (section 1.6) |
| `exemplars_tests::marksmans_tally_earns_its_workbook_share_per_long_range_hit_only` | bow at 0.92 range: counter 0, wants 0.009 after 3 hits |
| `exemplars_tests::marksmans_tally_stops_at_its_cap` | counter stays 0.2985, wants 0.30 |
| `exemplars_tests::marksmans_tally_share_multiplies_the_holders_hits` | ratio 1.0 at the cap, wants 1.3 (within 2%) |
| `exemplars_tests::bastion_meter_cap_is_its_registered_row` | `REWORK_BASTION_METER_CAP` not registered (None, wants 250) |
| `exemplars_tests::bastion_fills_with_what_each_block_kept_up_to_its_cap` | meter 0, Tank Engine counted 10.198 for three blocks |
| `exemplars_tests::bastion_spends_the_meter_on_the_next_landed_hit_at_35_percent` | the blocks left the meter at 0 |
| `exemplars_tests::readouts_show_each_owner_its_own_native_cards_only` | `readouts` returns no rows |
| `exemplars_tests::a_checkpoint_mid_count_restores_hash_exact_and_plays_on` | restores hash-exact every tick, but the Tally stays at 0.2925, wants the cap 0.30 |
| `tests/native_no_alloc.rs` `native_hooks_and_readouts_allocate_nothing_in_a_warmed_tick` | 0 heap blocks at the stub, but the Tally earned no stack in the counted window |

Green at the stub and kept green: `hooks_tests::a_rework_world_without_native_cards_plays_as_on_the_base` (three state
hashes, event and checkpoint-world digests of a native-free Rework match with long bow hits, blocks under Tank
Engine, fist hits and a kill, recorded at the stub), 1a's `tests/native_cards.rs`, `tests/content.rs`.

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --lib cards::native`
- `cargo test -p rh-sim --test native_no_alloc --test native_cards --test content --test hash_coverage`
- `cargo test -p rh-parity --test schedule`
- `scripts/regolden-content.sh` then `scripts/regolden-content.sh --check`
- `scripts/gate.sh --quick --oracle packet/P-AUG-NATIVE-1b --base coord/int-65 --allow-artefacts --regen-fixtures`

## 10. Risk and suggested model tier
implementer-opus: thirteen helper calls inside the tick's systems (the ledger pass, the projectile pass, kill credit,
hook links) where a call in the wrong place double-counts, fires for a non-holder or changes a native-free world; a
damage term in the ledger after mitigation; a content-hash move; the allocation-free hot path.

## 11. Known traps
- Fire the hook once per EVENT: `HookArgs::Blocked` fires from two sites (melee, projectile); call `Block` from inside
  `cards::on_blocked` (one place) or from both sites, never both. A swing that hits two bodies is two `HitCount`s.
- The guard is the first thing `fire` does (rule, then `build.native.is_empty()`): a non-holder pays one branch. Do not
  compute a long-range distance or a mitigation for a non-holder.
- Same-tick: Tally's stack from a hit is not in that hit; Bastion's burst spends the meter in the same pass it is dealt,
  so a second hit of the same pass by the holder gets nothing. A block and a burst hit in the same tick: the block's
  fill comes first only if the block resolves first in the tick's order; the oracle does not pin that tie.
- A native slot cleared (faction reset, training console, `Build::set(id, 0)`) is zeroed whole (1a).
- `readouts` must not allocate (fixed array); it reads `k.cards` and the viewer's slots only.
- The batch tables are statics: `tests/content.rs` audits every const/static under `src/` (stub rows in `NON_GAMEPLAY`).
- Do not touch `observe.rs`: 1a's observation test compares a holder's observation with a non-holder's.

## Notes from previous attempts
<!-- Coordinator appends on escalation: tier, branch, the gate's failure block. Nothing else. -->
